-- =============================================================================
-- StockFlow ERP - 12 Sales order workflow
--
--   DRAFT -> CONFIRMED -> PROCESSING -> SHIPPED -> COMPLETED
--     \          \            \
--      +----------+------------+--> CANCELLED   (only while unshipped)
--   SHIPPED -> CONFIRMED  only through reverse_sales_order_shipment
--
-- RPCs:
--   create_sales_order / update_sales_order / confirm_sales_order   admin, sales
--   cancel_sales_order                                             admin, sales
--   start_processing_sales_order                                   admin, warehouse_manager
--   ship_sales_order / reverse_sales_order_shipment                admin, warehouse_manager
--   complete_sales_order                                           admin, sales, warehouse_manager
--
-- ship_sales_order is all-or-nothing: every line is checked against stock
-- first; if any line is short, nothing is posted and the error names every
-- short product. Otherwise one SALE movement per line goes through
-- create_stock_movement. The shipment is reversed through reverse_stock_movement.
--
-- Custom SQLSTATEs: SF001 insufficient stock, SF007 invalid status / not
-- editable, SF009 cancel after shipment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.sales_orders
  add column processing_started_at    timestamptz,
  add column processing_started_by    uuid references public.profiles (id),
  -- System time the shipment was posted (shipped_at is the business ship date).
  add column shipment_posted_at       timestamptz,
  add column shipment_reversed_at     timestamptz,
  add column shipment_reversed_by     uuid references public.profiles (id),
  add column shipment_reversal_reason text,
  add constraint sales_orders_shipment_consistency
    check ((status in ('SHIPPED', 'COMPLETED')) = (shipped_at is not null)),
  add constraint sales_orders_completion_consistency
    check ((status = 'COMPLETED') = (completed_at is not null)),
  add constraint sales_orders_reversal_consistency
    check ((shipment_reversed_at is null) = (shipment_reversal_reason is null));

create index sales_orders_processing_started_by_idx on public.sales_orders (processing_started_by);
create index sales_orders_shipment_reversed_by_idx on public.sales_orders (shipment_reversed_by);
create index sales_orders_shipped_at_idx on public.sales_orders (shipped_at desc);

-- -----------------------------------------------------------------------------
-- Trigger: status machine and frozen header
-- -----------------------------------------------------------------------------
create or replace function private.enforce_sales_order_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transition text;
  v_lines      integer;
  v_quantity   bigint;
  v_shipped    bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then
      raise exception 'New sales orders start as DRAFT' using errcode = 'SF007';
    end if;
    return new;
  end if;

  if old.status <> 'DRAFT'
     and (new.so_number, new.customer_id, new.warehouse_id, new.order_date, new.requested_delivery_date, new.currency)
         is distinct from
         (old.so_number, old.customer_id, old.warehouse_id, old.order_date, old.requested_delivery_date, old.currency) then
    raise exception 'Sales order % is % and can no longer be edited', old.so_number, old.status
      using errcode = 'SF007';
  end if;

  if new.status is distinct from old.status then
    v_transition := old.status::text || '>' || new.status::text;
    if not v_transition = any (array[
      'DRAFT>CONFIRMED', 'DRAFT>CANCELLED',
      'CONFIRMED>PROCESSING', 'CONFIRMED>CANCELLED',
      'PROCESSING>SHIPPED', 'PROCESSING>CANCELLED',
      'SHIPPED>COMPLETED',
      'SHIPPED>CONFIRMED'   -- shipment reversed
    ]) then
      raise exception 'Sales order % cannot go from % to %', old.so_number, old.status, new.status
        using errcode = 'SF007';
    end if;

    select count(*), coalesce(sum(i.quantity), 0), coalesce(sum(i.quantity_shipped), 0)
      into v_lines, v_quantity, v_shipped
    from public.sales_order_items i
    where i.sales_order_id = new.id;

    if new.status = 'CONFIRMED' and v_lines = 0 then
      raise exception 'Sales order % has no lines', old.so_number using errcode = 'SF007';
    elsif new.status in ('CONFIRMED', 'PROCESSING', 'CANCELLED') and v_shipped > 0 then
      raise exception 'Sales order % has shipped goods; reverse the shipment first', old.so_number
        using errcode = 'SF009';
    elsif new.status = 'SHIPPED' and v_shipped <> v_quantity then
      raise exception 'Sales order % is not fully shipped', old.so_number using errcode = 'SF007';
    end if;
  end if;

  return new;
