-- =============================================================================
-- StockFlow ERP - 04 Business documents
-- purchase orders, goods receipts, sales orders, stock transfers.
-- Workflow functions (status transitions, receive_goods, ship_sales_order,
-- execute_transfer) are added in Phases 3 and 4.
-- =============================================================================

create sequence public.purchase_order_number_seq;
create sequence public.goods_receipt_number_seq;
create sequence public.sales_order_number_seq;
create sequence public.stock_transfer_number_seq;

-- -----------------------------------------------------------------------------
-- Purchase orders
-- -----------------------------------------------------------------------------
create table public.purchase_orders (
  id                     uuid primary key default gen_random_uuid(),
  po_number              text not null unique
                         default 'PO-' || lpad(nextval('public.purchase_order_number_seq')::text, 6, '0'),
  supplier_id            uuid not null references public.suppliers (id),
  warehouse_id           uuid not null references public.warehouses (id),
  status                 public.purchase_order_status not null default 'DRAFT',
  order_date             date not null default current_date,
  expected_delivery_date date,
  currency               char(3) not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  total_amount           numeric(14, 2) not null default 0 check (total_amount >= 0),
  notes                  text,
  created_by             uuid references public.profiles (id) default auth.uid(),
  submitted_at           timestamptz,
  approved_by            uuid references public.profiles (id),
  approved_at            timestamptz,
  cancelled_by           uuid references public.profiles (id),
  cancelled_at           timestamptz,
  cancel_reason          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint purchase_orders_delivery_after_order
    check (expected_delivery_date is null or expected_delivery_date >= order_date),
  constraint purchase_orders_cancel_consistency
    check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create index purchase_orders_supplier_id_idx on public.purchase_orders (supplier_id);
create index purchase_orders_warehouse_id_idx on public.purchase_orders (warehouse_id);
create index purchase_orders_status_idx on public.purchase_orders (status);
create index purchase_orders_order_date_idx on public.purchase_orders (order_date desc);
create index purchase_orders_expected_delivery_idx on public.purchase_orders (expected_delivery_date);
create index purchase_orders_created_by_idx on public.purchase_orders (created_by);
create index purchase_orders_approved_by_idx on public.purchase_orders (approved_by);
create index purchase_orders_cancelled_by_idx on public.purchase_orders (cancelled_by);

create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function private.set_updated_at();

create table public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  line_number       smallint not null check (line_number > 0),
  product_id        uuid not null references public.products (id),
  quantity_ordered  integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0,
  unit_cost         numeric(12, 2) not null check (unit_cost >= 0),
  line_total        numeric(14, 2) generated always as (round(quantity_ordered * unit_cost, 2)) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint purchase_order_items_received_range
    check (quantity_received between 0 and quantity_ordered),
  constraint purchase_order_items_line_key unique (purchase_order_id, line_number),
  constraint purchase_order_items_product_key unique (purchase_order_id, product_id)
);

create index purchase_order_items_product_id_idx on public.purchase_order_items (product_id);

create trigger purchase_order_items_set_updated_at
  before update on public.purchase_order_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Goods receipts
-- -----------------------------------------------------------------------------
create table public.goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  receipt_number    text not null unique
                    default 'GR-' || lpad(nextval('public.goods_receipt_number_seq')::text, 6, '0'),
  purchase_order_id uuid not null references public.purchase_orders (id),
  warehouse_id      uuid not null references public.warehouses (id),
  received_by       uuid references public.profiles (id) default auth.uid(),
  received_at       timestamptz not null default now(),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index goods_receipts_purchase_order_id_idx on public.goods_receipts (purchase_order_id);
create index goods_receipts_warehouse_id_idx on public.goods_receipts (warehouse_id);
create index goods_receipts_received_by_idx on public.goods_receipts (received_by);
create index goods_receipts_received_at_idx on public.goods_receipts (received_at desc);

create trigger goods_receipts_set_updated_at
  before update on public.goods_receipts
  for each row execute function private.set_updated_at();

