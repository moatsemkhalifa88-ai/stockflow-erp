-- =============================================================================
-- StockFlow ERP - 14 Analytics, alerts and BI views
--
-- BI layer (v_* views, stable names for Power BI and other tools):
--   v_inventory_valuation   current stock and value per product x warehouse
--   v_stock_movements       the ledger with business dates, categories and values
--   v_movements_daily       ledger aggregated per day x warehouse x product x type
--   v_purchase_receipts     received purchase lines (reversed receipts excluded)
--   v_sales_lines           shipped / completed sales lines with revenue and COGS
--   v_sales_by_product      v_sales_lines per product
--   v_purchases_monthly     received value per month x warehouse
--   v_sales_monthly         net sales per month x warehouse
--   v_low_stock             active locations at or below minimum, with reorder advice
--   v_alerts                computed alerts (no alerts table)
--
-- Functions used by the dashboard and reports are built ON these views, so the
-- app, the reports and a BI tool all compute every number the same way.
--
-- Definitions:
--   * business date  = date in Asia/Jerusalem (private.business_date).
--   * purchases      = value of goods RECEIVED (receipt lines x PO unit cost),
--                      dated by the receipt; reversed receipts excluded.
--   * sales          = net revenue (after line discounts) of SHIPPED / COMPLETED
--                      orders, dated by the ship date. Reversed shipments are not
--                      shipped any more, so they drop out automatically.
--   * COGS           = shipped quantity x unit cost of the SALE movement.
--   * pending POs    = submitted, approved or partially received.
--   * pending SOs    = confirmed or processing.
-- All views are security_invoker: the caller's RLS applies.
-- =============================================================================

-- Views and invoker-rights functions below call it as the querying user.
grant execute on function private.business_date(timestamptz) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- BI views
-- -----------------------------------------------------------------------------
create view public.v_inventory_valuation
with (security_invoker = true)
as
select
  v.inventory_id,
  v.product_id,
  v.sku,
  v.product_name,
  v.unit_of_measure,
  v.category_id,
  v.category_name,
  v.warehouse_id,
  v.warehouse_code,
  v.warehouse_name,
  v.quantity,
  v.min_stock_level,
  v.cost_price,
  v.inventory_value,
  v.stock_status,
  v.product_is_active,
  v.warehouse_is_active,
  v.last_movement_at
from public.inventory_valuation v;

create view public.v_stock_movements
with (security_invoker = true)
as
select
  m.id                                      as movement_id,
  m.movement_number,
  private.business_date(m.movement_date)    as business_date,
  m.movement_date,
  private.business_date(m.created_at)       as posted_date,
  m.created_at                              as posted_at,
  m.movement_type,
  m.direction,
  (m.reversal_of_id is not null)            as is_reversal,
  m.reference_type,
  m.reference_id,
  m.reference_number,
  m.product_id,
  p.sku,
  p.name                                    as product_name,
  p.category_id,
  c.name                                    as category_name,
  m.warehouse_id,
  w.code                                    as warehouse_code,
  w.name                                    as warehouse_name,
  m.quantity,
  m.quantity_change,
  m.unit_cost,
  m.quantity_change * m.unit_cost           as value_change,
  m.reason,
  m.performed_by,
  u.full_name                               as performed_by_name
from public.stock_movements m
join public.products p   on p.id = m.product_id
join public.categories c on c.id = p.category_id
join public.warehouses w on w.id = m.warehouse_id
left join public.profiles u on u.id = m.performed_by;

create view public.v_movements_daily
with (security_invoker = true)
as
select
  s.business_date,
  s.warehouse_id,
  s.warehouse_code,
  s.product_id,
  s.sku,
  s.product_name,
  s.category_id,
  s.category_name,
  s.movement_type,
  count(*)::integer                                                   as movement_count,
  coalesce(sum(s.quantity) filter (where s.direction = 1), 0)::integer  as units_in,
  coalesce(sum(s.quantity) filter (where s.direction = -1), 0)::integer as units_out,
  sum(s.quantity_change)::integer                                     as net_units,
  coalesce(sum(s.value_change) filter (where s.direction = 1), 0)     as value_in,
  coalesce(-sum(s.value_change) filter (where s.direction = -1), 0)   as value_out