end;
$$;

create trigger sales_orders_enforce_rules
  before insert or update on public.sales_orders
  for each row execute function private.enforce_sales_order_rules();

-- -----------------------------------------------------------------------------
-- Trigger: lines are frozen after DRAFT; only the shipped quantity may change
-- while the order is being shipped (PROCESSING) or reversed (SHIPPED).
-- -----------------------------------------------------------------------------
create or replace function private.enforce_sales_order_item_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so public.sales_orders;
begin
  select so.* into v_so
  from public.sales_orders so
  where so.id = coalesce(new.sales_order_id, old.sales_order_id);

  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and (new.sales_order_id, new.line_number, new.product_id, new.quantity, new.unit_price, new.discount_percent)
         is not distinct from
         (old.sales_order_id, old.line_number, old.product_id, old.quantity, old.unit_price, old.discount_percent) then
    if new.quantity_shipped is distinct from old.quantity_shipped
       and v_so.status not in ('PROCESSING', 'SHIPPED') then
      raise exception 'Shipped quantities can only change while % is being shipped (it is %)', v_so.so_number, v_so.status
        using errcode = 'SF007';
    end if;
    return new;
  end if;

  if v_so.status <> 'DRAFT' then
    raise exception 'Lines of sales order % can only be changed while it is a draft (it is %)', v_so.so_number, v_so.status
      using errcode = 'SF007';
  end if;

  if tg_op = 'INSERT' and new.quantity_shipped <> 0 then
    raise exception 'New lines cannot have shipped quantities' using errcode = 'SF007';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger sales_order_items_enforce_rules
  before insert or update or delete on public.sales_order_items
  for each row execute function private.enforce_sales_order_item_rules();

-- -----------------------------------------------------------------------------
-- Lines helper: validates p_items and replaces the lines of a DRAFT order.
-- p_items: [{ "product_id": uuid, "quantity": int,
--             "unit_price": number|null, "discount_percent": number|null }]
-- Missing unit_price defaults to the product's sale price; discount to 0.
-- Line amounts and order totals are derived by generated columns and triggers.
-- -----------------------------------------------------------------------------
create or replace function private.replace_sales_order_items(p_so_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     jsonb;
  v_line     smallint := 0;
  v_product  public.products;
  v_qty      integer;
  v_price    numeric;
  v_discount numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A sales order needs at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'A sales order can have at most 200 lines' using errcode = '22023';
  end if;

  delete from public.sales_order_items where sales_order_id = p_so_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;

    if coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Line %: choose a product', v_line using errcode = '22023';
    end if;
    select p.* into v_product from public.products p where p.id = (v_item ->> 'product_id')::uuid;
    if not found then
      raise exception 'Line %: product not found', v_line using errcode = 'P0002';
    end if;
    if not v_product.is_active then
      raise exception 'Line %: product % is inactive', v_line, v_product.sku using errcode = '22023';
    end if;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,7}$' or (v_item ->> 'quantity')::integer < 1 then
      raise exception 'Line % (%): quantity must be a whole number of 1 or more', v_line, v_product.sku
        using errcode = '22023';
    end if;
    v_qty := (v_item ->> 'quantity')::integer;

    if v_item ->> 'unit_price' is null then
      v_price := v_product.sale_price;
    elsif (v_item ->> 'unit_price') ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
      v_price := (v_item ->> 'unit_price')::numeric;
    else
      raise exception 'Line % (%): unit price must be 0 or more with up to 2 decimals', v_line, v_product.sku
        using errcode = '22023';
    end if;

    if v_item ->> 'discount_percent' is null then
      v_discount := 0;
    elsif (v_item ->> 'discount_percent') ~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
          and (v_item ->> 'discount_percent')::numeric <= 100 then
      v_discount := (v_item ->> 'discount_percent')::numeric;
    else
      raise exception 'Line % (%): discount must be between 0 and 100%%', v_line, v_product.sku
        using errcode = '22023';
    end if;

    if exists (select 1 from public.sales_order_items i where i.sales_order_id = p_so_id and i.product_id = v_product.id) then
      raise exception 'Line %: % appears more than once', v_line, v_product.sku using errcode = '22023';
    end if;

    insert into public.sales_order_items (sales_order_id, line_number, product_id, quantity, unit_price, discount_percent)
    values (p_so_id, v_line, v_product.id, v_qty, v_price, v_discount);
  end loop;
