-- =============================================================================
-- StockFlow ERP - 13 Stock transfers (and document movement guard for sales)
--
--   REQUESTED -> APPROVED -> COMPLETED
--       |  \          \
--       |   +----------+--> CANCELLED
--       +--> REJECTED
--
-- RPCs:
--   request_stock_transfer / cancel_stock_transfer   admin, warehouse_manager
--   approve_stock_transfer / reject_stock_transfer   admin
--   execute_stock_transfer                           admin, warehouse_manager
--
-- execute_stock_transfer posts, per line, TRANSFER_OUT at the source and
-- TRANSFER_IN at the destination through create_stock_movement, in one
-- transaction. If the source is short on any line nothing changes, and the
-- error names every short product.
--
-- The stock_movements guard (migration 10) is extended: SALES_ORDER and
-- STOCK_TRANSFER movements can only be posted by ship_sales_order /
-- execute_stock_transfer, sales movements only reversed by
-- reverse_sales_order_shipment, and transfer legs never reversed one by one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.stock_transfers
  add column rejected_by      uuid references public.profiles (id),
  add column rejected_at      timestamptz,
  add column rejection_reason text,
  add constraint stock_transfers_rejection_consistency
    check ((status = 'REJECTED') = (rejected_at is not null and rejection_reason is not null)),
  add constraint stock_transfers_cancel_consistency
    check ((status = 'CANCELLED') = (cancelled_at is not null)),
  add constraint stock_transfers_execution_consistency
    check ((status = 'COMPLETED') = (executed_at is not null)),
  add constraint stock_transfers_approval_consistency
    check (status not in ('APPROVED', 'COMPLETED') or approved_at is not null);

create index stock_transfers_rejected_by_idx on public.stock_transfers (rejected_by);
create index stock_transfers_executed_at_idx on public.stock_transfers (executed_at desc);

-- -----------------------------------------------------------------------------
-- Triggers: status machine, frozen header and lines
-- -----------------------------------------------------------------------------
create or replace function private.enforce_stock_transfer_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transition text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'REQUESTED' then
      raise exception 'New stock transfers start as REQUESTED' using errcode = 'SF007';
    end if;
    return new;
  end if;

  if (new.transfer_number, new.source_warehouse_id, new.destination_warehouse_id)
     is distinct from (old.transfer_number, old.source_warehouse_id, old.destination_warehouse_id) then
    raise exception 'The warehouses of transfer % cannot be changed', old.transfer_number using errcode = 'SF007';
  end if;

  if new.status is distinct from old.status then
    v_transition := old.status::text || '>' || new.status::text;
    if not v_transition = any (array[
      'REQUESTED>APPROVED', 'REQUESTED>REJECTED', 'REQUESTED>CANCELLED',
      'APPROVED>COMPLETED', 'APPROVED>CANCELLED'
    ]) then
      raise exception 'Transfer % cannot go from % to %', old.transfer_number, old.status, new.status
        using errcode = 'SF007';
    end if;
  end if;

  return new;
end;
$$;

create trigger stock_transfers_enforce_rules
  before insert or update on public.stock_transfers
  for each row execute function private.enforce_stock_transfer_rules();

create or replace function private.enforce_stock_transfer_item_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
begin
  select t.* into v_transfer
  from public.stock_transfers t
  where t.id = coalesce(new.stock_transfer_id, old.stock_transfer_id);

  if not found then
    return coalesce(new, old);
  end if;

  if v_transfer.status <> 'REQUESTED' then
    raise exception 'Lines of transfer % can only be changed while it is requested (it is %)',
      v_transfer.transfer_number, v_transfer.status
      using errcode = 'SF007';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger stock_transfer_items_enforce_rules
  before insert or update or delete on public.stock_transfer_items
  for each row execute function private.enforce_stock_transfer_item_rules();

create or replace function private.lock_stock_transfer(p_transfer_id uuid)
returns public.stock_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
begin
  select t.* into v_transfer from public.stock_transfers t where t.id = p_transfer_id for update;
  if not found then
    raise exception 'Stock transfer % not found', p_transfer_id using errcode = 'P0002';
  end if;
  return v_transfer;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- p_items: [{ "product_id": uuid, "quantity": int }]
