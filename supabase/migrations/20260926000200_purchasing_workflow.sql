-- =============================================================================
-- StockFlow ERP - 10 Purchasing workflow
--
--   DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED
--     \          \            \
--      +----------+------------+--> CANCELLED   (only while nothing is received)
--
-- RPCs (all writes to purchase orders and goods receipts go through these):
--   create_purchase_order / update_purchase_order / submit_purchase_order  admin, purchasing
--   approve_purchase_order                                                 admin
--   cancel_purchase_order                                                  admin, purchasing
--   receive_goods / reverse_goods_receipt                                  admin, warehouse_manager
--
-- receive_goods posts one PURCHASE_RECEIPT per line through create_stock_movement;
-- reverse_goods_receipt undoes a receipt through reverse_stock_movement. Neither
-- touches inventory itself.
--
-- The rules are enforced by triggers as well, so no code path can skip them:
--   * purchase_orders: only valid status transitions, received quantities must
--     match the status, header frozen after DRAFT.
--   * purchase_order_items: lines frozen after DRAFT (except received quantity).
--   * stock_movements: goods-receipt movements can only be posted / reversed in
--     the same transaction that creates / reverses the receipt.
--
-- Custom SQLSTATEs: SF006 over-receipt, SF007 invalid status / not editable,
--   SF008 document movement outside its workflow, SF009 cancel after receipt,
--   SF010 receipt already reversed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.goods_receipts
  add column reversed_at     timestamptz,
  add column reversed_by     uuid references public.profiles (id),
  add column reversal_reason text,
  add constraint goods_receipts_reversal_consistency
    check ((reversed_at is null) = (reversal_reason is null));

create index goods_receipts_reversed_by_idx on public.goods_receipts (reversed_by);
create index purchase_orders_submitted_at_idx on public.purchase_orders (submitted_at);

