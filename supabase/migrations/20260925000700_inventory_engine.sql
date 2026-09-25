-- =============================================================================
-- StockFlow ERP - 07 Inventory engine
--
-- public.create_stock_movement   : the only way to change stock (RPC).
-- public.reverse_stock_movement  : corrects a movement by posting its opposite.
-- private.post_stock_movement    : shared core used by both; NOT callable by clients.
--
-- Every call runs in one transaction:
--   1. make sure the inventory row exists, then lock it (SELECT ... FOR UPDATE)
--   2. reject the movement if the new quantity would be negative
--   3. insert the stock_movements ledger row (quantity before / after)
--   4. update inventory.quantity
--   5. write an audit_log entry
-- Any error rolls back all five steps.
--
-- Custom SQLSTATEs (surfaced to the client as error.code):
--   SF001 insufficient stock      SF002 movement already reversed
--   SF003 SKU locked by history   42501 caller may not change stock
--   22023 invalid input           P0002 product / warehouse / movement not found
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permission helper: only admins and warehouse managers move stock.
-- Receiving (Phase 3), shipping and transfer execution (Phase 4) are warehouse
-- actions too, so those workflows call create_stock_movement as the same roles.
-- -----------------------------------------------------------------------------
create or replace function private.assert_can_move_stock()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_any_role('admin', 'warehouse_manager') then
    raise exception 'You do not have permission to change stock levels'
      using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Core engine. Callers are responsible for permission and input checks.
