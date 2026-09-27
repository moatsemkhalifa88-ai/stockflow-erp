-- =============================================================================
-- StockFlow ERP - 09 Purchasing role
--
-- purchasing: maintains suppliers and purchase orders (create, edit, submit,
-- cancel). Approval stays with admins; receiving goods stays with admins and
-- warehouse managers (it moves stock). Purchase orders themselves are written
-- only through the RPCs in migration 10 - client writes stay revoked.
-- =============================================================================

insert into public.roles (code, name, description) values
  ('purchasing', 'Purchasing', 'Maintains suppliers and purchase orders. Cannot approve orders or move stock.')
on conflict (code) do nothing;

-- Suppliers: admins and purchasing (replaces the admin-only policies of migration 06).
drop policy "Admins can create suppliers" on public.suppliers;
drop policy "Admins can update suppliers" on public.suppliers;

create policy "Admins and purchasing can create suppliers"
  on public.suppliers for insert to authenticated
  with check ((select private.has_any_role('admin', 'purchasing')));

create policy "Admins and purchasing can update suppliers"
  on public.suppliers for update to authenticated
  using ((select private.has_any_role('admin', 'purchasing')))
  with check ((select private.has_any_role('admin', 'purchasing')));