alter table public.purchase_orders
  add constraint purchase_orders_approval_consistency
    check (approved_at is null or status in ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'));

-- -----------------------------------------------------------------------------
-- Business calendar: order and receipt dates are Israel dates, while the
-- database clock is UTC. Between 00:00 and ~03:00 Israel time the two differ.
-- -----------------------------------------------------------------------------
create or replace function private.business_date(p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Jerusalem')::date;
$$;

-- -----------------------------------------------------------------------------
-- Role helper
-- -----------------------------------------------------------------------------
create or replace function private.assert_any_role(p_action text, variadic p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(variadic p_roles) then
    raise exception 'You do not have permission to %', p_action using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger: purchase order status machine and frozen header
-- -----------------------------------------------------------------------------
create or replace function private.enforce_purchase_order_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transition text;
  v_ordered    bigint;
  v_received   bigint;
  v_lines      integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then
      raise exception 'New purchase orders start as DRAFT' using errcode = 'SF007';
    end if;
    return new;
  end if;

  if old.status <> 'DRAFT'
     and (new.po_number, new.supplier_id, new.warehouse_id, new.order_date, new.expected_delivery_date, new.currency)
         is distinct from
         (old.po_number, old.supplier_id, old.warehouse_id, old.order_date, old.expected_delivery_date, old.currency) then
    raise exception 'Purchase order % is % and can no longer be edited', old.po_number, old.status
      using errcode = 'SF007';
  end if;

  if new.status is distinct from old.status then
    v_transition := old.status::text || '>' || new.status::text;
    if not v_transition = any (array[
      'DRAFT>SUBMITTED', 'DRAFT>CANCELLED',
      'SUBMITTED>APPROVED', 'SUBMITTED>CANCELLED',
      'APPROVED>PARTIALLY_RECEIVED', 'APPROVED>RECEIVED', 'APPROVED>CANCELLED',
      'PARTIALLY_RECEIVED>RECEIVED',
      -- after a goods receipt is reversed:
      'PARTIALLY_RECEIVED>APPROVED', 'RECEIVED>PARTIALLY_RECEIVED', 'RECEIVED>APPROVED'
    ]) then
      raise exception 'Purchase order % cannot go from % to %', old.po_number, old.status, new.status
        using errcode = 'SF007';
    end if;

    select count(*), coalesce(sum(i.quantity_ordered), 0), coalesce(sum(i.quantity_received), 0)
      into v_lines, v_ordered, v_received
    from public.purchase_order_items i
    where i.purchase_order_id = new.id;

    if new.status = 'SUBMITTED' and v_lines = 0 then
      raise exception 'Purchase order % has no lines', old.po_number using errcode = 'SF007';
    elsif new.status in ('APPROVED', 'CANCELLED') and v_received > 0 then
      raise exception 'Purchase order % has received goods; reverse the goods receipts first', old.po_number
        using errcode = 'SF009';
    elsif new.status = 'PARTIALLY_RECEIVED' and not (v_received > 0 and v_received < v_ordered) then
      raise exception 'Purchase order % is not partially received', old.po_number using errcode = 'SF007';
    elsif new.status = 'RECEIVED' and v_received <> v_ordered then
      raise exception 'Purchase order % is not fully received', old.po_number using errcode = 'SF007';
    end if;
  end if;

  return new;
end;
$$;

create trigger purchase_orders_enforce_rules
  before insert or update on public.purchase_orders
  for each row execute function private.enforce_purchase_order_rules();

-- -----------------------------------------------------------------------------
-- Trigger: lines are frozen after DRAFT; only the received quantity may change
-- while goods are being received.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_purchase_order_item_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  select po.* into v_po
  from public.purchase_orders po
  where po.id = coalesce(new.purchase_order_id, old.purchase_order_id);

  -- The purchase order itself is being deleted (cascade).
  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and (new.purchase_order_id, new.line_number, new.product_id, new.quantity_ordered, new.unit_cost)
         is not distinct from
         (old.purchase_order_id, old.line_number, old.product_id, old.quantity_ordered, old.unit_cost) then
    if new.quantity_received is distinct from old.quantity_received
       and v_po.status not in ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED') then
      raise exception 'Goods can only be received on approved purchase orders (% is %)', v_po.po_number, v_po.status
        using errcode = 'SF007';
    end if;
    return new;
  end if;

  if v_po.status <> 'DRAFT' then
    raise exception 'Lines of purchase order % can only be changed while it is a draft (it is %)', v_po.po_number, v_po.status
      using errcode = 'SF007';
  end if;

  if tg_op = 'INSERT' and new.quantity_received <> 0 then
    raise exception 'New lines cannot have received quantities' using errcode = 'SF007';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger purchase_order_items_enforce_rules
  before insert or update or delete on public.purchase_order_items
  for each row execute function private.enforce_purchase_order_item_rules();

-- -----------------------------------------------------------------------------
-- Trigger: goods-receipt movements only inside their workflow.
-- now() is the transaction start time, so "created_at = now()" means "created
-- in this transaction". Clients cannot write goods_receipts, so only
-- receive_goods / reverse_goods_receipt can satisfy these checks.
-- -----------------------------------------------------------------------------
create or replace function private.guard_document_movements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.stock_movements;
  v_receipt  public.goods_receipts;
begin
  if new.reference_type = 'PURCHASE_ORDER' then
    raise exception 'Purchase receipts are posted by receive_goods and reference the goods receipt'
      using errcode = 'SF008';
  end if;

  if new.reference_type = 'GOODS_RECEIPT' then
    select g.* into v_receipt from public.goods_receipts g where g.id = new.reference_id;
    if not found or v_receipt.created_at <> now() or v_receipt.reversed_at is not null then
      raise exception 'Stock for a goods receipt can only be posted by receive_goods'
        using errcode = 'SF008';
    end if;
  end if;

  if new.reversal_of_id is not null then
    select m.* into v_original from public.stock_movements m where m.id = new.reversal_of_id;
    if v_original.reference_type = 'GOODS_RECEIPT' then
      select g.* into v_receipt from public.goods_receipts g where g.id = v_original.reference_id;
      if v_receipt.reversed_at is distinct from now() then
        raise exception 'Movement % belongs to goods receipt %; reverse the goods receipt instead',
          v_original.movement_number, v_receipt.receipt_number
          using errcode = 'SF008';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger stock_movements_guard_documents
  before insert on public.stock_movements
  for each row execute function private.guard_document_movements();

-- -----------------------------------------------------------------------------
-- Lines helper: validates p_items and replaces the lines of a DRAFT order.
-- p_items: [{ "product_id": uuid, "quantity": int, "unit_cost": number|null }]
-- A missing unit_cost defaults to the product's cost price.
-- -----------------------------------------------------------------------------
create or replace function private.replace_purchase_order_items(p_po_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_line    smallint := 0;
  v_product public.products;
  v_qty     integer;
  v_cost    numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A purchase order needs at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'A purchase order can have at most 200 lines' using errcode = '22023';
  end if;

  delete from public.purchase_order_items where purchase_order_id = p_po_id;

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

    if v_item ->> 'unit_cost' is null then
      v_cost := v_product.cost_price;
    elsif (v_item ->> 'unit_cost') ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
      v_cost := (v_item ->> 'unit_cost')::numeric;
    else
      raise exception 'Line % (%): unit cost must be 0 or more with up to 2 decimals', v_line, v_product.sku
        using errcode = '22023';
    end if;

    if exists (select 1 from public.purchase_order_items i
               where i.purchase_order_id = p_po_id and i.product_id = v_product.id) then
      raise exception 'Line %: % appears more than once', v_line, v_product.sku using errcode = '22023';
    end if;

    insert into public.purchase_order_items (purchase_order_id, line_number, product_id, quantity_ordered, unit_cost)
    values (p_po_id, v_line, v_product.id, v_qty, v_cost);
  end loop;
end;
$$;

-- Header validation shared by create and update.
create or replace function private.validate_purchase_order_header(
  p_supplier_id            uuid,
  p_warehouse_id           uuid,
  p_order_date             date,
  p_expected_delivery_date date
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.is_active) then
    raise exception 'Choose an active supplier' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_id and w.is_active) then
    raise exception 'Choose an active warehouse' using errcode = '22023';
  end if;
  if p_order_date is null or p_order_date > private.business_date() then
    raise exception 'Order date cannot be in the future' using errcode = '22023';
  end if;
  if p_expected_delivery_date < p_order_date then
    raise exception 'Expected delivery cannot be before the order date' using errcode = '22023';
  end if;
end;
$$;

-- Locks a purchase order for a workflow step and returns it.
create or replace function private.lock_purchase_order(p_po_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  select po.* into v_po from public.purchase_orders po where po.id = p_po_id for update;
  if not found then
    raise exception 'Purchase order % not found', p_po_id using errcode = 'P0002';
  end if;
  return v_po;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: draft, edit, submit, approve, cancel
-- -----------------------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_supplier_id            uuid,
  p_warehouse_id           uuid,
  p_items                  jsonb,
  p_order_date             date default null,
  p_expected_delivery_date date default null,
  p_notes                  text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  perform private.assert_any_role('create purchase orders', 'admin', 'purchasing');
  perform private.validate_purchase_order_header(
    p_supplier_id, p_warehouse_id, coalesce(p_order_date, private.business_date()), p_expected_delivery_date);

  insert into public.purchase_orders (supplier_id, warehouse_id, order_date, expected_delivery_date, notes, created_by)
  values (p_supplier_id, p_warehouse_id, coalesce(p_order_date, private.business_date()), p_expected_delivery_date,
          nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_po;

  perform private.replace_purchase_order_items(v_po.id, p_items);
  select po.* into v_po from public.purchase_orders po where po.id = v_po.id;

  perform private.write_audit('PO_CREATE', 'purchase_orders', v_po.id::text,
    jsonb_build_object('po_number', v_po.po_number, 'total_amount', v_po.total_amount, 'lines', jsonb_array_length(p_items)),
    null, to_jsonb(v_po));
  return v_po;
end;
$$;

create or replace function public.update_purchase_order(
  p_po_id                  uuid,
  p_supplier_id            uuid,
  p_warehouse_id           uuid,
  p_items                  jsonb,
  p_order_date             date default null,
  p_expected_delivery_date date default null,
  p_notes                  text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.purchase_orders;
  v_po  public.purchase_orders;
begin
  perform private.assert_any_role('edit purchase orders', 'admin', 'purchasing');
  v_old := private.lock_purchase_order(p_po_id);
  if v_old.status <> 'DRAFT' then
    raise exception 'Purchase order % is % and can no longer be edited', v_old.po_number, v_old.status
      using errcode = 'SF007';
  end if;
  perform private.validate_purchase_order_header(
    p_supplier_id, p_warehouse_id, coalesce(p_order_date, v_old.order_date), p_expected_delivery_date);

  update public.purchase_orders
     set supplier_id = p_supplier_id,
         warehouse_id = p_warehouse_id,
         order_date = coalesce(p_order_date, v_old.order_date),
         expected_delivery_date = p_expected_delivery_date,
         notes = nullif(btrim(p_notes), '')
   where id = p_po_id;

  perform private.replace_purchase_order_items(p_po_id, p_items);
  select po.* into v_po from public.purchase_orders po where po.id = p_po_id;

  perform private.write_audit('PO_UPDATE', 'purchase_orders', v_po.id::text,
    jsonb_build_object('po_number', v_po.po_number, 'total_amount', v_po.total_amount, 'lines', jsonb_array_length(p_items)),
    to_jsonb(v_old), to_jsonb(v_po));
  return v_po;
end;
$$;

create or replace function public.submit_purchase_order(p_po_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  perform private.assert_any_role('submit purchase orders', 'admin', 'purchasing');
  v_po := private.lock_purchase_order(p_po_id);
  if v_po.status <> 'DRAFT' then
    raise exception 'Only draft purchase orders can be submitted (% is %)', v_po.po_number, v_po.status
      using errcode = 'SF007';
  end if;

  update public.purchase_orders set status = 'SUBMITTED', submitted_at = now()
   where id = p_po_id returning * into v_po;

  perform private.write_audit('PO_SUBMIT', 'purchase_orders', v_po.id::text,
    jsonb_build_object('po_number', v_po.po_number, 'total_amount', v_po.total_amount));
  return v_po;
end;
$$;

create or replace function public.approve_purchase_order(p_po_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  perform private.assert_any_role('approve purchase orders', 'admin');
  v_po := private.lock_purchase_order(p_po_id);
  if v_po.status <> 'SUBMITTED' then
    raise exception 'Only submitted purchase orders can be approved (% is %)', v_po.po_number, v_po.status
      using errcode = 'SF007';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = v_po.supplier_id and s.is_active) then
    raise exception 'The supplier of % is inactive', v_po.po_number using errcode = '22023';
  end if;

  update public.purchase_orders
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_po_id
  returning * into v_po;

  perform private.write_audit('PO_APPROVE', 'purchase_orders', v_po.id::text,
    jsonb_build_object('po_number', v_po.po_number, 'total_amount', v_po.total_amount));
  return v_po;
end;
$$;

-- Cancelling never touches inventory: it is only allowed while nothing has been received.
create or replace function public.cancel_purchase_order(p_po_id uuid, p_reason text)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po     public.purchase_orders;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform private.assert_any_role('cancel purchase orders', 'admin', 'purchasing');
  if v_reason is null then
    raise exception 'A reason is required to cancel a purchase order' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)' using errcode = '22023';
  end if;

  v_po := private.lock_purchase_order(p_po_id);
  if v_po.status in ('PARTIALLY_RECEIVED', 'RECEIVED')
     or exists (select 1 from public.purchase_order_items i where i.purchase_order_id = p_po_id and i.quantity_received > 0) then
    raise exception 'Purchase order % has received goods and cannot be cancelled; reverse its goods receipts first', v_po.po_number
      using errcode = 'SF009';
  end if;
  if v_po.status = 'CANCELLED' then
    raise exception 'Purchase order % is already cancelled', v_po.po_number using errcode = 'SF007';
  end if;

  update public.purchase_orders
     set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = p_po_id
  returning * into v_po;

  perform private.write_audit('PO_CANCEL', 'purchase_orders', v_po.id::text,
    jsonb_build_object('po_number', v_po.po_number, 'reason', v_reason));
  return v_po;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status from received quantities (used after receipts and reversals).
-- -----------------------------------------------------------------------------
create or replace function private.purchase_order_receipt_status(p_po_id uuid)
returns public.purchase_order_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(sum(i.quantity_received), 0) = 0 then 'APPROVED'
    when sum(i.quantity_received) = sum(i.quantity_ordered) then 'RECEIVED'
    else 'PARTIALLY_RECEIVED'
  end::public.purchase_order_status
  from public.purchase_order_items i
  where i.purchase_order_id = p_po_id;
$$;

-- -----------------------------------------------------------------------------
-- receive_goods: one goods receipt, one PURCHASE_RECEIPT movement per line.
-- p_items: [{ "purchase_order_item_id": uuid, "quantity": int }]
-- The PO row lock serialises concurrent receipts for the same order: a second
-- receiver waits, then sees the updated received quantities.
-- -----------------------------------------------------------------------------
create or replace function public.receive_goods(
  p_po_id       uuid,
  p_items       jsonb,
  p_notes       text default null,
  p_received_at timestamptz default null
)
returns public.goods_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po          public.purchase_orders;
  v_receipt     public.goods_receipts;
  v_item        jsonb;
  v_line        public.purchase_order_items;
  v_sku         text;
  v_qty         integer;
  v_movement    public.stock_movements;
  v_gri_id      uuid;
  v_received_at timestamptz := coalesce(p_received_at, now());
  v_new_status  public.purchase_order_status;
  v_total_qty   integer := 0;
begin
  perform private.assert_any_role('receive goods', 'admin', 'warehouse_manager');

  v_po := private.lock_purchase_order(p_po_id);
  if v_po.status not in ('APPROVED', 'PARTIALLY_RECEIVED') then
    raise exception 'Goods can only be received on approved purchase orders (% is %)', v_po.po_number, v_po.status
      using errcode = 'SF007';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Enter a quantity for at least one line' using errcode = '22023';
  end if;
  if v_received_at > now() + interval '5 minutes' then
    raise exception 'Receipt date cannot be in the future' using errcode = '22023';
  end if;
  if private.business_date(v_received_at) < v_po.order_date then
    raise exception 'Receipt date cannot be before the order date' using errcode = '22023';
  end if;

  insert into public.goods_receipts (purchase_order_id, warehouse_id, received_by, received_at, notes)
  values (v_po.id, v_po.warehouse_id, auth.uid(), v_received_at, nullif(btrim(p_notes), ''))
  returning * into v_receipt;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item ->> 'purchase_order_item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid purchase order line' using errcode = '22023';
    end if;

    select i.* into v_line
    from public.purchase_order_items i
    where i.id = (v_item ->> 'purchase_order_item_id')::uuid
      and i.purchase_order_id = v_po.id
    for update;
    if not found then
      raise exception 'Line does not belong to purchase order %', v_po.po_number using errcode = '22023';
    end if;
    select p.sku into v_sku from public.products p where p.id = v_line.product_id;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,7}$' or (v_item ->> 'quantity')::integer < 1 then
      raise exception 'Line % (%): quantity must be a whole number of 1 or more', v_line.line_number, v_sku
        using errcode = '22023';
    end if;
    v_qty := (v_item ->> 'quantity')::integer;

    if exists (select 1 from public.goods_receipt_items g
               where g.goods_receipt_id = v_receipt.id and g.purchase_order_item_id = v_line.id) then
      raise exception 'Line % (%) appears more than once', v_line.line_number, v_sku using errcode = '22023';
    end if;

    if v_line.quantity_received + v_qty > v_line.quantity_ordered then
      raise exception 'Cannot receive % of line % (%): only % outstanding (% ordered, % already received)',
        v_qty, v_line.line_number, v_sku,
        v_line.quantity_ordered - v_line.quantity_received, v_line.quantity_ordered, v_line.quantity_received
        using errcode = 'SF006';
    end if;

    insert into public.goods_receipt_items (goods_receipt_id, purchase_order_item_id, product_id, quantity_received, unit_cost)
    values (v_receipt.id, v_line.id, v_line.product_id, v_qty, v_line.unit_cost)
    returning id into v_gri_id;

    -- The inventory engine does the locking, negative-stock check, ledger and audit.
    v_movement := public.create_stock_movement(
      p_product_id       => v_line.product_id,
      p_warehouse_id     => v_po.warehouse_id,
      p_movement_type    => 'PURCHASE_RECEIPT',
      p_quantity         => v_qty,
      p_reference_type   => 'GOODS_RECEIPT',
      p_reference_id     => v_receipt.id,
      p_reference_number => v_receipt.receipt_number,
      p_notes            => format('%s line %s', v_po.po_number, v_line.line_number),
      p_movement_date    => v_received_at,
      p_unit_cost        => v_line.unit_cost
    );

    update public.goods_receipt_items set stock_movement_id = v_movement.id where id = v_gri_id;
    update public.purchase_order_items set quantity_received = quantity_received + v_qty where id = v_line.id;
    v_total_qty := v_total_qty + v_qty;
  end loop;

  v_new_status := private.purchase_order_receipt_status(v_po.id);
  if v_new_status <> v_po.status then
    update public.purchase_orders set status = v_new_status where id = v_po.id;
  end if;

  perform private.write_audit('GOODS_RECEIPT', 'goods_receipts', v_receipt.id::text,
    jsonb_build_object(
      'receipt_number', v_receipt.receipt_number,
      'po_number',      v_po.po_number,
      'lines',          jsonb_array_length(p_items),
      'quantity',       v_total_qty,
      'po_status',      v_new_status
    ),
    null, to_jsonb(v_receipt));
  return v_receipt;
end;
$$;

-- -----------------------------------------------------------------------------
-- reverse_goods_receipt: undoes a whole receipt through reverse_stock_movement.
-- Rejected (and nothing changes) if the received stock has already been used.
-- -----------------------------------------------------------------------------
create or replace function public.reverse_goods_receipt(p_goods_receipt_id uuid, p_reason text)
returns public.goods_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt    public.goods_receipts;
  v_po         public.purchase_orders;
  v_item       public.goods_receipt_items;
  v_reason     text := nullif(btrim(p_reason), '');
  v_new_status public.purchase_order_status;
begin
  perform private.assert_any_role('reverse goods receipts', 'admin', 'warehouse_manager');
  if v_reason is null then
    raise exception 'A reason is required to reverse a goods receipt' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason is too long (500 characters max)' using errcode = '22023';
  end if;

  select g.* into v_receipt from public.goods_receipts g where g.id = p_goods_receipt_id for update;
  if not found then
    raise exception 'Goods receipt % not found', p_goods_receipt_id using errcode = 'P0002';
  end if;
  if v_receipt.reversed_at is not null then
    raise exception 'Goods receipt % was already reversed', v_receipt.receipt_number using errcode = 'SF010';
  end if;

  v_po := private.lock_purchase_order(v_receipt.purchase_order_id);

  -- Mark first: the stock_movements guard only allows reversing receipt
  -- movements for a receipt reversed in this transaction.
  update public.goods_receipts
     set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_reason
   where id = v_receipt.id
  returning * into v_receipt;

  for v_item in
    select g.* from public.goods_receipt_items g where g.goods_receipt_id = v_receipt.id order by g.created_at, g.id
  loop
    perform public.reverse_stock_movement(v_item.stock_movement_id, v_reason);
    update public.purchase_order_items
       set quantity_received = quantity_received - v_item.quantity_received
     where id = v_item.purchase_order_item_id;
  end loop;

  v_new_status := private.purchase_order_receipt_status(v_po.id);
  if v_new_status <> v_po.status then
    update public.purchase_orders set status = v_new_status where id = v_po.id;
  end if;

  perform private.write_audit('GOODS_RECEIPT_REVERSAL', 'goods_receipts', v_receipt.id::text,
    jsonb_build_object(
      'receipt_number', v_receipt.receipt_number,
      'po_number',      v_po.po_number,
      'reason',         v_reason,
      'po_status',      v_new_status
    ));
  return v_receipt;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reporting views (security_invoker: the caller's RLS applies)
-- -----------------------------------------------------------------------------
create view public.purchase_order_overview
with (security_invoker = true)
as
select
  po.id,
  po.po_number,
  po.status,
  po.supplier_id,
  s.code                  as supplier_code,
  s.name                  as supplier_name,
  po.warehouse_id,
  w.code                  as warehouse_code,
  w.name                  as warehouse_name,
  po.order_date,
  po.expected_delivery_date,
  po.currency,
  po.total_amount,
  po.notes,
  coalesce(l.line_count, 0)        as line_count,
  coalesce(l.quantity_ordered, 0)  as quantity_ordered,
  coalesce(l.quantity_received, 0) as quantity_received,
  coalesce(l.received_value, 0)    as received_value,
  case when po.status = 'CANCELLED' then 0 else coalesce(l.outstanding_value, 0) end as outstanding_value,
  po.created_by,
  c.full_name             as created_by_name,
  po.submitted_at,
  po.approved_by,
  a.full_name             as approved_by_name,
  po.approved_at,
  po.cancelled_at,
  po.cancel_reason,
  r.last_received_at,
  po.created_at,
  po.updated_at
from public.purchase_orders po
join public.suppliers s  on s.id = po.supplier_id
join public.warehouses w on w.id = po.warehouse_id
left join public.profiles c on c.id = po.created_by
left join public.profiles a on a.id = po.approved_by
left join lateral (
  select
    count(*)::integer                                              as line_count,
    sum(i.quantity_ordered)::integer                               as quantity_ordered,
    sum(i.quantity_received)::integer                              as quantity_received,
    sum(i.quantity_received * i.unit_cost)                         as received_value,
    sum((i.quantity_ordered - i.quantity_received) * i.unit_cost)  as outstanding_value
  from public.purchase_order_items i
  where i.purchase_order_id = po.id
) l on true
left join lateral (
  select max(g.received_at) as last_received_at
  from public.goods_receipts g
  where g.purchase_order_id = po.id and g.reversed_at is null
) r on true;

-- Suppliers with their purchasing figures.
--   total_purchase_value: approved or later (committed spend), excluding cancelled.
--   outstanding orders:   submitted, approved or partially received.
create view public.supplier_purchase_summary
with (security_invoker = true)
as
select
  s.id                          as supplier_id,
  s.code,
  s.name,
  s.contact_name,
  s.email,
  s.phone,
  s.city,
  s.country,
  s.payment_terms_days,
  s.lead_time_days,
  s.is_active,
  s.created_at,
  coalesce(p.order_count, 0)          as order_count,
  coalesce(p.total_purchase_value, 0) as total_purchase_value,
  coalesce(p.received_value, 0)       as received_value,
  p.last_order_date,
  coalesce(p.outstanding_count, 0)    as outstanding_count,
  coalesce(p.outstanding_value, 0)    as outstanding_value
from public.suppliers s
left join lateral (
  select
    (count(*) filter (where o.status <> 'CANCELLED'))::integer as order_count,
    sum(o.total_amount) filter (where o.status in ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')) as total_purchase_value,
    sum(o.received_value) as received_value,
    max(o.order_date) filter (where o.status <> 'CANCELLED') as last_order_date,
    (count(*) filter (where o.status in ('SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED')))::integer as outstanding_count,
    sum(o.outstanding_value) filter (where o.status in ('APPROVED', 'PARTIALLY_RECEIVED')) as outstanding_value
  from public.purchase_order_overview o
  where o.supplier_id = s.id
) p on true;

create view public.goods_receipt_overview
with (security_invoker = true)
as
select
  g.id,
  g.receipt_number,
  g.purchase_order_id,
  po.po_number,
  po.supplier_id,
  s.name                as supplier_name,
  g.warehouse_id,
  w.code                as warehouse_code,
  w.name                as warehouse_name,
  g.received_at,
  g.received_by,
  u.full_name           as received_by_name,
  g.notes,
  coalesce(t.line_count, 0)     as line_count,
  coalesce(t.total_quantity, 0) as total_quantity,
  coalesce(t.total_value, 0)    as total_value,
  g.reversed_at,
  rb.full_name          as reversed_by_name,
  g.reversal_reason,
  g.created_at
from public.goods_receipts g
join public.purchase_orders po on po.id = g.purchase_order_id
join public.suppliers s        on s.id = po.supplier_id
join public.warehouses w       on w.id = g.warehouse_id
left join public.profiles u    on u.id = g.received_by
left join public.profiles rb   on rb.id = g.reversed_by
left join lateral (
  select count(*)::integer as line_count,
         sum(i.quantity_received)::integer as total_quantity,
         sum(i.quantity_received * i.unit_cost) as total_value
  from public.goods_receipt_items i
  where i.goods_receipt_id = g.id
) t on true;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.purchase_order_overview, public.supplier_purchase_summary, public.goods_receipt_overview
  from public, anon, authenticated;
grant select on public.purchase_order_overview, public.supplier_purchase_summary, public.goods_receipt_overview
  to authenticated, service_role;

revoke execute on function private.business_date(timestamptz) from public;
revoke execute on function private.assert_any_role(text, text[]) from public;
revoke execute on function private.enforce_purchase_order_rules() from public;
revoke execute on function private.enforce_purchase_order_item_rules() from public;
revoke execute on function private.guard_document_movements() from public;
revoke execute on function private.replace_purchase_order_items(uuid, jsonb) from public;
revoke execute on function private.validate_purchase_order_header(uuid, uuid, date, date) from public;
revoke execute on function private.lock_purchase_order(uuid) from public;
revoke execute on function private.purchase_order_receipt_status(uuid) from public;

revoke execute on function public.create_purchase_order(uuid, uuid, jsonb, date, date, text) from public, anon;
revoke execute on function public.update_purchase_order(uuid, uuid, uuid, jsonb, date, date, text) from public, anon;
revoke execute on function public.submit_purchase_order(uuid) from public, anon;
revoke execute on function public.approve_purchase_order(uuid) from public, anon;
revoke execute on function public.cancel_purchase_order(uuid, text) from public, anon;
revoke execute on function public.receive_goods(uuid, jsonb, text, timestamptz) from public, anon;
revoke execute on function public.reverse_goods_receipt(uuid, text) from public, anon;

grant execute on function public.create_purchase_order(uuid, uuid, jsonb, date, date, text) to authenticated;
grant execute on function public.update_purchase_order(uuid, uuid, uuid, jsonb, date, date, text) to authenticated;
grant execute on function public.submit_purchase_order(uuid) to authenticated;
grant execute on function public.approve_purchase_order(uuid) to authenticated;
grant execute on function public.cancel_purchase_order(uuid, text) to authenticated;
grant execute on function public.receive_goods(uuid, jsonb, text, timestamptz) to authenticated;
grant execute on function public.reverse_goods_receipt(uuid, text) to authenticated;