-- -----------------------------------------------------------------------------
create or replace function private.post_stock_movement(
  p_product_id       uuid,
  p_warehouse_id     uuid,
  p_movement_type    public.movement_type,
  p_direction        smallint,
  p_quantity         integer,
  p_unit_cost        numeric,
  p_reference_type   text,
  p_reference_id     uuid,
  p_reference_number text,
  p_reversal_of_id   uuid,
  p_reason           text,
  p_notes            text,
  p_movement_date    timestamptz
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory public.inventory;
  v_new_qty   integer;
  v_movement  public.stock_movements;
begin
  -- 1. Create the inventory row on first use. If another transaction is creating
  --    the same row right now, this waits for it and then does nothing.
  insert into public.inventory (product_id, warehouse_id, quantity)
  values (p_product_id, p_warehouse_id, 0)
  on conflict (product_id, warehouse_id) do nothing;

  -- Lock the row. Concurrent movements for the same product + warehouse queue
  -- here, and each one sees the quantity committed by the one before it.
  select i.* into v_inventory
  from public.inventory i
  where i.product_id = p_product_id
    and i.warehouse_id = p_warehouse_id
  for update;

  -- 2. Never go below zero.
  v_new_qty := v_inventory.quantity + p_direction * p_quantity;
  if v_new_qty < 0 then
    raise exception 'Insufficient stock: % available, % requested', v_inventory.quantity, p_quantity
      using errcode = 'SF001',
            detail  = format('product_id=%s warehouse_id=%s available=%s requested=%s',
                             p_product_id, p_warehouse_id, v_inventory.quantity, p_quantity);
  end if;

  -- 3. Ledger row.
  insert into public.stock_movements (
    movement_type, direction, product_id, warehouse_id, quantity,
    quantity_before, quantity_after, unit_cost,
    reference_type, reference_id, reference_number, reversal_of_id,
    reason, notes, performed_by, movement_date
  )
  values (
    p_movement_type, p_direction, p_product_id, p_warehouse_id, p_quantity,
    v_inventory.quantity, v_new_qty, p_unit_cost,
    p_reference_type, p_reference_id, p_reference_number, p_reversal_of_id,
    p_reason, p_notes, auth.uid(), coalesce(p_movement_date, now())
  )
  returning * into v_movement;

  -- 4. Current quantity.
  update public.inventory
     set quantity = v_new_qty,
         last_movement_at = now()
   where id = v_inventory.id;

  -- 5. Audit.
  perform private.write_audit(
    case when p_reversal_of_id is null then 'STOCK_MOVEMENT' else 'STOCK_REVERSAL' end,
    'stock_movements',
    v_movement.id::text,
    jsonb_build_object(
      'movement_number', v_movement.movement_number,
      'movement_type',   v_movement.movement_type,
      'product_id',      v_movement.product_id,
      'warehouse_id',    v_movement.warehouse_id,
      'quantity_change', v_movement.quantity_change,
      'quantity_before', v_movement.quantity_before,
      'quantity_after',  v_movement.quantity_after,
      'reversal_of_id',  v_movement.reversal_of_id
    ),
    null,
    to_jsonb(v_movement)
  );

  return v_movement;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public RPC: create a stock movement.
-- Direction is derived from the movement type; only RETURN needs p_direction
-- (1 = customer return into stock, -1 = return to supplier).
-- Unit cost defaults to the product's current cost price (snapshot).
-- -----------------------------------------------------------------------------
create or replace function public.create_stock_movement(
  p_product_id       uuid,
  p_warehouse_id     uuid,
  p_movement_type    public.movement_type,
  p_quantity         integer,
  p_reference_type   text default null,
  p_reference_id     uuid default null,
  p_reference_number text default null,
  p_reason           text default null,
  p_notes            text default null,
  p_movement_date    timestamptz default null,
  p_direction        smallint default null,
  p_unit_cost        numeric default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction        smallint;
  v_reference_type   text := nullif(btrim(p_reference_type), '');
  v_reference_number text := nullif(btrim(p_reference_number), '');
  v_reason           text := nullif(btrim(p_reason), '');
  v_notes            text := nullif(btrim(p_notes), '');
  v_product          record;
  v_warehouse        record;
  v_reference_exists boolean;
begin
  perform private.assert_can_move_stock();

  if p_product_id is null or p_warehouse_id is null or p_movement_type is null then
    raise exception 'Product, warehouse and movement type are required' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be a positive whole number' using errcode = '22023';
  end if;

  v_direction := case
    when p_movement_type in ('PURCHASE_RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN') then 1
    when p_movement_type in ('SALE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT') then -1
    else p_direction
  end;

  if p_movement_type = 'RETURN' and (p_direction is null or p_direction not in (-1, 1)) then
    raise exception 'RETURN movements need p_direction = 1 (into stock) or -1 (out of stock)' using errcode = '22023';
  end if;

  if p_direction is not null and p_direction <> v_direction then
    raise exception '% movements always have direction %', p_movement_type, v_direction using errcode = '22023';
  end if;

  if p_movement_type in ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') then
    if v_reason is null then
      raise exception 'A reason is required for stock adjustments' using errcode = '22023';
    end if;
    v_reference_type := coalesce(v_reference_type, 'ADJUSTMENT');
  end if;

  if length(v_reason) > 500 or length(v_notes) > 2000 or length(v_reference_number) > 100 then
    raise exception 'Reason (500), notes (2000) or reference number (100) is too long' using errcode = '22023';
  end if;

  if v_reference_type = 'REVERSAL' then
    raise exception 'Use reverse_stock_movement to reverse a movement' using errcode = '22023';
  end if;

  -- Document references must point at a real document.
  if v_reference_type in ('PURCHASE_ORDER', 'GOODS_RECEIPT', 'SALES_ORDER', 'STOCK_TRANSFER') then
    if p_reference_id is null then
      raise exception 'reference_id is required when reference_type is %', v_reference_type using errcode = '22023';
    end if;
    v_reference_exists := case v_reference_type
      when 'PURCHASE_ORDER' then exists (select 1 from public.purchase_orders d where d.id = p_reference_id)
      when 'GOODS_RECEIPT'  then exists (select 1 from public.goods_receipts d where d.id = p_reference_id)
      when 'SALES_ORDER'    then exists (select 1 from public.sales_orders d where d.id = p_reference_id)
      when 'STOCK_TRANSFER' then exists (select 1 from public.stock_transfers d where d.id = p_reference_id)
    end;
    if not v_reference_exists then
      raise exception 'Referenced % % does not exist', v_reference_type, p_reference_id using errcode = '23503';
    end if;
  end if;

  if p_movement_date > now() + interval '5 minutes' then
    raise exception 'Movement date cannot be in the future' using errcode = '22023';
  end if;

  if p_unit_cost < 0 then
    raise exception 'Unit cost cannot be negative' using errcode = '22023';
  end if;

  select p.id, p.sku, p.is_active, p.cost_price into v_product
  from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'Product % not found', p_product_id using errcode = 'P0002';
  end if;

  select w.id, w.code, w.is_active into v_warehouse
  from public.warehouses w where w.id = p_warehouse_id;
  if not found then
    raise exception 'Warehouse % not found', p_warehouse_id using errcode = 'P0002';
  end if;

  -- Inactive master data can still be counted out (write-offs), never into stock.
  if v_direction = 1 and not v_product.is_active then
    raise exception 'Product % is inactive and cannot receive stock', v_product.sku using errcode = '22023';
  end if;
  if v_direction = 1 and not v_warehouse.is_active then
    raise exception 'Warehouse % is inactive and cannot receive stock', v_warehouse.code using errcode = '22023';
  end if;

  return private.post_stock_movement(
    p_product_id, p_warehouse_id, p_movement_type, v_direction, p_quantity,
    coalesce(p_unit_cost, v_product.cost_price),
    v_reference_type, p_reference_id, v_reference_number, null,
    v_reason, v_notes, p_movement_date
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Public RPC: reverse a movement.
-- History is never edited: an opposite ADJUSTMENT_IN / ADJUSTMENT_OUT is posted
-- with reference_type = 'REVERSAL' and reversal_of_id = the original movement.
-- A movement can be reversed once; a reversal cannot itself be reversed.
-- Reversing a receipt whose stock has already been used is rejected by the
-- same negative-stock check as any other movement.
-- -----------------------------------------------------------------------------
create or replace function public.reverse_stock_movement(
  p_movement_id uuid,
  p_reason      text
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original    public.stock_movements;
  v_reversed_by text;
  v_reason      text := nullif(btrim(p_reason), '');
begin
  perform private.assert_can_move_stock();

  if v_reason is null then
    raise exception 'A reason is required to reverse a movement' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)' using errcode = '22023';
  end if;

  -- Locking the original serialises concurrent reversal attempts.
  select m.* into v_original
  from public.stock_movements m
  where m.id = p_movement_id
  for update;

  if not found then
    raise exception 'Stock movement % not found', p_movement_id using errcode = 'P0002';
  end if;

  if v_original.reversal_of_id is not null then
    raise exception 'Movement % is a reversal and cannot be reversed', v_original.movement_number
      using errcode = '22023';
  end if;

  select m.movement_number into v_reversed_by
  from public.stock_movements m
  where m.reversal_of_id = v_original.id;

  if v_reversed_by is not null then
    raise exception 'Movement % was already reversed by %', v_original.movement_number, v_reversed_by
      using errcode = 'SF002';
  end if;

  return private.post_stock_movement(
    v_original.product_id,
    v_original.warehouse_id,
    case when v_original.direction = 1 then 'ADJUSTMENT_OUT' else 'ADJUSTMENT_IN' end::public.movement_type,
    (-v_original.direction)::smallint,
    v_original.quantity,
    v_original.unit_cost,
    'REVERSAL',
    v_original.id,
    v_original.movement_number,
    v_original.id,
    v_reason,
    null,
    now()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- A product's SKU is its identity on documents and in the ledger: once stock
-- has moved, it can no longer be changed.
-- -----------------------------------------------------------------------------
create or replace function private.protect_product_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sku is distinct from old.sku
     and exists (select 1 from public.stock_movements m where m.product_id = old.id) then
    raise exception 'SKU % cannot be changed because stock movements exist for this product', old.sku
      using errcode = 'SF003';
  end if;
  return new;
end;
$$;

create trigger products_protect_sku
  before update of sku on public.products
  for each row execute function private.protect_product_sku();

-- -----------------------------------------------------------------------------
-- Reporting views. security_invoker = true: the caller's RLS applies.
--
-- inventory_valuation is the ONE place where inventory value is calculated
-- (quantity x product cost price). Every other view aggregates from it.
-- Stock status: OUT_OF_STOCK at 0, LOW_STOCK at or below the product's minimum
-- stock level, otherwise IN_STOCK.
-- -----------------------------------------------------------------------------
create view public.inventory_valuation
with (security_invoker = true)
as
select
  i.id                          as inventory_id,
  i.product_id,
  p.sku,
  p.name                        as product_name,
  p.unit_of_measure,
  p.category_id,
  c.name                        as category_name,
  i.warehouse_id,
  w.code                        as warehouse_code,
  w.name                        as warehouse_name,
  i.quantity,
  p.min_stock_level,
  p.cost_price,
  i.quantity * p.cost_price     as inventory_value,
  case
    when i.quantity = 0                  then 'OUT_OF_STOCK'
    when i.quantity <= p.min_stock_level then 'LOW_STOCK'
    else 'IN_STOCK'
  end                           as stock_status,
  p.is_active                   as product_is_active,
  w.is_active                   as warehouse_is_active,
  i.bin_location,
  i.last_movement_at
from public.inventory i
join public.products p   on p.id = i.product_id
join public.categories c on c.id = p.category_id
join public.warehouses w on w.id = i.warehouse_id;

-- One row per product (including products that never had stock).
create view public.product_stock_summary
with (security_invoker = true)
as
select
  p.id                                  as product_id,
  p.sku,
  p.name,
  p.barcode,
  p.unit_of_measure,
  p.category_id,
  c.name                                as category_name,
  p.cost_price,
  p.sale_price,
  p.min_stock_level,
  p.reorder_quantity,
  p.is_active,
  p.created_at,
  p.updated_at,
  coalesce(s.total_quantity, 0)         as total_quantity,
  coalesce(s.inventory_value, 0)        as inventory_value,
  coalesce(s.warehouse_count, 0)        as warehouse_count,
  case
    when coalesce(s.total_quantity, 0) = 0                  then 'OUT_OF_STOCK'
    when coalesce(s.total_quantity, 0) <= p.min_stock_level then 'LOW_STOCK'
    else 'IN_STOCK'
  end                                   as stock_status
from public.products p
join public.categories c on c.id = p.category_id
left join (
  select
    v.product_id,
    sum(v.quantity)::integer                 as total_quantity,
    sum(v.inventory_value)                   as inventory_value,
    (count(*) filter (where v.quantity > 0))::integer as warehouse_count
  from public.inventory_valuation v
  group by v.product_id
) s on s.product_id = p.id;

-- One row per warehouse. Low / out-of-stock counts only consider active products.
create view public.warehouse_stock_summary
with (security_invoker = true)
as
select
  w.id                                   as warehouse_id,
  w.code,
  w.name,
  w.warehouse_type,
  w.city,
  w.is_active,
  w.manager_id,
  m.full_name                            as manager_name,
  (count(v.inventory_id) filter (where v.quantity > 0))::integer                               as product_count,
  coalesce(sum(v.quantity), 0)::integer                                                         as total_quantity,
  coalesce(sum(v.inventory_value), 0)                                                           as inventory_value,
  (count(v.inventory_id) filter (where v.stock_status = 'LOW_STOCK' and v.product_is_active))::integer    as low_stock_count,
  (count(v.inventory_id) filter (where v.stock_status = 'OUT_OF_STOCK' and v.product_is_active))::integer as out_of_stock_count
from public.warehouses w
left join public.profiles m on m.id = w.manager_id
left join public.inventory_valuation v on v.warehouse_id = w.id
group by w.id, m.full_name;

-- The ledger with names resolved, for lists, filters and exports.
create view public.stock_movement_ledger
with (security_invoker = true)
as
select
  m.id,
  m.movement_number,
  m.movement_type,
  m.direction,
  m.quantity,
  m.quantity_change,
  m.quantity_before,
  m.quantity_after,
  m.unit_cost,
  m.quantity_change * m.unit_cost as movement_value,
  m.product_id,
  p.sku,
  p.name                          as product_name,
  m.warehouse_id,
  w.code                          as warehouse_code,
  w.name                          as warehouse_name,
  m.reference_type,
  m.reference_id,
  m.reference_number,
  m.reversal_of_id,
  o.movement_number               as reversal_of_number,
  r.id                            as reversed_by_id,
  r.movement_number               as reversed_by_number,
  m.reason,
  m.notes,
  m.performed_by,
  u.full_name                     as performed_by_name,
  m.movement_date,
  m.created_at
from public.stock_movements m
join public.products p          on p.id = m.product_id
join public.warehouses w        on w.id = m.warehouse_id
left join public.profiles u     on u.id = m.performed_by
left join public.stock_movements o on o.id = m.reversal_of_id
left join public.stock_movements r on r.reversal_of_id = m.id;

create index inventory_quantity_idx on public.inventory (quantity);

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on
  public.inventory_valuation,
  public.product_stock_summary,
  public.warehouse_stock_summary,
  public.stock_movement_ledger
from public, anon, authenticated;

grant select on
  public.inventory_valuation,
  public.product_stock_summary,
  public.warehouse_stock_summary,
  public.stock_movement_ledger
to authenticated, service_role;

-- New private functions are executable by PUBLIC by default: lock them down.
revoke execute on function private.assert_can_move_stock() from public;
revoke execute on function private.post_stock_movement(
  uuid, uuid, public.movement_type, smallint, integer, numeric, text, uuid, text, uuid, text, text, timestamptz
) from public;
revoke execute on function private.protect_product_sku() from public;

revoke execute on function public.create_stock_movement(
  uuid, uuid, public.movement_type, integer, text, uuid, text, text, text, timestamptz, smallint, numeric
) from public, anon;
revoke execute on function public.reverse_stock_movement(uuid, text) from public, anon;

grant execute on function public.create_stock_movement(
  uuid, uuid, public.movement_type, integer, text, uuid, text, text, text, timestamptz, smallint, numeric
) to authenticated;
grant execute on function public.reverse_stock_movement(uuid, text) to authenticated;
