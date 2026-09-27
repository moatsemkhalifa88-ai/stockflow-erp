/**
 * Read-only check on the REAL data: the dashboard numbers must match the
 * reports and raw SQL. Runs as the demo admin through RLS (like the app) inside
 * a transaction that is rolled back - nothing is written.
 *
 * Run: npm run test:live   (needs DATABASE_URL and the demo users)
 */
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginAsUser, createLivePool } from "./live-db";

interface Kpis {
  total_products: number;
  inventory_value: string;
  low_stock_items: number;
  out_of_stock_items: number;
  pending_purchase_orders: number;
  pending_sales_orders: number;
  movements_today: number;
  purchases_month: string;
  sales_month: string;
  month_start: string;
  business_today: string;
}

describe("dashboard numbers vs reports vs raw SQL (live data)", () => {
  let pool: Pool;
  let client: PoolClient;
  let kpis: Kpis;

  beforeAll(async () => {
    pool = createLivePool(2);
    const installed = await pool.query<{ ok: boolean }>("select to_regproc('public.dashboard_kpis') is not null as ok");
    if (!installed.rows[0].ok) throw new Error("The analytics migration is not installed. Push the Phase 5 migration first.");
    const admin = await pool.query<{ id: string }>("select id from public.profiles where email = 'admin@stockflow.example'");
    if (admin.rows.length === 0) throw new Error("Demo admin not found - run npm run seed:users.");

    client = await pool.connect();
    await beginAsUser(client, admin.rows[0].id);
    kpis = (await client.query<Kpis>("select * from public.dashboard_kpis()")).rows[0];
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    if (pool) await pool.end();
  });

  const scalar = async (sql: string, params: unknown[] = []) => String((await client.query<{ v: unknown }>(sql, params)).rows[0].v);

  it("inventory value: KPI = raw inventory x cost = warehouse totals = valuation report", async () => {
    const raw = await scalar(
      "select round(coalesce(sum(i.quantity * p.cost_price), 0), 2) as v from public.inventory i join public.products p on p.id = i.product_id",
    );
    expect(kpis.inventory_value).toBe(raw);
    expect(await scalar("select round(sum(inventory_value), 2) as v from public.warehouse_stock_summary")).toBe(raw);
    expect(await scalar("select round(sum(inventory_value), 2) as v from public.inventory_valuation_as_of($1)", [kpis.business_today])).toBe(raw);
  });

  it("inventory still matches the ledger everywhere", async () => {
    expect(
      await scalar(
        `select count(*) as v from (
           select i.id from public.inventory i
           left join public.stock_movements m on m.product_id = i.product_id and m.warehouse_id = i.warehouse_id
           group by i.id having i.quantity <> coalesce(sum(m.quantity_change), 0)) x`,
      ),
    ).toBe("0");
  });

  it("low / out-of-stock KPIs = Low Stock Report = stock alerts", async () => {
    const low = await scalar(
      `select count(*) as v from public.inventory i join public.products p on p.id = i.product_id
       join public.warehouses w on w.id = i.warehouse_id
       where p.is_active and w.is_active and i.quantity > 0 and i.quantity <= p.min_stock_level`,
    );
    const out = await scalar(
      `select count(*) as v from public.inventory i join public.products p on p.id = i.product_id
       join public.warehouses w on w.id = i.warehouse_id
       where p.is_active and w.is_active and i.quantity = 0`,
    );
    expect(String(kpis.low_stock_items)).toBe(low);
    expect(String(kpis.out_of_stock_items)).toBe(out);
    expect(await scalar("select count(*) as v from public.v_alerts where alert_type in ('LOW_STOCK', 'OUT_OF_STOCK')")).toBe(
      String(Number(low) + Number(out)),
    );
  });

  it("pending orders and products = direct counts", async () => {
    expect(String(kpis.pending_purchase_orders)).toBe(
      await scalar("select count(*) as v from public.purchase_orders where status in ('SUBMITTED','APPROVED','PARTIALLY_RECEIVED')"),
    );
    expect(String(kpis.pending_sales_orders)).toBe(
      await scalar("select count(*) as v from public.sales_orders where status in ('CONFIRMED','PROCESSING')"),
    );
    expect(String(kpis.total_products)).toBe(await scalar("select count(*) as v from public.products where is_active"));
  });

  it("monthly sales = shipped order totals; monthly purchases = non-reversed receipt lines", async () => {
    expect(kpis.sales_month).toBe(
      await scalar(
        `select round(coalesce(sum(total_amount), 0), 2) as v from public.sales_orders
         where status in ('SHIPPED','COMPLETED')
           and (shipped_at at time zone 'Asia/Jerusalem')::date between $1 and $2`,
        [kpis.month_start, kpis.business_today],
      ),
    );
    expect(kpis.purchases_month).toBe(
      await scalar(
        `select round(coalesce(sum(i.quantity_received * i.unit_cost), 0), 2) as v
         from public.goods_receipt_items i join public.goods_receipts g on g.id = i.goods_receipt_id
         where g.reversed_at is null and (g.received_at at time zone 'Asia/Jerusalem')::date between $1 and $2`,
        [kpis.month_start, kpis.business_today],
      ),
    );
  });

  it("chart functions add up to the same totals for the month", async () => {
    const trend = await client.query<{ purchases: string; sales: string }>(
      "select * from public.purchases_vs_sales($1, $2, 'day')",
      [kpis.month_start, kpis.business_today],
    );
    expect(trend.rows.reduce((s, r) => s + Number(r.purchases), 0).toFixed(2)).toBe(kpis.purchases_month);
    expect(trend.rows.reduce((s, r) => s + Number(r.sales), 0).toFixed(2)).toBe(kpis.sales_month);

    const byType = await client.query<{ movement_count: number }>("select * from public.movements_by_type($1, $2)", [
      kpis.month_start,
      kpis.business_today,
    ]);
    const ledger = await scalar(
      "select count(*) as v from public.stock_movements where (movement_date at time zone 'Asia/Jerusalem')::date between $1 and $2",
      [kpis.month_start, kpis.business_today],
    );
    expect(String(byType.rows.reduce((s, r) => s + r.movement_count, 0))).toBe(ledger);
    expect(String(kpis.movements_today)).toBe(
      await scalar(
        "select count(*) as v from public.stock_movements where (movement_date at time zone 'Asia/Jerusalem')::date = $1",
        [kpis.business_today],
      ),
    );
  });
});