end;
$$;

create or replace function private.validate_sales_order_header(
  p_customer_id             uuid,
  p_warehouse_id            uuid,
  p_order_date              date,
  p_requested_delivery_date date
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.is_active) then
    raise exception 'Choose an active customer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_id and w.is_active) then
    raise exception 'Choose an active warehouse' using errcode = '22023';
  end if;
  if p_order_date is null or p_order_date > private.business_date() then
    raise exception 'Order date cannot be in the future' using errcode = '22023';
  end if;
  if p_requested_delivery_date < p_order_date then
    raise exception 'Requested delivery cannot be before the order date' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.lock_sales_order(p_so_id uuid)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so public.sales_orders;
begin
  select so.* into v_so from public.sales_orders so where so.id = p_so_id for update;
  if not found then
    raise exception 'Sales order % not found', p_so_id using errcode = 'P0002';
  end if;
  return v_so;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: draft, edit, confirm, processing, complete, cancel
-- -----------------------------------------------------------------------------
create or replace function public.create_sales_order(
  p_customer_id             uuid,
  p_warehouse_id            uuid,
  p_items                   jsonb,
  p_order_date              date default null,
  p_requested_delivery_date date default null,
  p_notes                   text default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so public.sales_orders;
begin
  perform private.assert_any_role('create sales orders', 'admin', 'sales');
  perform private.validate_sales_order_header(
    p_customer_id, p_warehouse_id, coalesce(p_order_date, private.business_date()), p_requested_delivery_date);

  insert into public.sales_orders (customer_id, warehouse_id, order_date, requested_delivery_date, notes, created_by)
  values (p_customer_id, p_warehouse_id, coalesce(p_order_date, private.business_date()), p_requested_delivery_date,
          nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_so;

  perform private.replace_sales_order_items(v_so.id, p_items);
  select so.* into v_so from public.sales_orders so where so.id = v_so.id;

  perform private.write_audit('SO_CREATE', 'sales_orders', v_so.id::text,
    jsonb_build_object('so_number', v_so.so_number, 'total_amount', v_so.total_amount, 'lines', jsonb_array_length(p_items)),
    null, to_jsonb(v_so));
  return v_so;
end;
$$;

create or replace function public.update_sales_order(
  p_so_id                   uuid,
  p_customer_id             uuid,
  p_warehouse_id            uuid,
  p_items                   jsonb,
  p_order_date              date default null,
  p_requested_delivery_date date default null,
  p_notes                   text default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.sales_orders;
  v_so  public.sales_orders;
begin
  perform private.assert_any_role('edit sales orders', 'admin', 'sales');
  v_old := private.lock_sales_order(p_so_id);
  if v_old.status <> 'DRAFT' then
    raise exception 'Sales order % is % and can no longer be edited', v_old.so_number, v_old.status
      using errcode = 'SF007';
  end if;
  perform private.validate_sales_order_header(
    p_customer_id, p_warehouse_id, coalesce(p_order_date, v_old.order_date), p_requested_delivery_date);

  update public.sales_orders
     set customer_id = p_customer_id,
         warehouse_id = p_warehouse_id,
         order_date = coalesce(p_order_date, v_old.order_date),
         requested_delivery_date = p_requested_delivery_date,
         notes = nullif(btrim(p_notes), '')
   where id = p_so_id;

  perform private.replace_sales_order_items(p_so_id, p_items);
  select so.* into v_so from public.sales_orders so where so.id = p_so_id;

  perform private.write_audit('SO_UPDATE', 'sales_orders', v_so.id::text,
    jsonb_build_object('so_number', v_so.so_number, 'total_amount', v_so.total_amount, 'lines', jsonb_array_length(p_items)),
    to_jsonb(v_old), to_jsonb(v_so));
  return v_so;
end;
$$;

create or replace function public.confirm_sales_order(p_so_id uuid)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so public.sales_orders;
begin
  perform private.assert_any_role('confirm sales orders', 'admin', 'sales');
  v_so := private.lock_sales_order(p_so_id);
  if v_so.status <> 'DRAFT' then
    raise exception 'Only draft sales orders can be confirmed (% is %)', v_so.so_number, v_so.status
      using errcode = 'SF007';
  end if;
  if not exists (select 1 from public.customers c where c.id = v_so.customer_id and c.is_active) then
    raise exception 'The customer of % is inactive', v_so.so_number using errcode = '22023';
  end if;

  update public.sales_orders set status = 'CONFIRMED', confirmed_at = now()
   where id = p_so_id returning * into v_so;

  perform private.write_audit('SO_CONFIRM', 'sales_orders', v_so.id::text,
    jsonb_build_object('so_number', v_so.so_number, 'total_amount', v_so.total_amount));
  return v_so;
end;
$$;

create or replace function public.start_processing_sales_order(p_so_id uuid)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so public.sales_orders;
begin
  perform private.assert_any_role('process sales orders', 'admin', 'warehouse_manager');
  v_so := private.lock_sales_order(p_so_id);
  if v_so.status <> 'CONFIRMED' then
    raise exception 'Only confirmed sales orders can move to processing (% is %)', v_so.so_number, v_so.status
      using errcode = 'SF007';
  end if;

  update public.sales_orders
     set status = 'PROCESSING', processing_started_at = now(), processing_started_by = auth.uid()
   where id = p_so_id
  returning * into v_so;

  perform private.write_audit('SO_PROCESS', 'sales_orders', v_so.id::text, jsonb_build_object('so_number', v_so.so_number));
  return v_so;
end;
$$;

create or replace function public.complete_sales_order(p_so_id uuid)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so public.sales_orders;
begin
  perform private.assert_any_role('complete sales orders', 'admin', 'sales', 'warehouse_manager');
  v_so := private.lock_sales_order(p_so_id);
  if v_so.status <> 'SHIPPED' then
    raise exception 'Only shipped sales orders can be completed (% is %)', v_so.so_number, v_so.status
      using errcode = 'SF007';
  end if;

  update public.sales_orders set status = 'COMPLETED', completed_at = now()
   where id = p_so_id returning * into v_so;

  perform private.write_audit('SO_COMPLETE', 'sales_orders', v_so.id::text, jsonb_build_object('so_number', v_so.so_number));
  return v_so;
end;
$$;

-- Cancelling never touches inventory: it is only allowed while nothing has shipped.
create or replace function public.cancel_sales_order(p_so_id uuid, p_reason text)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so     public.sales_orders;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform private.assert_any_role('cancel sales orders', 'admin', 'sales');
  if v_reason is null then
    raise exception 'A reason is required to cancel a sales order' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)' using errcode = '22023';
  end if;

  v_so := private.lock_sales_order(p_so_id);
  if v_so.status in ('SHIPPED', 'COMPLETED') then
    raise exception 'Sales order % has been shipped and cannot be cancelled; reverse the shipment first', v_so.so_number
      using errcode = 'SF009';
  end if;
  if v_so.status = 'CANCELLED' then
    raise exception 'Sales order % is already cancelled', v_so.so_number using errcode = 'SF007';
  end if;

  update public.sales_orders
     set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = p_so_id
  returning * into v_so;

  perform private.write_audit('SO_CANCEL', 'sales_orders', v_so.id::text,
    jsonb_build_object('so_number', v_so.so_number, 'reason', v_reason));
  return v_so;
end;
$$;

-- -----------------------------------------------------------------------------
-- ship_sales_order: all-or-nothing shipment.
--   1. lock the order, then every stock row it needs, in product order
--      (a fixed order means two shipments sharing products cannot deadlock);
--   2. check EVERY line; if any is short, raise one error naming every short
--      product - nothing has been written yet;
--   3. post one SALE per line through create_stock_movement (which re-checks).
-- p_shipped_at: business ship date/time (default now), not before the order date.
-- -----------------------------------------------------------------------------
create or replace function public.ship_sales_order(p_so_id uuid, p_shipped_at timestamptz default null)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so         public.sales_orders;
  v_line       record;
  v_shortages  text;
  v_shipped_at timestamptz := coalesce(p_shipped_at, now());
  v_total_qty  integer := 0;
  v_lines      integer := 0;
begin
  perform private.assert_any_role('ship sales orders', 'admin', 'warehouse_manager');

  v_so := private.lock_sales_order(p_so_id);
  if v_so.status <> 'PROCESSING' then
    raise exception 'Only sales orders in processing can be shipped (% is %)', v_so.so_number, v_so.status
      using errcode = 'SF007';
  end if;
  if v_shipped_at > now() + interval '5 minutes' then
    raise exception 'Ship date cannot be in the future' using errcode = '22023';
  end if;
  if private.business_date(v_shipped_at) < v_so.order_date then
    raise exception 'Ship date cannot be before the order date' using errcode = '22023';
  end if;

  perform 1
  from public.inventory inv
  where inv.warehouse_id = v_so.warehouse_id
    and inv.product_id in (select i.product_id from public.sales_order_items i where i.sales_order_id = v_so.id)
  order by inv.product_id
  for update;

  select string_agg(
           format('%s %s (need %s, available %s)', p.sku, p.name, i.quantity, coalesce(inv.quantity, 0)),
           '; ' order by i.line_number)
    into v_shortages
  from public.sales_order_items i
  join public.products p on p.id = i.product_id
  left join public.inventory inv on inv.product_id = i.product_id and inv.warehouse_id = v_so.warehouse_id
  where i.sales_order_id = v_so.id
    and i.quantity > coalesce(inv.quantity, 0);

  if v_shortages is not null then
    raise exception 'Cannot ship %: insufficient stock for %', v_so.so_number, v_shortages
      using errcode = 'SF001';
  end if;

  -- Mark the shipment first: the stock_movements guard only accepts SALES_ORDER
  -- movements for an order whose shipment is posted in this transaction.
  update public.sales_orders
     set shipment_posted_at = now(), shipped_by = auth.uid()
   where id = v_so.id;

  for v_line in
    select i.id, i.line_number, i.product_id, i.quantity
    from public.sales_order_items i
    where i.sales_order_id = v_so.id
    order by i.product_id
  loop
    perform public.create_stock_movement(
      p_product_id       => v_line.product_id,
      p_warehouse_id     => v_so.warehouse_id,
      p_movement_type    => 'SALE',
      p_quantity         => v_line.quantity,
      p_reference_type   => 'SALES_ORDER',
      p_reference_id     => v_so.id,
      p_reference_number => v_so.so_number,
      p_notes            => format('%s line %s', v_so.so_number, v_line.line_number),
      p_movement_date    => v_shipped_at
    );
    update public.sales_order_items set quantity_shipped = quantity where id = v_line.id;
    v_total_qty := v_total_qty + v_line.quantity;
    v_lines := v_lines + 1;
  end loop;

  update public.sales_orders set status = 'SHIPPED', shipped_at = v_shipped_at
   where id = v_so.id
  returning * into v_so;

  perform private.write_audit('SO_SHIP', 'sales_orders', v_so.id::text,
    jsonb_build_object('so_number', v_so.so_number, 'lines', v_lines, 'quantity', v_total_qty, 'shipped_at', v_shipped_at));
  return v_so;
end;
$$;

-- -----------------------------------------------------------------------------
-- reverse_sales_order_shipment: puts the stock back through reverse_stock_movement
-- (one reversal per SALE line) and returns the order to CONFIRMED, from where it
-- can be processed again or cancelled. History is kept.
-- -----------------------------------------------------------------------------
create or replace function public.reverse_sales_order_shipment(p_so_id uuid, p_reason text)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so       public.sales_orders;
  v_reason   text := nullif(btrim(p_reason), '');
  v_movement uuid;
  v_count    integer := 0;
begin
  perform private.assert_any_role('reverse shipments', 'admin', 'warehouse_manager');
  if v_reason is null then
    raise exception 'A reason is required to reverse a shipment' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)' using errcode = '22023';
  end if;

  v_so := private.lock_sales_order(p_so_id);
  if v_so.status <> 'SHIPPED' then
    raise exception 'Only shipped sales orders can have their shipment reversed (% is %)', v_so.so_number, v_so.status
      using errcode = 'SF007';
  end if;

  -- Mark first: the stock_movements guard only allows reversing sales movements
  -- of an order whose shipment is reversed in this transaction.
  update public.sales_orders
     set shipment_reversed_at = now(), shipment_reversed_by = auth.uid(), shipment_reversal_reason = v_reason
   where id = v_so.id;

  for v_movement in
    select m.id
    from public.stock_movements m
    where m.reference_type = 'SALES_ORDER'
      and m.reference_id = v_so.id
      and m.movement_type = 'SALE'
      and not exists (select 1 from public.stock_movements r where r.reversal_of_id = m.id)
    order by m.product_id
  loop
    perform public.reverse_stock_movement(v_movement, v_reason);
    v_count := v_count + 1;
  end loop;

  update public.sales_order_items set quantity_shipped = 0 where sales_order_id = v_so.id;
  update public.sales_orders
     set status = 'CONFIRMED', shipped_at = null, shipped_by = null,
         processing_started_at = null, processing_started_by = null
   where id = v_so.id
  returning * into v_so;

  perform private.write_audit('SO_SHIPMENT_REVERSAL', 'sales_orders', v_so.id::text,
    jsonb_build_object('so_number', v_so.so_number, 'reason', v_reason, 'movements_reversed', v_count));
  return v_so;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reporting views
-- -----------------------------------------------------------------------------
create view public.sales_order_overview
with (security_invoker = true)
as
select
  so.id,
  so.so_number,
  so.status,
  so.customer_id,
  c.code                   as customer_code,
  c.name                   as customer_name,
  c.customer_type,
  so.warehouse_id,
  w.code                   as warehouse_code,
  w.name                   as warehouse_name,
  so.order_date,
  so.requested_delivery_date,
  so.currency,
  so.subtotal,
  so.discount_amount,
  so.total_amount,
  so.notes,
  coalesce(l.line_count, 0)       as line_count,
  coalesce(l.quantity, 0)         as quantity,
  coalesce(l.quantity_shipped, 0) as quantity_shipped,
  so.created_by,
  cb.full_name             as created_by_name,
  so.confirmed_at,
  so.processing_started_at,
  so.shipped_at,
  sb.full_name             as shipped_by_name,
  so.completed_at,
  so.cancelled_at,
  so.cancel_reason,
  so.shipment_reversed_at,
  so.shipment_reversal_reason,
  so.created_at,
  so.updated_at
from public.sales_orders so
join public.customers c  on c.id = so.customer_id
join public.warehouses w on w.id = so.warehouse_id
left join public.profiles cb on cb.id = so.created_by
left join public.profiles sb on sb.id = so.shipped_by
left join lateral (
  select count(*)::integer as line_count,
         sum(i.quantity)::integer as quantity,
         sum(i.quantity_shipped)::integer as quantity_shipped
  from public.sales_order_items i
  where i.sales_order_id = so.id
) l on true;

-- Customers with their sales figures.
--   total_sales_value: shipped or completed orders (what the customer actually bought).
--   open orders:       confirmed or processing (committed, not yet shipped).
create view public.customer_sales_summary
with (security_invoker = true)
as
select
  c.id                      as customer_id,
  c.code,
  c.name,
  c.customer_type,
  c.contact_name,
  c.email,
  c.phone,
  c.city,
  c.country,
  c.credit_limit,
  c.payment_terms_days,
  c.is_active,
  c.created_at,
  coalesce(o.order_count, 0)       as order_count,
  coalesce(o.total_sales_value, 0) as total_sales_value,
  o.last_order_date,
  coalesce(o.open_count, 0)        as open_count,
  coalesce(o.open_value, 0)        as open_value
from public.customers c
left join lateral (
  select
    (count(*) filter (where s.status <> 'CANCELLED'))::integer                          as order_count,
    sum(s.total_amount) filter (where s.status in ('SHIPPED', 'COMPLETED'))             as total_sales_value,
    max(s.order_date) filter (where s.status <> 'CANCELLED')                            as last_order_date,
    (count(*) filter (where s.status in ('CONFIRMED', 'PROCESSING')))::integer          as open_count,
    sum(s.total_amount) filter (where s.status in ('CONFIRMED', 'PROCESSING'))          as open_value
  from public.sales_orders s
  where s.customer_id = c.id
) o on true;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.sales_order_overview, public.customer_sales_summary from public, anon, authenticated;
grant select on public.sales_order_overview, public.customer_sales_summary to authenticated, service_role;

revoke execute on function private.enforce_sales_order_rules() from public;
revoke execute on function private.enforce_sales_order_item_rules() from public;
revoke execute on function private.replace_sales_order_items(uuid, jsonb) from public;
revoke execute on function private.validate_sales_order_header(uuid, uuid, date, date) from public;
revoke execute on function private.lock_sales_order(uuid) from public;

revoke execute on function public.create_sales_order(uuid, uuid, jsonb, date, date, text) from public, anon;
revoke execute on function public.update_sales_order(uuid, uuid, uuid, jsonb, date, date, text) from public, anon;
revoke execute on function public.confirm_sales_order(uuid) from public, anon;
revoke execute on function public.start_processing_sales_order(uuid) from public, anon;
revoke execute on function public.complete_sales_order(uuid) from public, anon;
revoke execute on function public.cancel_sales_order(uuid, text) from public, anon;
revoke execute on function public.ship_sales_order(uuid, timestamptz) from public, anon;
revoke execute on function public.reverse_sales_order_shipment(uuid, text) from public, anon;

grant execute on function public.create_sales_order(uuid, uuid, jsonb, date, date, text) to authenticated;
grant execute on function public.update_sales_order(uuid, uuid, uuid, jsonb, date, date, text) to authenticated;
grant execute on function public.confirm_sales_order(uuid) to authenticated;
grant execute on function public.start_processing_sales_order(uuid) to authenticated;
grant execute on function public.complete_sales_order(uuid) to authenticated;
grant execute on function public.cancel_sales_order(uuid, text) to authenticated;
grant execute on function public.ship_sales_order(uuid, timestamptz) to authenticated;
grant execute on function public.reverse_sales_order_shipment(uuid, text) to authenticated;