-- -----------------------------------------------------------------------------
create or replace function public.request_stock_transfer(
  p_source_warehouse_id      uuid,
  p_destination_warehouse_id uuid,
  p_items                    jsonb,
  p_notes                    text default null
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_item     jsonb;
  v_line     integer := 0;
  v_product  public.products;
begin
  perform private.assert_any_role('request stock transfers', 'admin', 'warehouse_manager');

  if p_source_warehouse_id is null or p_destination_warehouse_id is null then
    raise exception 'Choose a source and a destination warehouse' using errcode = '22023';
  end if;
  if p_source_warehouse_id = p_destination_warehouse_id then
    raise exception 'Source and destination warehouse must be different' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_source_warehouse_id and w.is_active) then
    raise exception 'Choose an active source warehouse' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_destination_warehouse_id and w.is_active) then
    raise exception 'Choose an active destination warehouse' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A transfer needs at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'A transfer can have at most 200 lines' using errcode = '22023';
  end if;

  insert into public.stock_transfers (source_warehouse_id, destination_warehouse_id, notes, requested_by)
  values (p_source_warehouse_id, p_destination_warehouse_id, nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_transfer;

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
    if exists (select 1 from public.stock_transfer_items i
               where i.stock_transfer_id = v_transfer.id and i.product_id = v_product.id) then
      raise exception 'Line %: % appears more than once', v_line, v_product.sku using errcode = '22023';
    end if;

    insert into public.stock_transfer_items (stock_transfer_id, product_id, quantity)
    values (v_transfer.id, v_product.id, (v_item ->> 'quantity')::integer);
  end loop;

  perform private.write_audit('TRANSFER_REQUEST', 'stock_transfers', v_transfer.id::text,
    jsonb_build_object('transfer_number', v_transfer.transfer_number, 'lines', jsonb_array_length(p_items)),
    null, to_jsonb(v_transfer));
  return v_transfer;
end;
$$;

create or replace function public.approve_stock_transfer(p_transfer_id uuid)
returns public.stock_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
begin
  perform private.assert_any_role('approve stock transfers', 'admin');
  v_transfer := private.lock_stock_transfer(p_transfer_id);
  if v_transfer.status <> 'REQUESTED' then
    raise exception 'Only requested transfers can be approved (% is %)', v_transfer.transfer_number, v_transfer.status
      using errcode = 'SF007';
  end if;

  update public.stock_transfers set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_transfer_id returning * into v_transfer;

  perform private.write_audit('TRANSFER_APPROVE', 'stock_transfers', v_transfer.id::text,
    jsonb_build_object('transfer_number', v_transfer.transfer_number));
  return v_transfer;
end;
$$;

create or replace function public.reject_stock_transfer(p_transfer_id uuid, p_reason text)
returns public.stock_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_reason   text := nullif(btrim(p_reason), '');
begin
  perform private.assert_any_role('reject stock transfers', 'admin');
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'A reason (up to 500 characters) is required to reject a transfer' using errcode = '22023';
  end if;
  v_transfer := private.lock_stock_transfer(p_transfer_id);
  if v_transfer.status <> 'REQUESTED' then
    raise exception 'Only requested transfers can be rejected (% is %)', v_transfer.transfer_number, v_transfer.status
      using errcode = 'SF007';
  end if;

  update public.stock_transfers
     set status = 'REJECTED', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = v_reason
   where id = p_transfer_id
  returning * into v_transfer;

  perform private.write_audit('TRANSFER_REJECT', 'stock_transfers', v_transfer.id::text,
    jsonb_build_object('transfer_number', v_transfer.transfer_number, 'reason', v_reason));
  return v_transfer;
end;
$$;

-- Cancelling never touches inventory: only requested or approved (not executed) transfers.
create or replace function public.cancel_stock_transfer(p_transfer_id uuid, p_reason text)
returns public.stock_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_reason   text := nullif(btrim(p_reason), '');
begin
  perform private.assert_any_role('cancel stock transfers', 'admin', 'warehouse_manager');
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'A reason (up to 500 characters) is required to cancel a transfer' using errcode = '22023';
  end if;
  v_transfer := private.lock_stock_transfer(p_transfer_id);
  if v_transfer.status not in ('REQUESTED', 'APPROVED') then
    raise exception 'Transfer % is % and cannot be cancelled', v_transfer.transfer_number, v_transfer.status
      using errcode = 'SF007';
  end if;

  update public.stock_transfers
     set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = p_transfer_id
  returning * into v_transfer;

  perform private.write_audit('TRANSFER_CANCEL', 'stock_transfers', v_transfer.id::text,
    jsonb_build_object('transfer_number', v_transfer.transfer_number, 'reason', v_reason));
  return v_transfer;
end;
$$;

-- -----------------------------------------------------------------------------
-- execute_stock_transfer: all-or-nothing.
--   1. lock the transfer, then every stock row involved at BOTH warehouses in
--      (product, warehouse) order, so opposite transfers cannot deadlock on
--      existing rows;
--   2. check every line at the source; if any is short, raise one error naming
--      every short product - nothing has been written yet;
--   3. per line: TRANSFER_OUT at the source, TRANSFER_IN at the destination,
--      both through create_stock_movement.
-- -----------------------------------------------------------------------------
create or replace function public.execute_stock_transfer(p_transfer_id uuid)
returns public.stock_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer  public.stock_transfers;
  v_line      record;
  v_shortages text;
  v_total_qty integer := 0;
  v_lines     integer := 0;
begin
  perform private.assert_any_role('execute stock transfers', 'admin', 'warehouse_manager');

  v_transfer := private.lock_stock_transfer(p_transfer_id);
  if v_transfer.status <> 'APPROVED' then
    raise exception 'Only approved transfers can be executed (% is %)', v_transfer.transfer_number, v_transfer.status
      using errcode = 'SF007';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = v_transfer.destination_warehouse_id and w.is_active) then
    raise exception 'The destination warehouse of % is inactive and cannot receive stock', v_transfer.transfer_number
      using errcode = '22023';
  end if;

  perform 1
  from public.inventory inv
  where inv.warehouse_id in (v_transfer.source_warehouse_id, v_transfer.destination_warehouse_id)
    and inv.product_id in (select i.product_id from public.stock_transfer_items i where i.stock_transfer_id = v_transfer.id)
  order by inv.product_id, inv.warehouse_id
  for update;

  select string_agg(
           format('%s %s (need %s, available %s)', p.sku, p.name, i.quantity, coalesce(inv.quantity, 0)),
           '; ' order by p.sku)
    into v_shortages
  from public.stock_transfer_items i
  join public.products p on p.id = i.product_id
  left join public.inventory inv on inv.product_id = i.product_id and inv.warehouse_id = v_transfer.source_warehouse_id
  where i.stock_transfer_id = v_transfer.id
    and i.quantity > coalesce(inv.quantity, 0);

  if v_shortages is not null then
    raise exception 'Cannot execute %: insufficient stock at the source for %', v_transfer.transfer_number, v_shortages
      using errcode = 'SF001';
  end if;

  -- Mark first: the stock_movements guard only accepts STOCK_TRANSFER movements
  -- for a transfer executed in this transaction. If any movement below fails,
  -- the whole transaction (including this status change) rolls back.
  update public.stock_transfers
     set status = 'COMPLETED', executed_at = now(), executed_by = auth.uid()
   where id = v_transfer.id
  returning * into v_transfer;

  for v_line in
    select i.product_id, i.quantity
    from public.stock_transfer_items i
    where i.stock_transfer_id = v_transfer.id
    order by i.product_id
  loop
    perform public.create_stock_movement(
      p_product_id       => v_line.product_id,
      p_warehouse_id     => v_transfer.source_warehouse_id,
      p_movement_type    => 'TRANSFER_OUT',
      p_quantity         => v_line.quantity,
      p_reference_type   => 'STOCK_TRANSFER',
      p_reference_id     => v_transfer.id,
      p_reference_number => v_transfer.transfer_number
    );
    perform public.create_stock_movement(
      p_product_id       => v_line.product_id,
      p_warehouse_id     => v_transfer.destination_warehouse_id,
      p_movement_type    => 'TRANSFER_IN',
      p_quantity         => v_line.quantity,
      p_reference_type   => 'STOCK_TRANSFER',
      p_reference_id     => v_transfer.id,
      p_reference_number => v_transfer.transfer_number
    );
    v_total_qty := v_total_qty + v_line.quantity;
    v_lines := v_lines + 1;
  end loop;

  perform private.write_audit('TRANSFER_EXECUTE', 'stock_transfers', v_transfer.id::text,
    jsonb_build_object('transfer_number', v_transfer.transfer_number, 'lines', v_lines, 'quantity', v_total_qty));
  return v_transfer;
