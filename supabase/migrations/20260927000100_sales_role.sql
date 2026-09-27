-- =============================================================================
-- StockFlow ERP - 11 Sales role
--
-- sales: maintains customers and sales orders (create, edit, confirm, cancel
-- while unshipped). Processing and shipping move stock, so they stay with admins
-- and warehouse managers. Sales orders are written only through the RPCs in
-- migration 12 - client writes stay revoked.
-- =============================================================================

insert into public.roles (code, name, description) values
  ('sales', 'Sales', 'Maintains customers and sales orders. Cannot ship orders or move stock.')
on conflict (code) do nothing;

-- Customers: admins and sales (replaces the admin-only policies of migration 06).
drop policy "Admins can create customers" on public.customers;
drop policy "Admins can update customers" on public.customers;

create policy "Admins and sales can create customers"
  on public.customers for insert to authenticated
  with check ((select private.has_any_role('admin', 'sales')));

create policy "Admins and sales can update customers"
  on public.customers for update to authenticated
  using ((select private.has_any_role('admin', 'sales')))
  with check ((select private.has_any_role('admin', 'sales')));