from public.v_stock_movements s
group by s.business_date, s.warehouse_id, s.warehouse_code, s.product_id, s.sku, s.product_name,
         s.category_id, s.category_name, s.movement_type;

create view public.v_purchase_receipts
with (security_invoker = true)
as
select
  g.id                                     as receipt_id,
  g.receipt_number,
  private.business_date(g.received_at)     as business_date,
  g.received_at,
  po.id                                    as purchase_order_id,
  po.po_number,
  po.supplier_id,
  s.name                                   as supplier_name,
  g.warehouse_id,
  w.code                                   as warehouse_code,
  i.product_id,
  p.sku,
  p.name                                   as product_name,
  p.category_id,
  c.name                                   as category_name,
  i.quantity_received                      as quantity,
  i.unit_cost,
  round(i.quantity_received * i.unit_cost, 2) as line_value
from public.goods_receipt_items i
join public.goods_receipts g   on g.id = i.goods_receipt_id
join public.purchase_orders po on po.id = g.purchase_order_id
join public.suppliers s        on s.id = po.supplier_id
join public.warehouses w       on w.id = g.warehouse_id
join public.products p         on p.id = i.product_id
join public.categories c       on c.id = p.category_id
where g.reversed_at is null;

create view public.v_sales_lines
with (security_invoker = true)
as
select
  so.id                                    as sales_order_id,
  so.so_number,
  so.status,
  private.business_date(so.shipped_at)     as business_date,
  so.shipped_at,
  so.order_date,
  so.customer_id,
  cu.name                                  as customer_name,
  cu.customer_type,
  so.warehouse_id,
  w.code                                   as warehouse_code,
  i.product_id,
  p.sku,
  p.name                                   as product_name,
  p.category_id,
  c.name                                   as category_name,
  i.quantity,
  i.unit_price,
  i.discount_percent,
  i.gross_amount,
  i.discount_amount,
  i.line_total                             as net_revenue,
  round(i.quantity * coalesce(sm.unit_cost, p.cost_price), 2) as cogs,
  i.line_total - round(i.quantity * coalesce(sm.unit_cost, p.cost_price), 2) as gross_margin
from public.sales_order_items i
join public.sales_orders so on so.id = i.sales_order_id
join public.customers cu    on cu.id = so.customer_id
join public.warehouses w    on w.id = so.warehouse_id
join public.products p      on p.id = i.product_id
join public.categories c    on c.id = p.category_id
left join lateral (
  -- The unit cost the shipment actually took stock out at.
  select m.unit_cost
  from public.stock_movements m
  where m.reference_type = 'SALES_ORDER'
    and m.reference_id = so.id
    and m.product_id = i.product_id
    and m.movement_type = 'SALE'
    and not exists (select 1 from public.stock_movements r where r.reversal_of_id = m.id)
  order by m.created_at desc
  limit 1
) sm on true
where so.status in ('SHIPPED', 'COMPLETED');

create view public.v_sales_by_product
with (security_invoker = true)
as
select
  l.product_id,
  l.sku,
  l.product_name,
  l.category_id,
  l.category_name,
  count(distinct l.sales_order_id)::integer as order_count,
  sum(l.quantity)::integer                  as quantity,
  sum(l.gross_amount)                       as gross_amount,
  sum(l.discount_amount)                    as discount_amount,
  sum(l.net_revenue)                        as net_revenue,
  sum(l.cogs)                               as cogs,
  sum(l.gross_margin)                       as gross_margin,
  min(l.business_date)                      as first_sale_date,
  max(l.business_date)                      as last_sale_date