end;
$$;

-- -----------------------------------------------------------------------------
-- Guard for document movements (replaces the migration 10 version).
-- now() is the transaction start time, so "<marker> = now()" means "set in this
-- transaction". Clients cannot write these document tables, so only the
-- workflow functions can satisfy the checks.
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
  v_order    public.sales_orders;
  v_transfer public.stock_transfers;
begin
  if new.reference_type = 'PURCHASE_ORDER' then
    raise exception 'Purchase receipts are posted by receive_goods and reference the goods receipt'
      using errcode = 'SF008';
  end if;

  if new.reference_type = 'GOODS_RECEIPT' then
    select g.* into v_receipt from public.goods_receipts g where g.id = new.reference_id;
    if not found or v_receipt.created_at <> now() or v_receipt.reversed_at is not null then
      raise exception 'Stock for a goods receipt can only be posted by receive_goods' using errcode = 'SF008';
    end if;
  end if;

  if new.reference_type = 'SALES_ORDER' then
    select so.* into v_order from public.sales_orders so where so.id = new.reference_id;
    if not found or new.movement_type <> 'SALE' or v_order.shipment_posted_at is distinct from now() then
      raise exception 'Stock for a sales order can only be posted by ship_sales_order' using errcode = 'SF008';
    end if;
  end if;

  if new.reference_type = 'STOCK_TRANSFER' then
    select t.* into v_transfer from public.stock_transfers t where t.id = new.reference_id;
    if not found or new.movement_type not in ('TRANSFER_OUT', 'TRANSFER_IN') or v_transfer.executed_at is distinct from now() then
      raise exception 'Stock for a transfer can only be posted by execute_stock_transfer' using errcode = 'SF008';
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
    elsif v_original.reference_type = 'SALES_ORDER' then
      select so.* into v_order from public.sales_orders so where so.id = v_original.reference_id;
      if v_order.shipment_reversed_at is distinct from now() then
        raise exception 'Movement % belongs to sales order %; reverse the order''s shipment instead',
          v_original.movement_number, v_order.so_number
          using errcode = 'SF008';
      end if;
    elsif v_original.reference_type = 'STOCK_TRANSFER' then
      raise exception 'Movement % is one leg of transfer %; transfers are corrected with a transfer back',
        v_original.movement_number, v_original.reference_number
        using errcode = 'SF008';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reporting view
