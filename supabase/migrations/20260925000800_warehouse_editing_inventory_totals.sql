-- =============================================================================
-- StockFlow ERP - 08 Warehouse editing and filtered inventory totals
--
-- 1. Warehouse managers may create and edit warehouses (previously admin only).
--    Warehouses are still never deleted (DELETE is revoked); they are deactivated.
--    Every change is audited by the existing warehouses_audit trigger.
-- 2. A warehouse manager must be an active admin or warehouse manager.
-- 3. A warehouse code cannot change once stock has moved there (like product SKUs).
-- 4. inventory_totals(): KPI totals for exactly the rows the Inventory page lists,
--    with the same filters, aggregated from inventory_valuation.
--
-- Custom SQLSTATEs: SF004 warehouse code locked by history, SF005 invalid manager.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS: admins and warehouse managers maintain warehouses
-- -----------------------------------------------------------------------------
drop policy "Admins can create warehouses" on public.warehouses;
drop policy "Admins can update warehouses" on public.warehouses;

create policy "Admins and warehouse managers can create warehouses"
  on public.warehouses for insert to authenticated
  with check ((select private.has_any_role('admin', 'warehouse_manager')));

create policy "Admins and warehouse managers can update warehouses"
  on public.warehouses for update to authenticated
  using ((select private.has_any_role('admin', 'warehouse_manager')))
  with check ((select private.has_any_role('admin', 'warehouse_manager')));

-- -----------------------------------------------------------------------------
-- 2 + 3. Integrity rules on warehouses
-- -----------------------------------------------------------------------------
create or replace function private.validate_warehouse_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manager_id is not null
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and not exists (
       select 1
       from public.profiles p
       join public.roles r on r.id = p.role_id
       where p.id = new.manager_id
         and p.is_active
         and r.is_active
         and r.code in ('admin', 'warehouse_manager')
     ) then
    raise exception 'The warehouse manager must be an active administrator or warehouse manager'
      using errcode = 'SF005';
  end if;

  if tg_op = 'UPDATE'
     and new.code is distinct from old.code
     and exists (select 1 from public.stock_movements m where m.warehouse_id = old.id) then
    raise exception 'Warehouse code % cannot be changed because stock movements exist for this warehouse', old.code
      using errcode = 'SF004';
  end if;

  return new;
end;
$$;

create trigger warehouses_validate_change
  before insert or update on public.warehouses
  for each row execute function private.validate_warehouse_change();

revoke execute on function private.validate_warehouse_change() from public;

-- -----------------------------------------------------------------------------
-- 4. Filtered inventory totals
-- SECURITY INVOKER: the caller's RLS applies, same as reading the view.
-- The search matches the Inventory list: SKU or product name, case-insensitive.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_totals(
  p_warehouse_id uuid default null,
  p_category_id  uuid default null,
  p_stock_status text default null,
  p_search       text default null
)
returns table (
  line_count         integer,
  total_quantity     bigint,
  inventory_value    numeric,
  low_stock_count    integer,
  out_of_stock_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::integer,
    coalesce(sum(v.quantity), 0)::bigint,
    round(coalesce(sum(v.inventory_value), 0), 2),
    (count(*) filter (where v.stock_status = 'LOW_STOCK'))::integer,
    (count(*) filter (where v.stock_status = 'OUT_OF_STOCK'))::integer
  from public.inventory_valuation v
  where (p_warehouse_id is null or v.warehouse_id = p_warehouse_id)
    and (p_category_id  is null or v.category_id  = p_category_id)
    and (p_stock_status is null or v.stock_status = p_stock_status)
    and (
      nullif(btrim(p_search), '') is null
      or v.sku ilike '%' || btrim(p_search) || '%'
      or v.product_name ilike '%' || btrim(p_search) || '%'
    );
$$;

revoke execute on function public.inventory_totals(uuid, uuid, text, text) from public, anon;
grant execute on function public.inventory_totals(uuid, uuid, text, text) to authenticated;