from public.v_sales_lines l
group by l.product_id, l.sku, l.product_name, l.category_id, l.category_name;

create view public.v_purchases_monthly
with (security_invoker = true)
as
select
  date_trunc('month', r.business_date)::date as month,
  r.warehouse_id,
  r.warehouse_code,
  count(distinct r.receipt_id)::integer      as receipt_count,
  sum(r.quantity)::integer                   as quantity,
  sum(r.line_value)                          as purchase_value
from public.v_purchase_receipts r
group by 1, r.warehouse_id, r.warehouse_code;

create view public.v_sales_monthly
with (security_invoker = true)
as
select
  date_trunc('month', l.business_date)::date as month,
  l.warehouse_id,
  l.warehouse_code,
  count(distinct l.sales_order_id)::integer  as order_count,
  sum(l.quantity)::integer                   as quantity,
  sum(l.net_revenue)                         as net_revenue,
  sum(l.cogs)                                as cogs,
  sum(l.gross_margin)                        as gross_margin
from public.v_sales_lines l
group by 1, l.warehouse_id, l.warehouse_code;

-- Active products at active warehouses at or below their minimum stock level.
create view public.v_low_stock
with (security_invoker = true)
as
select
  v.inventory_id,
  v.product_id,
  v.sku,
  v.product_name,
  v.unit_of_measure,
  v.category_id,
  v.category_name,
  v.warehouse_id,
  v.warehouse_code,
  v.warehouse_name,
  v.quantity,
  v.min_stock_level,
  greatest(v.min_stock_level - v.quantity, 0)                             as shortfall,
  greatest(p.reorder_quantity, v.min_stock_level - v.quantity, 1)         as suggested_order_quantity,
  v.cost_price,
  greatest(p.reorder_quantity, v.min_stock_level - v.quantity, 1) * v.cost_price as suggested_order_value,
  v.stock_status,
  v.last_movement_at
from public.inventory_valuation v
join public.products p on p.id = v.product_id
where v.stock_status in ('LOW_STOCK', 'OUT_OF_STOCK')
  and v.product_is_active
  and v.warehouse_is_active;

-- -----------------------------------------------------------------------------
-- Alerts, computed on read. Severity: critical > warning > info.
-- -----------------------------------------------------------------------------
create view public.v_alerts
with (security_invoker = true)
as
select
  case when l.stock_status = 'OUT_OF_STOCK' then 'OUT_OF_STOCK' else 'LOW_STOCK' end as alert_type,
  case when l.stock_status = 'OUT_OF_STOCK' then 'critical' else 'warning' end         as severity,
  'inventory'::text                                   as entity_type,
  l.product_id                                        as entity_id,
  l.sku || ' @ ' || l.warehouse_code                  as reference,
  l.product_name                                      as title,
  format('%s on hand, minimum %s', l.quantity, l.min_stock_level) as detail,
  l.warehouse_id,
  l.warehouse_code,
  private.business_date(coalesce(l.last_movement_at, now())) as since_date,
  (private.business_date() - private.business_date(coalesce(l.last_movement_at, now())))::integer as days_open
from public.v_low_stock l

union all

select
  'PENDING_PO_APPROVAL', 'info', 'purchase_order', po.id, po.po_number,
  s.name,
  format('Submitted, waiting for approval (%s)', to_char(po.total_amount, 'FM999G999G990D00') || ' ILS'),
  po.warehouse_id, w.code,
  private.business_date(po.submitted_at),
  (private.business_date() - private.business_date(po.submitted_at))::integer
from public.purchase_orders po
join public.suppliers s  on s.id = po.supplier_id
join public.warehouses w on w.id = po.warehouse_id
where po.status = 'SUBMITTED'

union all