-- -----------------------------------------------------------------------------
create view public.stock_transfer_overview
with (security_invoker = true)
as
select
  t.id,
  t.transfer_number,
  t.status,
  t.source_warehouse_id,
  sw.code                  as source_code,
  sw.name                  as source_name,
  t.destination_warehouse_id,
  dw.code                  as destination_code,
  dw.name                  as destination_name,
  t.notes,
  coalesce(l.line_count, 0)     as line_count,
  coalesce(l.total_quantity, 0) as total_quantity,
  coalesce(l.total_value, 0)    as total_value,
  t.requested_by,
  rq.full_name             as requested_by_name,
  t.requested_at,
  ap.full_name             as approved_by_name,
  t.approved_at,
  ex.full_name             as executed_by_name,
  t.executed_at,
  rj.full_name             as rejected_by_name,
  t.rejected_at,
  t.rejection_reason,
  cn.full_name             as cancelled_by_name,
  t.cancelled_at,
  t.cancel_reason,
  t.created_at
from public.stock_transfers t
join public.warehouses sw on sw.id = t.source_warehouse_id
join public.warehouses dw on dw.id = t.destination_warehouse_id
left join public.profiles rq on rq.id = t.requested_by
left join public.profiles ap on ap.id = t.approved_by
left join public.profiles ex on ex.id = t.executed_by
left join public.profiles rj on rj.id = t.rejected_by
left join public.profiles cn on cn.id = t.cancelled_by
left join lateral (
  select count(*)::integer as line_count,
         sum(i.quantity)::integer as total_quantity,
         sum(i.quantity * p.cost_price) as total_value
  from public.stock_transfer_items i
  join public.products p on p.id = i.product_id
  where i.stock_transfer_id = t.id
) l on true;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.stock_transfer_overview from public, anon, authenticated;
grant select on public.stock_transfer_overview to authenticated, service_role;

revoke execute on function private.enforce_stock_transfer_rules() from public;
revoke execute on function private.enforce_stock_transfer_item_rules() from public;
revoke execute on function private.lock_stock_transfer(uuid) from public;
revoke execute on function private.guard_document_movements() from public;

revoke execute on function public.request_stock_transfer(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.approve_stock_transfer(uuid) from public, anon;
revoke execute on function public.reject_stock_transfer(uuid, text) from public, anon;
revoke execute on function public.cancel_stock_transfer(uuid, text) from public, anon;
revoke execute on function public.execute_stock_transfer(uuid) from public, anon;

grant execute on function public.request_stock_transfer(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.approve_stock_transfer(uuid) to authenticated;
grant execute on function public.reject_stock_transfer(uuid, text) to authenticated;
grant execute on function public.cancel_stock_transfer(uuid, text) to authenticated;
grant execute on function public.execute_stock_transfer(uuid) to authenticated;