create table public.goods_receipt_items (
  id                     uuid primary key default gen_random_uuid(),
  goods_receipt_id       uuid not null references public.goods_receipts (id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items (id),
  product_id             uuid not null references public.products (id),
  quantity_received      integer not null check (quantity_received > 0),
  unit_cost              numeric(12, 2) not null check (unit_cost >= 0),
  stock_movement_id      uuid unique references public.stock_movements (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint goods_receipt_items_line_key unique (goods_receipt_id, purchase_order_item_id)
);

create index goods_receipt_items_po_item_id_idx on public.goods_receipt_items (purchase_order_item_id);
create index goods_receipt_items_product_id_idx on public.goods_receipt_items (product_id);

create trigger goods_receipt_items_set_updated_at
  before update on public.goods_receipt_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Sales orders
-- -----------------------------------------------------------------------------
create table public.sales_orders (
  id                      uuid primary key default gen_random_uuid(),
  so_number               text not null unique
                          default 'SO-' || lpad(nextval('public.sales_order_number_seq')::text, 6, '0'),
  customer_id             uuid not null references public.customers (id),
  warehouse_id            uuid not null references public.warehouses (id),
  status                  public.sales_order_status not null default 'DRAFT',
  order_date              date not null default current_date,
  requested_delivery_date date,
  currency                char(3) not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  subtotal                numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_amount         numeric(14, 2) not null default 0 check (discount_amount >= 0),
  total_amount            numeric(14, 2) not null default 0 check (total_amount >= 0),
  notes                   text,
  created_by              uuid references public.profiles (id) default auth.uid(),
  confirmed_at            timestamptz,
  shipped_by              uuid references public.profiles (id),
  shipped_at              timestamptz,
  completed_at            timestamptz,
  cancelled_by            uuid references public.profiles (id),
  cancelled_at            timestamptz,
  cancel_reason           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint sales_orders_delivery_after_order
    check (requested_delivery_date is null or requested_delivery_date >= order_date),
  constraint sales_orders_cancel_consistency
    check ((status = 'CANCELLED') = (cancelled_at is not null)),
  constraint sales_orders_totals_consistency
    check (total_amount = subtotal - discount_amount)
);

create index sales_orders_customer_id_idx on public.sales_orders (customer_id);
create index sales_orders_warehouse_id_idx on public.sales_orders (warehouse_id);
create index sales_orders_status_idx on public.sales_orders (status);
create index sales_orders_order_date_idx on public.sales_orders (order_date desc);
create index sales_orders_created_by_idx on public.sales_orders (created_by);
create index sales_orders_shipped_by_idx on public.sales_orders (shipped_by);
create index sales_orders_cancelled_by_idx on public.sales_orders (cancelled_by);

create trigger sales_orders_set_updated_at
  before update on public.sales_orders
  for each row execute function private.set_updated_at();

create table public.sales_order_items (
  id               uuid primary key default gen_random_uuid(),
  sales_order_id   uuid not null references public.sales_orders (id) on delete cascade,
  line_number      smallint not null check (line_number > 0),
  product_id       uuid not null references public.products (id),
  quantity         integer not null check (quantity > 0),
  quantity_shipped integer not null default 0,
  unit_price       numeric(12, 2) not null check (unit_price >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  gross_amount     numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  discount_amount  numeric(14, 2) generated always as (round(quantity * unit_price * discount_percent / 100, 2)) stored,
  line_total       numeric(14, 2) generated always as (
                     round(quantity * unit_price, 2) - round(quantity * unit_price * discount_percent / 100, 2)
                   ) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sales_order_items_shipped_range check (quantity_shipped between 0 and quantity),
  constraint sales_order_items_line_key unique (sales_order_id, line_number),
  constraint sales_order_items_product_key unique (sales_order_id, product_id)
);

create index sales_order_items_product_id_idx on public.sales_order_items (product_id);

create trigger sales_order_items_set_updated_at
  before update on public.sales_order_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Stock transfers (request -> approval -> execution)
-- -----------------------------------------------------------------------------
create table public.stock_transfers (
  id                       uuid primary key default gen_random_uuid(),
  transfer_number          text not null unique
                           default 'TR-' || lpad(nextval('public.stock_transfer_number_seq')::text, 6, '0'),
  source_warehouse_id      uuid not null references public.warehouses (id),
  destination_warehouse_id uuid not null references public.warehouses (id),
  status                   public.transfer_status not null default 'REQUESTED',
  requested_by             uuid references public.profiles (id) default auth.uid(),
  requested_at             timestamptz not null default now(),
  approved_by              uuid references public.profiles (id),
  approved_at              timestamptz,
  executed_by              uuid references public.profiles (id),
  executed_at              timestamptz,
  cancelled_by             uuid references public.profiles (id),
  cancelled_at             timestamptz,
  cancel_reason            text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint stock_transfers_different_warehouses
    check (source_warehouse_id <> destination_warehouse_id)
);

create index stock_transfers_source_idx on public.stock_transfers (source_warehouse_id);
create index stock_transfers_destination_idx on public.stock_transfers (destination_warehouse_id);
create index stock_transfers_status_idx on public.stock_transfers (status);
create index stock_transfers_requested_at_idx on public.stock_transfers (requested_at desc);
create index stock_transfers_requested_by_idx on public.stock_transfers (requested_by);
create index stock_transfers_approved_by_idx on public.stock_transfers (approved_by);
create index stock_transfers_executed_by_idx on public.stock_transfers (executed_by);
create index stock_transfers_cancelled_by_idx on public.stock_transfers (cancelled_by);

create trigger stock_transfers_set_updated_at
  before update on public.stock_transfers
  for each row execute function private.set_updated_at();

create table public.stock_transfer_items (
  id                uuid primary key default gen_random_uuid(),
  stock_transfer_id uuid not null references public.stock_transfers (id) on delete cascade,
  product_id        uuid not null references public.products (id),
  quantity          integer not null check (quantity > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint stock_transfer_items_product_key unique (stock_transfer_id, product_id)
);

create index stock_transfer_items_product_id_idx on public.stock_transfer_items (product_id);

create trigger stock_transfer_items_set_updated_at
  before update on public.stock_transfer_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Header totals are derived from lines, never typed in by the client.
-- -----------------------------------------------------------------------------
create or replace function private.recalc_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set total_amount = coalesce((
           select sum(i.line_total) from public.purchase_order_items i where i.purchase_order_id = v_po_id
         ), 0)
   where po.id = v_po_id;
  return null;
end;
$$;

create trigger purchase_order_items_recalc_total
  after insert or update or delete on public.purchase_order_items
  for each row execute function private.recalc_purchase_order_total();

create or replace function private.recalc_sales_order_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so_id uuid := coalesce(new.sales_order_id, old.sales_order_id);
begin
  update public.sales_orders so
     set subtotal        = t.subtotal,
         discount_amount = t.discount_amount,
         total_amount    = t.total_amount
    from (
      select coalesce(sum(i.gross_amount), 0)    as subtotal,
             coalesce(sum(i.discount_amount), 0) as discount_amount,
             coalesce(sum(i.line_total), 0)      as total_amount
      from public.sales_order_items i
      where i.sales_order_id = v_so_id
    ) t
   where so.id = v_so_id;
  return null;
end;
$$;

create trigger sales_order_items_recalc_totals
  after insert or update or delete on public.sales_order_items
  for each row execute function private.recalc_sales_order_totals();
