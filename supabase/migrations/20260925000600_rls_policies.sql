-- =============================================================================
-- StockFlow ERP - 06 Privileges and Row Level Security
--
-- Access model (Phase 1 roles: admin, warehouse_manager):
--   * anon               : no access to anything.
--   * active staff       : read all operational data.
--   * admin              : maintain all master data, users; read the audit log.
--   * warehouse_manager  : maintain categories and products.
--   * inventory, stock_movements, audit_log and business documents are NEVER
--     written directly by clients - only by SECURITY DEFINER functions.
--   * No DELETE policies exist: master data is deactivated, not deleted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- Anonymous users get nothing, now or in future migrations.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Functions are not executable by default; RPCs are granted explicitly.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Role helpers are needed by policies evaluated as `authenticated`.
grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public;
grant execute on function private.current_app_role() to authenticated, service_role;
grant execute on function private.is_active_user() to authenticated, service_role;
grant execute on function private.has_any_role(text[]) to authenticated, service_role;

-- Ledger-type and workflow tables: read-only for clients (defence in depth on top of RLS).
revoke insert, update, delete, truncate on
  public.roles,
  public.inventory,
  public.stock_movements,
  public.audit_log,
  public.purchase_orders,
  public.purchase_order_items,
  public.goods_receipts,
  public.goods_receipt_items,
  public.sales_orders,
  public.sales_order_items,
  public.stock_transfers,
  public.stock_transfer_items
from authenticated;

-- Master data: never hard-deleted by clients.
revoke delete, truncate on
  public.profiles,
  public.categories,
  public.warehouses,
  public.products,
  public.suppliers,
  public.customers
from authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.roles                enable row level security;
alter table public.profiles             enable row level security;
alter table public.audit_log            enable row level security;
alter table public.categories           enable row level security;
alter table public.warehouses           enable row level security;
alter table public.products             enable row level security;
alter table public.suppliers            enable row level security;
alter table public.customers            enable row level security;
alter table public.inventory            enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts       enable row level security;
alter table public.goods_receipt_items  enable row level security;
alter table public.sales_orders         enable row level security;
alter table public.sales_order_items    enable row level security;
alter table public.stock_transfers      enable row level security;
alter table public.stock_transfer_items enable row level security;

-- -----------------------------------------------------------------------------
-- Read access for active staff
-- `(select fn())` lets Postgres evaluate the helper once per statement.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'roles', 'categories', 'warehouses', 'products', 'suppliers', 'customers',
    'inventory', 'stock_movements',
    'purchase_orders', 'purchase_order_items', 'goods_receipts', 'goods_receipt_items',
    'sales_orders', 'sales_order_items', 'stock_transfers', 'stock_transfer_items'
  ]
  loop
    execute format(
      'create policy "Active staff can read %1$s" on public.%1$I for select to authenticated
         using ((select private.is_active_user()))',
      t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Active staff can read all profiles"
  on public.profiles for select to authenticated
  using ((select private.is_active_user()));

create policy "Admins can update profiles"
  on public.profiles for update to authenticated
  using ((select private.has_any_role('admin')))
  with check ((select private.has_any_role('admin')));

-- -----------------------------------------------------------------------------
-- Audit log: admins only
-- -----------------------------------------------------------------------------
create policy "Admins can read the audit log"
  on public.audit_log for select to authenticated
  using ((select private.has_any_role('admin')));

-- -----------------------------------------------------------------------------
-- Master data writes
-- -----------------------------------------------------------------------------
create policy "Admins and warehouse managers can create categories"
  on public.categories for insert to authenticated
  with check ((select private.has_any_role('admin', 'warehouse_manager')));

create policy "Admins and warehouse managers can update categories"
  on public.categories for update to authenticated
  using ((select private.has_any_role('admin', 'warehouse_manager')))
  with check ((select private.has_any_role('admin', 'warehouse_manager')));

create policy "Admins and warehouse managers can create products"
  on public.products for insert to authenticated
  with check ((select private.has_any_role('admin', 'warehouse_manager')));

create policy "Admins and warehouse managers can update products"
  on public.products for update to authenticated
  using ((select private.has_any_role('admin', 'warehouse_manager')))
  with check ((select private.has_any_role('admin', 'warehouse_manager')));

create policy "Admins can create warehouses"
  on public.warehouses for insert to authenticated
  with check ((select private.has_any_role('admin')));

create policy "Admins can update warehouses"
  on public.warehouses for update to authenticated
  using ((select private.has_any_role('admin')))
  with check ((select private.has_any_role('admin')));

-- The purchasing role (Phase 3) will be added to these supplier policies.
create policy "Admins can create suppliers"
  on public.suppliers for insert to authenticated
  with check ((select private.has_any_role('admin')));

create policy "Admins can update suppliers"
  on public.suppliers for update to authenticated
  using ((select private.has_any_role('admin')))
  with check ((select private.has_any_role('admin')));

-- The sales role (Phase 4) will be added to these customer policies.
create policy "Admins can create customers"
  on public.customers for insert to authenticated
  with check ((select private.has_any_role('admin')));

create policy "Admins can update customers"
  on public.customers for update to authenticated
  using ((select private.has_any_role('admin')))
  with check ((select private.has_any_role('admin')));
