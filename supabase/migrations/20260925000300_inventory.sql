-- =============================================================================
-- StockFlow ERP - 03 Inventory and stock movements
--
-- inventory        : current quantity per product + warehouse (never negative).
-- stock_movements  : append-only ledger. Every quantity change has exactly one
--                    movement row; history is corrected with reversal movements.
--
-- Clients cannot write to either table (see RLS migration). All changes go
-- through PostgreSQL functions (create_stock_movement - Phase 2).
-- =============================================================================

create table public.inventory (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id),
  warehouse_id     uuid not null references public.warehouses (id),
  quantity         integer not null default 0,
  bin_location     text,
  last_movement_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint inventory_quantity_non_negative check (quantity >= 0),
  constraint inventory_product_warehouse_key unique (product_id, warehouse_id)
);

-- product_id is covered by the leading column of the unique constraint.
create index inventory_warehouse_id_idx on public.inventory (warehouse_id);

create trigger inventory_set_updated_at
  before update on public.inventory
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Stock movements (ledger)
-- -----------------------------------------------------------------------------
create sequence public.stock_movement_number_seq;

create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  movement_number  text not null unique
                   default 'MV-' || lpad(nextval('public.stock_movement_number_seq')::text, 7, '0'),
  movement_type    public.movement_type not null,
  -- +1 = stock in, -1 = stock out. RETURN may go either way (customer / supplier).
  direction        smallint not null check (direction in (-1, 1)),
  product_id       uuid not null references public.products (id),
  warehouse_id     uuid not null references public.warehouses (id),
  quantity         integer not null check (quantity > 0),
  quantity_change  integer generated always as (quantity * direction) stored,
  quantity_before  integer not null check (quantity_before >= 0),
  quantity_after   integer not null check (quantity_after >= 0),
  unit_cost        numeric(12, 2) not null default 0 check (unit_cost >= 0),
  reference_type   text check (reference_type in (
                     'PURCHASE_ORDER', 'GOODS_RECEIPT', 'SALES_ORDER',
                     'STOCK_TRANSFER', 'ADJUSTMENT', 'REVERSAL', 'OPENING_BALANCE')),
  reference_id     uuid,
  reference_number text,
  reversal_of_id   uuid unique references public.stock_movements (id),
  reason           text,
  notes            text,
  performed_by     uuid references public.profiles (id),
  movement_date    timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint stock_movements_direction_matches_type check (
       (movement_type in ('PURCHASE_RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN') and direction = 1)
    or (movement_type in ('SALE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT') and direction = -1)
    or  movement_type = 'RETURN'
  ),
  constraint stock_movements_balance check (quantity_after = quantity_before + quantity * direction),
  constraint stock_movements_adjustment_reason check (
    movement_type not in ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') or length(btrim(coalesce(reason, ''))) > 0
  ),
  constraint stock_movements_not_self_reversal check (reversal_of_id is null or reversal_of_id <> id)
);

create index stock_movements_product_date_idx on public.stock_movements (product_id, movement_date desc);
create index stock_movements_warehouse_date_idx on public.stock_movements (warehouse_id, movement_date desc);
create index stock_movements_date_idx on public.stock_movements (movement_date desc);
create index stock_movements_type_idx on public.stock_movements (movement_type);
create index stock_movements_reference_idx on public.stock_movements (reference_type, reference_id);
create index stock_movements_performed_by_idx on public.stock_movements (performed_by);

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function private.prevent_modification();