select
  'DELAYED_PO',
  case when private.business_date() - po.expected_delivery_date > 7 then 'critical' else 'warning' end,
  'purchase_order', po.id, po.po_number,
  s.name,
  format('Expected %s, still %s', to_char(po.expected_delivery_date, 'DD Mon YYYY'), lower(replace(po.status::text, '_', ' '))),
  po.warehouse_id, w.code,
  po.expected_delivery_date,
  (private.business_date() - po.expected_delivery_date)::integer
from public.purchase_orders po
join public.suppliers s  on s.id = po.supplier_id
join public.warehouses w on w.id = po.warehouse_id
where po.status in ('APPROVED', 'PARTIALLY_RECEIVED')
  and po.expected_delivery_date < private.business_date()

union all

-- Confirmed but not picked within 2 days, or past the requested delivery date.
select
  'UNPROCESSED_SO',
  case when so.requested_delivery_date < private.business_date() then 'critical' else 'warning' end,
  'sales_order', so.id, so.so_number,
  c.name,
  case
    when so.requested_delivery_date < private.business_date()
      then format('Requested %s, still %s', to_char(so.requested_delivery_date, 'DD Mon YYYY'), lower(so.status::text))
    else format('%s since %s', initcap(lower(so.status::text)), to_char(coalesce(so.processing_started_at, so.confirmed_at), 'DD Mon YYYY'))
  end,
  so.warehouse_id, w.code,
  private.business_date(coalesce(so.processing_started_at, so.confirmed_at)),
  (private.business_date() - private.business_date(coalesce(so.processing_started_at, so.confirmed_at)))::integer
from public.sales_orders so
join public.customers c  on c.id = so.customer_id
join public.warehouses w on w.id = so.warehouse_id
where so.status in ('CONFIRMED', 'PROCESSING')
  and (so.requested_delivery_date < private.business_date()
       or coalesce(so.processing_started_at, so.confirmed_at) < now() - interval '2 days')

union all

select
  'PENDING_TRANSFER', 'info', 'stock_transfer', t.id, t.transfer_number,
  sw.code || ' → ' || dw.code,
  case when t.status = 'REQUESTED' then 'Waiting for approval' else 'Approved, waiting to be executed' end,
  t.source_warehouse_id, sw.code,
  private.business_date(coalesce(t.approved_at, t.requested_at)),
  (private.business_date() - private.business_date(coalesce(t.approved_at, t.requested_at)))::integer
from public.stock_transfers t
join public.warehouses sw on sw.id = t.source_warehouse_id
join public.warehouses dw on dw.id = t.destination_warehouse_id
where t.status in ('REQUESTED', 'APPROVED');

