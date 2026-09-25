-- =============================================================================
-- StockFlow ERP - 05 Audit triggers on master data
-- Every insert / update / delete of master data is written to audit_log with
-- the acting user and the changed fields. Inventory changes are audited by the
-- stock movement engine itself (Phase 2); business documents by their RPCs.
-- =============================================================================

create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function private.audit_row_change();

create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change();

create trigger categories_audit
  after insert or update or delete on public.categories
  for each row execute function private.audit_row_change();

create trigger warehouses_audit
  after insert or update or delete on public.warehouses
  for each row execute function private.audit_row_change();

create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function private.audit_row_change();

create trigger suppliers_audit
  after insert or update or delete on public.suppliers
  for each row execute function private.audit_row_change();

create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function private.audit_row_change();
