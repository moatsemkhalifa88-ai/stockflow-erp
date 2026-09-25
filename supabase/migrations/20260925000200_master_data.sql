-- =============================================================================
-- StockFlow ERP - 02 Master data
-- categories, products, suppliers, customers, warehouses.
-- Master data is never hard-deleted: rows are deactivated with is_active = false.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name        text not null check (length(btrim(name)) between 1 and 100),
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index categories_name_key on public.categories (lower(name));

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Warehouses
-- -----------------------------------------------------------------------------
create table public.warehouses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name           text not null check (length(btrim(name)) between 1 and 150),
  warehouse_type text not null default 'REGIONAL'
                 check (warehouse_type in ('MAIN', 'REGIONAL', 'DISTRIBUTION', 'RETURNS')),
  address_line   text,
  city           text not null,
  country        text not null default 'Israel',
  phone          text,
  manager_id     uuid references public.profiles (id) on delete set null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index warehouses_name_key on public.warehouses (lower(name));
create index warehouses_manager_id_idx on public.warehouses (manager_id);
create index warehouses_is_active_idx on public.warehouses (is_active);

create trigger warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Products
-- -----------------------------------------------------------------------------
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  sku              text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  name             text not null check (length(btrim(name)) between 1 and 200),
  description      text,
  category_id      uuid not null references public.categories (id),
  unit_of_measure  text not null default 'EA'
                   check (unit_of_measure in ('EA', 'BOX', 'PACK', 'CASE', 'KG', 'L', 'M', 'ROLL', 'SET', 'PAIR')),
  barcode          text unique check (barcode ~ '^[0-9]{8,14}$'),
  cost_price       numeric(12, 2) not null default 0 check (cost_price >= 0),
  sale_price       numeric(12, 2) not null default 0 check (sale_price >= 0),
  min_stock_level  integer not null default 0 check (min_stock_level >= 0),
  reorder_quantity integer not null default 0 check (reorder_quantity >= 0),
  is_active        boolean not null default true,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);
create index products_is_active_idx on public.products (is_active);
create index products_created_by_idx on public.products (created_by);
create index products_name_idx on public.products (lower(name));

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Suppliers
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name               text not null check (length(btrim(name)) between 1 and 200),
  contact_name       text,
  email              text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text,
  address_line       text,
  city               text,
  country            text not null default 'Israel',
  tax_id             text unique,
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  lead_time_days     integer not null default 7 check (lead_time_days between 0 and 365),
  notes              text,
  is_active          boolean not null default true,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index suppliers_name_key on public.suppliers (lower(name));
create index suppliers_is_active_idx on public.suppliers (is_active);
create index suppliers_created_by_idx on public.suppliers (created_by);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name               text not null check (length(btrim(name)) between 1 and 200),
  customer_type      text not null default 'CORPORATE'
                     check (customer_type in ('RETAIL', 'WHOLESALE', 'CORPORATE', 'GOVERNMENT')),
  contact_name       text,
  email              text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text,
  address_line       text,
  city               text,
  country            text not null default 'Israel',
  tax_id             text unique,
  credit_limit       numeric(14, 2) not null default 0 check (credit_limit >= 0),
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  notes              text,
  is_active          boolean not null default true,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index customers_name_key on public.customers (lower(name));
create index customers_is_active_idx on public.customers (is_active);
create index customers_type_idx on public.customers (customer_type);
create index customers_created_by_idx on public.customers (created_by);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();