-- -----------------------------------------------------------------------------
-- Dashboard and report functions (invoker rights: RLS applies)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_kpis()
returns table (
  total_products          integer,
  inventory_value         numeric,
  low_stock_items         integer,
  out_of_stock_items      integer,
  pending_purchase_orders integer,
  pending_sales_orders    integer,
  movements_today         integer,
  purchases_month         numeric,
  sales_month             numeric,
  month_start             date,
  business_today          date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (select private.business_date() as d)
  select
    (select count(*)::integer from public.products p where p.is_active),
    (select round(coalesce(sum(v.inventory_value), 0), 2) from public.v_inventory_valuation v),
    (select count(*)::integer from public.v_low_stock l where l.stock_status = 'LOW_STOCK'),
    (select count(*)::integer from public.v_low_stock l where l.stock_status = 'OUT_OF_STOCK'),
    (select count(*)::integer from public.purchase_orders po where po.status in ('SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED')),
    (select count(*)::integer from public.sales_orders so where so.status in ('CONFIRMED', 'PROCESSING')),
    (select count(*)::integer from public.v_stock_movements s, today where s.business_date = today.d),
    (select round(coalesce(sum(r.line_value), 0), 2) from public.v_purchase_receipts r, today
      where r.business_date between date_trunc('month', today.d)::date and today.d),
    (select round(coalesce(sum(l.net_revenue), 0), 2) from public.v_sales_lines l, today
      where l.business_date between date_trunc('month', today.d)::date and today.d),
    (select date_trunc('month', today.d)::date from today),
    (select today.d from today);
$$;

-- Purchases (received value) vs sales (net revenue) per day / week / month.
-- Every bucket in the range is returned, including empty ones.
create or replace function public.purchases_vs_sales(p_from date, p_to date, p_bucket text default 'week')
returns table (bucket_start date, purchases numeric, sales numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with buckets as (
    select generate_series(
             date_trunc(p_bucket, p_from::timestamp),
             date_trunc(p_bucket, p_to::timestamp),
             ('1 ' || p_bucket)::interval
           )::date as bucket_start
  ),
  purchases as (
    select date_trunc(p_bucket, r.business_date::timestamp)::date as bucket_start, sum(r.line_value) as value
    from public.v_purchase_receipts r
    where r.business_date between p_from and p_to
    group by 1
  ),
  sales as (
    select date_trunc(p_bucket, l.business_date::timestamp)::date as bucket_start, sum(l.net_revenue) as value
    from public.v_sales_lines l
    where l.business_date between p_from and p_to
    group by 1
  )
  select b.bucket_start, round(coalesce(p.value, 0), 2), round(coalesce(s.value, 0), 2)
  from buckets b
  left join purchases p on p.bucket_start = b.bucket_start
  left join sales s     on s.bucket_start = b.bucket_start
  where p_bucket in ('day', 'week', 'month') and p_from <= p_to
  order by b.bucket_start;
$$;

create or replace function public.top_products_by_movement(
  p_from         date,
  p_to           date,
  p_limit        integer default 10,
  p_warehouse_id uuid default null
)
returns table (product_id uuid, sku text, product_name text, units_in integer, units_out integer, units_moved integer, movement_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.product_id, d.sku, d.product_name,
         sum(d.units_in)::integer, sum(d.units_out)::integer,
         sum(d.units_in + d.units_out)::integer, sum(d.movement_count)::integer
  from public.v_movements_daily d
  where d.business_date between p_from and p_to
    and (p_warehouse_id is null or d.warehouse_id = p_warehouse_id)
  group by d.product_id, d.sku, d.product_name
  order by sum(d.units_in + d.units_out) desc, d.sku
  limit greatest(least(coalesce(p_limit, 10), 100), 1);
$$;

create or replace function public.movements_by_type(p_from date, p_to date, p_warehouse_id uuid default null)
returns table (movement_type public.movement_type, movement_count integer, units integer, value numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.movement_type, sum(d.movement_count)::integer, sum(d.units_in + d.units_out)::integer,
         round(sum(d.value_in + d.value_out), 2)
  from public.v_movements_daily d
  where d.business_date between p_from and p_to
    and (p_warehouse_id is null or d.warehouse_id = p_warehouse_id)
  group by d.movement_type
  order by 2 desc, 1;
$$;

-- Stock position as recorded in the ledger at the end of a business day
-- (by posting time), valued at the CURRENT cost price. For today it equals
-- v_inventory_valuation exactly.
create or replace function public.inventory_valuation_as_of(
  p_as_of        date,
  p_warehouse_id uuid default null,
  p_category_id  uuid default null
)
returns table (
  product_id      uuid,
  sku             text,
  product_name    text,
  category_id     uuid,
  category_name   text,
  warehouse_id    uuid,
  warehouse_code  text,
  warehouse_name  text,
  quantity        integer,
  cost_price      numeric,
  inventory_value numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.product_id, s.sku, s.product_name, s.category_id, s.category_name,
         s.warehouse_id, s.warehouse_code, s.warehouse_name,
         sum(s.quantity_change)::integer, p.cost_price, sum(s.quantity_change) * p.cost_price
  from public.v_stock_movements s
  join public.products p on p.id = s.product_id
  where s.posted_date <= p_as_of
    and (p_warehouse_id is null or s.warehouse_id = p_warehouse_id)
    and (p_category_id is null or s.category_id = p_category_id)
  group by s.product_id, s.sku, s.product_name, s.category_id, s.category_name,
           s.warehouse_id, s.warehouse_code, s.warehouse_name, p.cost_price
  having sum(s.quantity_change) <> 0
  order by s.sku, s.warehouse_code;
$$;

-- Totals for the Stock Movement Report, with the same filters as the list.
create or replace function public.movement_report_totals(
  p_from          date,
  p_to            date,
  p_warehouse_id  uuid default null,
  p_category_id   uuid default null,
  p_movement_type public.movement_type default null
)
returns table (movement_count integer, units_in integer, units_out integer, value_in numeric, value_out numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer,
         coalesce(sum(s.quantity) filter (where s.direction = 1), 0)::integer,
         coalesce(sum(s.quantity) filter (where s.direction = -1), 0)::integer,
         round(coalesce(sum(s.value_change) filter (where s.direction = 1), 0), 2),
         round(coalesce(-sum(s.value_change) filter (where s.direction = -1), 0), 2)
  from public.v_stock_movements s
  where s.business_date between p_from and p_to
    and (p_warehouse_id is null or s.warehouse_id = p_warehouse_id)
    and (p_category_id is null or s.category_id = p_category_id)
    and (p_movement_type is null or s.movement_type = p_movement_type);
$$;

-- Distinct values for the audit log filters (admins only through RLS).
create or replace function public.audit_log_facets()
returns table (facet text, value text, entries integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'action', a.action, count(*)::integer from public.audit_log a group by a.action
  union all
  select 'entity_type', a.entity_type, count(*)::integer from public.audit_log a group by a.entity_type
  union all
  select 'user', coalesce(a.user_email, 'system'), count(*)::integer from public.audit_log a group by coalesce(a.user_email, 'system')
  order by 1, 2;
$$;

create index audit_log_user_email_idx on public.audit_log (user_email);
create index stock_movements_created_at_idx on public.stock_movements (created_at);

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on
  public.v_inventory_valuation, public.v_stock_movements, public.v_movements_daily,
  public.v_purchase_receipts, public.v_sales_lines, public.v_sales_by_product,
  public.v_purchases_monthly, public.v_sales_monthly, public.v_low_stock, public.v_alerts
from public, anon, authenticated;

grant select on
  public.v_inventory_valuation, public.v_stock_movements, public.v_movements_daily,
  public.v_purchase_receipts, public.v_sales_lines, public.v_sales_by_product,
  public.v_purchases_monthly, public.v_sales_monthly, public.v_low_stock, public.v_alerts
to authenticated, service_role;

revoke execute on function public.dashboard_kpis() from public, anon;
revoke execute on function public.purchases_vs_sales(date, date, text) from public, anon;
revoke execute on function public.top_products_by_movement(date, date, integer, uuid) from public, anon;
revoke execute on function public.movements_by_type(date, date, uuid) from public, anon;
revoke execute on function public.inventory_valuation_as_of(date, uuid, uuid) from public, anon;
revoke execute on function public.movement_report_totals(date, date, uuid, uuid, public.movement_type) from public, anon;
revoke execute on function public.audit_log_facets() from public, anon;

grant execute on function public.dashboard_kpis() to authenticated;
grant execute on function public.purchases_vs_sales(date, date, text) to authenticated;
grant execute on function public.top_products_by_movement(date, date, integer, uuid) to authenticated;
grant execute on function public.movements_by_type(date, date, uuid) to authenticated;
grant execute on function public.inventory_valuation_as_of(date, uuid, uuid) to authenticated;
grant execute on function public.movement_report_totals(date, date, uuid, uuid, public.movement_type) to authenticated;
grant execute on function public.audit_log_facets() to authenticated;
