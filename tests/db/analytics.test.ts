import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

/**
 * Dashboard, reports and BI views must tell the same story. A small known
 * scenario is posted through the real workflows, then every number is compared
 * against the raw tables and against each other.
 */
describe("analytics, reports and BI views", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let seller: TestUser;
  let buyer: TestUser;
  let inactive: TestUser;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    seller = await createUser(db, "seller@stockflow.test", "sales");
    buyer = await createUser(db, "buyer@stockflow.test", "purchasing");
    inactive = await createUser(db, "former@stockflow.test", "warehouse_manager");
    await db.query("update public.profiles set is_active = false where id = $1", [inactive.id]);

    const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
    id.tlv = await one("select id from public.warehouses where code = 'WH-TLV'");
    id.hfa = await one("select id from public.warehouses where code = 'WH-HFA'");
    id.mouse = await one("select id from public.products where sku = 'CMP-2001'"); // cost 32, price 69, min 40
    id.keyboard = await one("select id from public.products where sku = 'CMP-2002'"); // cost 180, price 289, min 15
    id.supplier = await one("select id from public.suppliers order by code limit 1");
    id.customer = await one("select id from public.customers where code = 'CUS-001'");
    id.comp = await one("select id from public.categories where code = 'COMP'");

    const as = <T>(u: TestUser, fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: u.id }, fn);
    const q = <T>(u: TestUser, sql: string, params: unknown[] = []) =>
      as(u, async () => (await db.query<T & { id: string }>(sql, params)).rows[0]);

    // Opening stock: 50 mice + 10 keyboards at TLV.
    await as(manager, async () => {
      await db.query("select public.create_stock_movement($1, $2, 'ADJUSTMENT_IN', 50, p_reason => 'Opening')", [id.mouse, id.tlv]);
      await db.query("select public.create_stock_movement($1, $2, 'ADJUSTMENT_IN', 10, p_reason => 'Opening')", [id.keyboard, id.tlv]);
    });

    // Purchase: 20 mice @ 30.00, 15 received today -> purchases 450.00.
    const po = await q<{ id: string }>(buyer, "select * from public.create_purchase_order($1, $2, $3::jsonb)", [
      id.supplier, id.tlv, JSON.stringify([{ product_id: id.mouse, quantity: 20, unit_cost: 30 }]),
    ]);
    await as(buyer, () => db.query("select public.submit_purchase_order($1)", [po.id]));
    await as(admin, () => db.query("select public.approve_purchase_order($1)", [po.id]));
    const poLine = await one("select id from public.purchase_order_items where purchase_order_id = $1", [po.id]);
    await as(manager, () =>
      db.query("select public.receive_goods($1, $2::jsonb)", [po.id, JSON.stringify([{ purchase_order_item_id: poLine, quantity: 15 }])]),
    );

    // A receipt that is reversed must not count as a purchase.
    const po2 = await q<{ id: string }>(buyer, "select * from public.create_purchase_order($1, $2, $3::jsonb)", [
      id.supplier, id.tlv, JSON.stringify([{ product_id: id.keyboard, quantity: 5, unit_cost: 175 }]),
    ]);
    await as(buyer, () => db.query("select public.submit_purchase_order($1)", [po2.id]));
    await as(admin, () => db.query("select public.approve_purchase_order($1)", [po2.id]));
    const po2Line = await one("select id from public.purchase_order_items where purchase_order_id = $1", [po2.id]);
    const receipt2 = await q<{ id: string }>(manager, "select * from public.receive_goods($1, $2::jsonb)", [
      po2.id, JSON.stringify([{ purchase_order_item_id: po2Line, quantity: 5 }]),
    ]);
    await as(manager, () => db.query("select public.reverse_goods_receipt($1, 'Wrong delivery')", [receipt2.id]));

    // Sale: 10 mice @ 69 -10% (621.00) + 2 keyboards @ 289 (578.00) = 1,199.00; COGS 320 + 360 = 680.
    const so = await q<{ id: string }>(seller, "select * from public.create_sales_order($1, $2, $3::jsonb)", [
      id.customer, id.tlv,
      JSON.stringify([
        { product_id: id.mouse, quantity: 10, discount_percent: 10 },
        { product_id: id.keyboard, quantity: 2 },
      ]),
    ]);
    id.so = so.id;
    await as(seller, () => db.query("select public.confirm_sales_order($1)", [so.id]));
    await as(manager, () => db.query("select public.start_processing_sales_order($1)", [so.id]));
    await as(manager, () => db.query("select public.ship_sales_order($1)", [so.id]));

    // A shipment that is reversed must not count as a sale (order goes back to CONFIRMED).
    const so2 = await q<{ id: string }>(seller, "select * from public.create_sales_order($1, $2, $3::jsonb)", [
      id.customer, id.tlv, JSON.stringify([{ product_id: id.mouse, quantity: 5 }]),
    ]);
    await as(seller, () => db.query("select public.confirm_sales_order($1)", [so2.id]));
    await as(manager, () => db.query("select public.start_processing_sales_order($1)", [so2.id]));
    await as(manager, () => db.query("select public.ship_sales_order($1)", [so2.id]));
    await as(manager, () => db.query("select public.reverse_sales_order_shipment($1, 'Refused')", [so2.id]));

    // Transfer 5 keyboards TLV -> HFA.
    const transfer = await q<{ id: string }>(manager, "select * from public.request_stock_transfer($1, $2, $3::jsonb)", [
      id.tlv, id.hfa, JSON.stringify([{ product_id: id.keyboard, quantity: 5 }]),
    ]);
    await as(admin, () => db.query("select public.approve_stock_transfer($1)", [transfer.id]));
    await as(manager, () => db.query("select public.execute_stock_transfer($1)", [transfer.id]));

    // A product change (audited by trigger).
    await as(manager, () => db.query("update public.products set sale_price = 72 where id = $1", [id.mouse]));
  });

  afterAll(async () => {
    await db.close();
  });

  const asManager = <T>(fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: manager.id }, fn);
  const scalar = async (sql: string, params: unknown[] = []): Promise<string> => {
    const r = await asManager(() => db.query<{ v: string | number | null }>(sql, params));
    return String(r.rows[0].v);
  };

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
  }

  async function kpis(): Promise<Kpis> {
    return (await asManager(() => db.query<Kpis>("select * from public.dashboard_kpis()"))).rows[0];
  }

  describe("dashboard KPIs match the raw tables and the reports", () => {
    it("inventory value = BI view = warehouse totals = as-of-today valuation report", async () => {
      const k = await kpis();
      expect(k.inventory_value).toBe(await scalar("select round(sum(quantity * cost_price), 2) as v from public.inventory i join public.products p on p.id = i.product_id"));
      expect(k.inventory_value).toBe(await scalar("select round(sum(inventory_value), 2) as v from public.v_inventory_valuation"));
      expect(k.inventory_value).toBe(await scalar("select round(sum(inventory_value), 2) as v from public.warehouse_stock_summary"));
      expect(k.inventory_value).toBe(
        await scalar("select round(sum(inventory_value), 2) as v from public.inventory_valuation_as_of(private.business_date())"),
      );
    });

    it("low / out-of-stock counts = the Low Stock Report rows", async () => {
      const k = await kpis();
      expect(k.low_stock_items).toBe(Number(await scalar("select count(*) as v from public.v_low_stock where stock_status = 'LOW_STOCK'")));
      expect(k.out_of_stock_items).toBe(Number(await scalar("select count(*) as v from public.v_low_stock where stock_status = 'OUT_OF_STOCK'")));
      // The mouse at TLV: 50 + 15 - 10 = 55 > 40 (in stock); keyboards at TLV: 10 - 2 - 5 = 3 <= 15 (low).
      expect(await scalar("select stock_status as v from public.v_low_stock where sku = 'CMP-2002' and warehouse_code = 'WH-TLV'")).toBe("LOW_STOCK");
    });

    it("pending orders, products and today's movements = direct counts", async () => {
      const k = await kpis();
      expect(k.total_products).toBe(await count(db, "select count(*) n from public.products where is_active"));
      expect(k.pending_purchase_orders).toBe(
        await count(db, "select count(*) n from public.purchase_orders where status in ('SUBMITTED','APPROVED','PARTIALLY_RECEIVED')"),
      );
      expect(k.pending_purchase_orders).toBe(2); // PO 1 partially received, PO 2 back to approved
      expect(k.pending_sales_orders).toBe(1); // the reversed order is confirmed again
      expect(k.movements_today).toBe(await count(db, "select count(*) n from public.stock_movements"));
    });

    it("monthly purchases exclude reversed receipts; monthly sales exclude reversed shipments", async () => {
      const k = await kpis();
      expect(k.purchases_month).toBe("450.00");
      expect(k.sales_month).toBe("1199.00");
      expect(k.sales_month).toBe(
        await scalar("select round(sum(total_amount), 2) as v from public.sales_orders where status in ('SHIPPED','COMPLETED')"),
      );
    });
  });

  describe("sales and purchase lines", () => {
    it("computes revenue after discount, COGS at the shipped unit cost and margin", async () => {
      const r = await asManager(() =>
        db.query<{ sku: string; net_revenue: string; cogs: string; gross_margin: string }>(
          "select sku, net_revenue, cogs, gross_margin from public.v_sales_lines where sales_order_id = $1 order by sku",
          [id.so],
        ),
      );
      expect(r.rows).toEqual([
        { sku: "CMP-2001", net_revenue: "621.00", cogs: "320.00", gross_margin: "301.00" },
        { sku: "CMP-2002", net_revenue: "578.00", cogs: "360.00", gross_margin: "218.00" },
      ]);
      const byProduct = await asManager(() =>
        db.query<{ net_revenue: string }>("select net_revenue from public.v_sales_by_product where sku = 'CMP-2001'"),
      );
      expect(byProduct.rows[0].net_revenue).toBe("621.00");
    });

    it("rolls monthly BI views up from the same lines", async () => {
      expect(await scalar("select sum(net_revenue) as v from public.v_sales_monthly")).toBe("1199.00");
      expect(await scalar("select sum(purchase_value) as v from public.v_purchases_monthly")).toBe("450.00");
      expect(await scalar("select sum(cogs) as v from public.v_sales_monthly")).toBe("680.00");
    });
  });

  describe("chart functions", () => {
    it("purchases vs sales: buckets cover the range and add up to the KPIs", async () => {
      const k = await kpis();
      const rows = await asManager(() =>
        db.query<{ bucket_start: string; purchases: string; sales: string }>(
          "select * from public.purchases_vs_sales(private.business_date() - 6, private.business_date(), 'day')",
        ),
      );
      expect(rows.rows).toHaveLength(7); // empty days included
      expect(rows.rows.reduce((s, r) => s + Number(r.purchases), 0).toFixed(2)).toBe(k.purchases_month);
      expect(rows.rows.reduce((s, r) => s + Number(r.sales), 0).toFixed(2)).toBe(k.sales_month);
    });

    it("movements by type add up to the ledger", async () => {
      const rows = await asManager(() =>
        db.query<{ movement_type: string; movement_count: number; units: number }>(
          "select * from public.movements_by_type(private.business_date() - 30, private.business_date())",
        ),
      );
      expect(rows.rows.reduce((s, r) => s + r.movement_count, 0)).toBe(await count(db, "select count(*) n from public.stock_movements"));
      expect(rows.rows.reduce((s, r) => s + r.units, 0)).toBe(Number(await scalar("select sum(quantity) as v from public.stock_movements")));
      expect(rows.rows.find((r) => r.movement_type === "TRANSFER_OUT")).toMatchObject({ movement_count: 1, units: 5 });
    });

    it("top products are ranked by units moved and agree with the ledger", async () => {
      const rows = await asManager(() =>
        db.query<{ sku: string; units_moved: number; units_in: number; units_out: number }>(
          "select * from public.top_products_by_movement(private.business_date() - 30, private.business_date(), 10)",
        ),
      );
      expect(rows.rows.map((r) => r.sku)).toEqual(["CMP-2001", "CMP-2002"]);
      // Mouse: in 50 + 15 + 5 (reversal) ; out 10 + 5 = 85 units moved.
      expect(rows.rows[0]).toMatchObject({ units_in: 70, units_out: 15, units_moved: 85 });
      expect(rows.rows[0].units_moved).toBe(
        Number(await scalar("select sum(quantity) as v from public.stock_movements where product_id = $1", [id.mouse])),
      );
    });
  });

  describe("reports", () => {
    it("as-of valuation: nothing recorded before today, today = current stock (with filters)", async () => {
      expect(Number(await scalar("select count(*) as v from public.inventory_valuation_as_of(private.business_date() - 1)"))).toBe(0);
      const filtered = await scalar(
        "select round(sum(inventory_value), 2) as v from public.inventory_valuation_as_of(private.business_date(), $1, $2)",
        [id.tlv, id.comp],
      );
      expect(filtered).toBe(
        await scalar(
          "select round(sum(inventory_value), 2) as v from public.v_inventory_valuation where warehouse_id = $1 and category_id = $2 and quantity <> 0",
          [id.tlv, id.comp],
        ),
      );
    });

    it("movement report totals = the filtered ledger rows", async () => {
      const t = await asManager(() =>
        db.query<{ movement_count: number; units_in: number; units_out: number; value_in: string; value_out: string }>(
          "select * from public.movement_report_totals(private.business_date(), private.business_date(), $1)",
          [id.tlv],
        ),
      );
      const raw = await asManager(() =>
        db.query<{ n: number; units_in: number; units_out: number }>(
          `select count(*)::int n,
                  coalesce(sum(quantity) filter (where direction = 1), 0)::int units_in,
                  coalesce(sum(quantity) filter (where direction = -1), 0)::int units_out
           from public.stock_movements where warehouse_id = $1`,
          [id.tlv],
        ),
      );
      expect(t.rows[0]).toMatchObject({
        movement_count: raw.rows[0].n,
        units_in: raw.rows[0].units_in,
        units_out: raw.rows[0].units_out,
      });
    });

    it("low stock report suggests at least the reorder quantity and covers the shortfall", async () => {
      const r = await asManager(() =>
        db.query<{ quantity: number; min_stock_level: number; shortfall: number; suggested_order_quantity: number }>(
          "select quantity, min_stock_level, shortfall, suggested_order_quantity from public.v_low_stock where sku = 'CMP-2002' and warehouse_code = 'WH-TLV'",
        ),
      );
      expect(r.rows[0]).toEqual({ quantity: 3, min_stock_level: 15, shortfall: 12, suggested_order_quantity: 30 });
    });
  });

  describe("alerts", () => {
    it("computes low stock, pending approval, delayed POs, late sales orders and pending transfers", async () => {
      const q = <T>(u: TestUser, sql: string, params: unknown[]) =>
        runAs(db, { role: "authenticated", userId: u.id }, async () => (await db.query<T>(sql, params)).rows[0]);

      // Submitted PO -> pending approval.
      const pending = await q<{ id: string }>(buyer, "select * from public.create_purchase_order($1, $2, $3::jsonb)", [
        id.supplier, id.hfa, JSON.stringify([{ product_id: id.mouse, quantity: 1 }]),
      ]);
      await runAs(db, { role: "authenticated", userId: buyer.id }, () => db.query("select public.submit_purchase_order($1)", [pending.id]));

      // Approved PO expected 3 days ago -> delayed (warning).
      const late = await q<{ id: string }>(
        buyer,
        "select * from public.create_purchase_order($1, $2, $3::jsonb, private.business_date() - 10, private.business_date() - 3)",
        [id.supplier, id.hfa, JSON.stringify([{ product_id: id.mouse, quantity: 1 }])],
      );
      await runAs(db, { role: "authenticated", userId: buyer.id }, () => db.query("select public.submit_purchase_order($1)", [late.id]));
      await runAs(db, { role: "authenticated", userId: admin.id }, () => db.query("select public.approve_purchase_order($1)", [late.id]));

      // Confirmed SO whose requested delivery has passed -> unprocessed (critical).
      const lateSo = await q<{ id: string }>(
        seller,
        "select * from public.create_sales_order($1, $2, $3::jsonb, private.business_date() - 5, private.business_date() - 1)",
        [id.customer, id.hfa, JSON.stringify([{ product_id: id.mouse, quantity: 1 }])],
      );
      await runAs(db, { role: "authenticated", userId: seller.id }, () => db.query("select public.confirm_sales_order($1)", [lateSo.id]));

      // Requested transfer -> pending.
      await runAs(db, { role: "authenticated", userId: manager.id }, () =>
        db.query("select public.request_stock_transfer($1, $2, $3::jsonb)", [id.tlv, id.hfa, JSON.stringify([{ product_id: id.mouse, quantity: 1 }])]),
      );

      const alerts = await asManager(() =>
        db.query<{ alert_type: string; severity: string; entity_id: string; reference: string }>(
          "select alert_type, severity, entity_id, reference from public.v_alerts",
        ),
      );
      const find = (type: string, entity?: string) => alerts.rows.find((a) => a.alert_type === type && (!entity || a.entity_id === entity));
      expect(find("LOW_STOCK", id.keyboard)).toMatchObject({ severity: "warning", reference: "CMP-2002 @ WH-TLV" });
      expect(find("PENDING_PO_APPROVAL", pending.id)).toMatchObject({ severity: "info" });
      expect(find("DELAYED_PO", late.id)).toMatchObject({ severity: "warning" });
      expect(find("UNPROCESSED_SO", lateSo.id)).toMatchObject({ severity: "critical" });
      expect(find("PENDING_TRANSFER")).toMatchObject({ severity: "info" });
      // Stock alerts are exactly the Low Stock Report rows.
      expect(alerts.rows.filter((a) => a.alert_type === "LOW_STOCK" || a.alert_type === "OUT_OF_STOCK")).toHaveLength(
        await count(db, "select count(*) n from public.v_low_stock"),
      );
    });
  });

  describe("audit coverage", () => {
    it("logs product changes, approvals, receipts, shipments, adjustments and transfers", async () => {
      const facets = await runAs(db, { role: "authenticated", userId: admin.id }, () =>
        db.query<{ facet: string; value: string }>("select facet, value from public.audit_log_facets()"),
      );
      const actions = facets.rows.filter((f) => f.facet === "action").map((f) => f.value);
      for (const action of [
        "UPDATE", // product change (trigger)
        "PO_APPROVE",
        "GOODS_RECEIPT",
        "GOODS_RECEIPT_REVERSAL",
        "SO_SHIP",
        "SO_SHIPMENT_REVERSAL",
        "STOCK_MOVEMENT",
        "STOCK_REVERSAL",
        "TRANSFER_REQUEST",
        "TRANSFER_APPROVE",
        "TRANSFER_EXECUTE",
      ]) {
        expect(actions, action).toContain(action);
      }
      expect(
        await count(
          db,
          `select count(*) n from public.audit_log where action = 'STOCK_MOVEMENT' and details ->> 'movement_type' = 'ADJUSTMENT_IN'`,
        ),
      ).toBeGreaterThanOrEqual(2);
      expect(
        await count(db, "select count(*) n from public.audit_log where entity_type = 'products' and action = 'UPDATE' and user_id = $1", [manager.id]),
      ).toBe(1);
    });

    it("hides the audit log (and its facets) from non-admins", async () => {
      const r = await asManager(() => db.query("select * from public.audit_log_facets()"));
      expect(r.rows).toEqual([]);
    });
  });

  describe("access", () => {
    it("lets active staff read the BI views, refuses anonymous users, shows deactivated users nothing", async () => {
      for (const view of ["v_inventory_valuation", "v_stock_movements", "v_sales_lines", "v_alerts", "v_low_stock"]) {
        await expect(runAs(db, { role: "anon" }, () => db.query(`select * from public.${view}`))).rejects.toThrow(/permission denied/);
      }
      await expect(runAs(db, { role: "anon" }, () => db.query("select * from public.dashboard_kpis()"))).rejects.toThrow(/permission denied/);

      const k = await runAs(db, { role: "authenticated", userId: inactive.id }, () =>
        db.query<{ inventory_value: string; sales_month: string }>("select inventory_value, sales_month from public.dashboard_kpis()"),
      );
      expect(k.rows[0]).toEqual({ inventory_value: "0.00", sales_month: "0.00" });
      expect(Number(await scalar("select count(*) as v from public.v_sales_lines"))).toBeGreaterThan(0);
    });
  });
});
