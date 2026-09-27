import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

interface SalesOrder {
  id: string;
  so_number: string;
  status: string;
  subtotal: string;
  discount_amount: string;
  total_amount: string;
}

interface Line {
  product_id: string;
  quantity: number;
  unit_price?: number;
  discount_percent?: number;
}

describe("sales order workflow", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let seller: TestUser;
  let buyer: TestUser;
  let customerId: string;
  let warehouseId: string;
  const product: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    seller = await createUser(db, "seller@stockflow.test", "sales");
    buyer = await createUser(db, "buyer@stockflow.test", "purchasing");

    customerId = (await db.query<{ id: string }>("select id from public.customers where code = 'CUS-001'")).rows[0].id;
    warehouseId = (await db.query<{ id: string }>("select id from public.warehouses where code = 'WH-TLV'")).rows[0].id;
    for (const sku of ["CMP-2001", "CMP-2002", "CMP-2003", "CMP-2004", "CMP-2005", "CMP-2006"]) {
      product[sku] = (await db.query<{ id: string }>("select id from public.products where sku = $1", [sku])).rows[0].id;
    }
  });

  afterAll(async () => {
    await db.close();
  });

  const as = <T>(user: TestUser, fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: user.id }, fn);

  async function stock(sku: string, quantity: number): Promise<void> {
    await as(manager, () =>
      db.query("select public.create_stock_movement($1, $2, 'ADJUSTMENT_IN', $3, p_reason => 'Test stock')", [
        product[sku],
        warehouseId,
        quantity,
      ]),
    );
  }

  async function stockOf(sku: string): Promise<number> {
    const r = await db.query<{ quantity: number }>(
      "select quantity from public.inventory where product_id = $1 and warehouse_id = $2",
      [product[sku], warehouseId],
    );
    return r.rows[0]?.quantity ?? 0;
  }

  async function createSo(user: TestUser, lines: Line[]): Promise<SalesOrder> {
    const r = await as(user, () =>
      db.query<SalesOrder>("select * from public.create_sales_order($1, $2, $3::jsonb)", [
        customerId,
        warehouseId,
        JSON.stringify(lines),
      ]),
    );
    return r.rows[0];
  }

  async function step(user: TestUser, fn: string, soId: string): Promise<SalesOrder> {
    const r = await as(user, () => db.query<SalesOrder>(`select * from public.${fn}($1)`, [soId]));
    return r.rows[0];
  }

  async function withReason(user: TestUser, fn: string, soId: string, reason = "Customer changed their mind") {
    const r = await as(user, () => db.query<SalesOrder>(`select * from public.${fn}($1, $2)`, [soId, reason]));
    return r.rows[0];
  }

  /** Draft (sales) -> confirmed (sales) -> processing (warehouse). */
  async function processingSo(lines: Line[]): Promise<SalesOrder> {
    const so = await createSo(seller, lines);
    await step(seller, "confirm_sales_order", so.id);
    return step(manager, "start_processing_sales_order", so.id);
  }

  async function statusOf(soId: string): Promise<string> {
    return (await db.query<{ status: string }>("select status from public.sales_orders where id = $1", [soId])).rows[0].status;
  }

  async function saleMovements(soId: string) {
    const r = await db.query<{ movement_type: string; quantity_change: number; reference_number: string; performed_by: string }>(
      `select movement_type, quantity_change, reference_number, performed_by from public.stock_movements
       where reference_type = 'SALES_ORDER' and reference_id = $1 order by quantity_change`,
      [soId],
    );
    return r.rows;
  }

  describe("discounts and totals", () => {
    it("derives line amounts and order totals from price, quantity and discount", async () => {
      const so = await createSo(seller, [
        { product_id: product["CMP-2001"], quantity: 3, unit_price: 69, discount_percent: 10 }, // 207.00 - 20.70
        { product_id: product["CMP-2002"], quantity: 7, unit_price: 12.99, discount_percent: 12.5 }, // 90.93 - 11.37
        { product_id: product["CMP-2003"], quantity: 1 }, // list price 159.00, no discount
      ]);
      expect(so).toMatchObject({ subtotal: "456.93", discount_amount: "32.07", total_amount: "424.86" });

      const lines = await db.query<{ gross_amount: string; discount_amount: string; line_total: string; unit_price: string }>(
        "select gross_amount, discount_amount, line_total, unit_price from public.sales_order_items where sales_order_id = $1 order by line_number",
        [so.id],
      );
      expect(lines.rows).toEqual([
        { gross_amount: "207.00", discount_amount: "20.70", line_total: "186.30", unit_price: "69.00" },
        { gross_amount: "90.93", discount_amount: "11.37", line_total: "79.56", unit_price: "12.99" },
        { gross_amount: "159.00", discount_amount: "0.00", line_total: "159.00", unit_price: "159.00" },
      ]);
    });

    it("rejects discounts outside 0-100% and duplicate products", async () => {
      await expect(
        createSo(seller, [{ product_id: product["CMP-2001"], quantity: 1, discount_percent: 101 }]),
      ).rejects.toThrow(/discount must be between 0 and 100%/);
      await expect(
        createSo(seller, [
          { product_id: product["CMP-2001"], quantity: 1 },
          { product_id: product["CMP-2001"], quantity: 2 },
        ]),
      ).rejects.toThrow(/appears more than once/);
    });
  });

  describe("shipping", () => {
    it("ships every line through the engine: SALE movements, stock down, SHIPPED, audited", async () => {
      await stock("CMP-2004", 20);
      await stock("CMP-2005", 20);
      const so = await processingSo([
        { product_id: product["CMP-2004"], quantity: 5 },
        { product_id: product["CMP-2005"], quantity: 8 },
      ]);

      const shipped = await step(manager, "ship_sales_order", so.id);
      expect(shipped.status).toBe("SHIPPED");
      expect(await stockOf("CMP-2004")).toBe(15);
      expect(await stockOf("CMP-2005")).toBe(12);
      expect(await saleMovements(so.id)).toEqual([
        { movement_type: "SALE", quantity_change: -8, reference_number: so.so_number, performed_by: manager.id },
        { movement_type: "SALE", quantity_change: -5, reference_number: so.so_number, performed_by: manager.id },
      ]);
      expect(
        await count(db, "select count(*) n from public.sales_order_items where sales_order_id = $1 and quantity_shipped = quantity", [so.id]),
      ).toBe(2);
      expect(
        await count(db, "select count(*) n from public.audit_log where entity_type = 'sales_orders' and entity_id = $1 and action = 'SO_SHIP'", [so.id]),
      ).toBe(1);
    });

    it("refuses the whole shipment if any line is short, names every short product and changes nothing", async () => {
      await stock("CMP-2006", 3); // enough for line 1 only
      const before = { a: await stockOf("CMP-2006"), b: await stockOf("CMP-2001") };
      const movements = await count(db, "select count(*) n from public.stock_movements");
      const so = await processingSo([
        { product_id: product["CMP-2006"], quantity: 3 },
        { product_id: product["CMP-2001"], quantity: 999 },
      ]);

      await expect(step(manager, "ship_sales_order", so.id)).rejects.toMatchObject({
        code: "SF001",
        message: `Cannot ship ${so.so_number}: insufficient stock for CMP-2001 Wireless Mouse (need 999, available ${before.b})`,
      });

      expect(await stockOf("CMP-2006")).toBe(before.a); // the line that had enough was NOT shipped
      expect(await stockOf("CMP-2001")).toBe(before.b);
      expect(await count(db, "select count(*) n from public.stock_movements")).toBe(movements);
      expect(await statusOf(so.id)).toBe("PROCESSING");
      expect(await count(db, "select count(*) n from public.sales_order_items where sales_order_id = $1 and quantity_shipped > 0", [so.id])).toBe(0);
    });

    it("lists every short line, including products never stocked here", async () => {
      const unstocked = (await db.query<{ id: string }>("select id from public.products where sku = 'NET-3002'")).rows[0].id;
      const so = await processingSo([
        { product_id: product["CMP-2001"], quantity: 999 },
        { product_id: unstocked, quantity: 1 },
      ]);
      await expect(step(manager, "ship_sales_order", so.id)).rejects.toThrow(
        /CMP-2001 Wireless Mouse \(need 999, available \d+\); NET-3002 Wi-Fi 6 Router \(need 1, available 0\)/,
      );
    });

    it("accepts a back-dated ship date but not a future one or one before the order date", async () => {
      await stock("CMP-2004", 2);
      // Order dated 3 business days ago, so "1 day ago" is always on or after the order date,
      // whatever the time of day (a same-day order would fail just after midnight in Israel).
      const r = await as(seller, () =>
        db.query<SalesOrder>(
          "select * from public.create_sales_order($1, $2, $3::jsonb, private.business_date() - 3)",
          [customerId, warehouseId, JSON.stringify([{ product_id: product["CMP-2004"], quantity: 1 }])],
        ),
      );
      const so = r.rows[0];
      await step(seller, "confirm_sales_order", so.id);
      await step(manager, "start_processing_sales_order", so.id);
      await expect(
        as(manager, () => db.query("select public.ship_sales_order($1, now() + interval '1 day')", [so.id])),
      ).rejects.toThrow(/future/);
      await expect(
        as(manager, () => db.query("select public.ship_sales_order($1, now() - interval '400 days')", [so.id])),
      ).rejects.toThrow(/before the order date/);
      await as(manager, () => db.query("select public.ship_sales_order($1, now() - interval '1 day')", [so.id]));
      expect(await statusOf(so.id)).toBe("SHIPPED");
    });
  });

  describe("cancelling and reversing", () => {
    it("cancels draft, confirmed and processing orders without touching inventory", async () => {
      const movements = await count(db, "select count(*) n from public.stock_movements");
      const inventory = (await db.query("select product_id, warehouse_id, quantity from public.inventory order by 1, 2")).rows;

      const draft = await createSo(seller, [{ product_id: product["CMP-2001"], quantity: 1 }]);
      const confirmed = await createSo(seller, [{ product_id: product["CMP-2001"], quantity: 1 }]);
      await step(seller, "confirm_sales_order", confirmed.id);
      const processing = await processingSo([{ product_id: product["CMP-2001"], quantity: 1 }]);

      for (const so of [draft, confirmed, processing]) {
        expect((await withReason(seller, "cancel_sales_order", so.id)).status).toBe("CANCELLED");
      }
      expect(await count(db, "select count(*) n from public.stock_movements")).toBe(movements);
      expect((await db.query("select product_id, warehouse_id, quantity from public.inventory order by 1, 2")).rows).toEqual(inventory);
    });

    it("refuses to cancel a shipped order; reversing the shipment restores stock, then it can be cancelled", async () => {
      await stock("CMP-2003", 10);
      const before = await stockOf("CMP-2003");
      const so = await processingSo([{ product_id: product["CMP-2003"], quantity: 4 }]);
      await step(manager, "ship_sales_order", so.id);
      expect(await stockOf("CMP-2003")).toBe(before - 4);

      await expect(withReason(seller, "cancel_sales_order", so.id)).rejects.toMatchObject({ code: "SF009" });

      const reset = await withReason(manager, "reverse_sales_order_shipment", so.id, "Customer refused delivery");
      expect(reset.status).toBe("CONFIRMED");
      expect(await stockOf("CMP-2003")).toBe(before);

      const reversal = await db.query<{ movement_type: string; quantity_change: number; reference_type: string; reason: string }>(
        `select r.movement_type, r.quantity_change, r.reference_type, r.reason
         from public.stock_movements m join public.stock_movements r on r.reversal_of_id = m.id
         where m.reference_type = 'SALES_ORDER' and m.reference_id = $1`,
        [so.id],
      );
      expect(reversal.rows).toEqual([
        { movement_type: "ADJUSTMENT_IN", quantity_change: 4, reference_type: "REVERSAL", reason: "Customer refused delivery" },
      ]);
      // The original SALE movement is still in the ledger.
      expect(await saleMovements(so.id)).toHaveLength(1);

      expect((await withReason(seller, "cancel_sales_order", so.id)).status).toBe("CANCELLED");
    });

    it("can process and ship an order again after its shipment was reversed", async () => {
      await stock("CMP-2005", 6);
      const so = await processingSo([{ product_id: product["CMP-2005"], quantity: 3 }]);
      await step(manager, "ship_sales_order", so.id);
      await withReason(manager, "reverse_sales_order_shipment", so.id, "Wrong address");
      await step(manager, "start_processing_sales_order", so.id);
      await step(manager, "ship_sales_order", so.id);
      expect(await statusOf(so.id)).toBe("SHIPPED");
      expect(await saleMovements(so.id)).toHaveLength(2);
    });

    it("closes completed orders: no cancel, no reversal", async () => {
      await stock("CMP-2004", 1);
      const so = await processingSo([{ product_id: product["CMP-2004"], quantity: 1 }]);
      await step(manager, "ship_sales_order", so.id);
      expect((await step(seller, "complete_sales_order", so.id)).status).toBe("COMPLETED");
      await expect(withReason(seller, "cancel_sales_order", so.id)).rejects.toMatchObject({ code: "SF009" });
      await expect(withReason(manager, "reverse_sales_order_shipment", so.id)).rejects.toMatchObject({ code: "SF007" });
    });
  });

  describe("status transitions are enforced in the database", () => {
    it("rejects out-of-order workflow calls", async () => {
      const so = await createSo(seller, [{ product_id: product["CMP-2001"], quantity: 1 }]);
      await expect(step(manager, "ship_sales_order", so.id)).rejects.toMatchObject({ code: "SF007" });
      await expect(step(manager, "start_processing_sales_order", so.id)).rejects.toMatchObject({ code: "SF007" });
      await expect(step(seller, "complete_sales_order", so.id)).rejects.toMatchObject({ code: "SF007" });
      await step(seller, "confirm_sales_order", so.id);
      await expect(step(seller, "confirm_sales_order", so.id)).rejects.toMatchObject({ code: "SF007" });
      await expect(step(manager, "ship_sales_order", so.id)).rejects.toMatchObject({ code: "SF007" });
    });

    it("rejects invalid transitions and edits even for direct SQL by the table owner", async () => {
      const so = await createSo(seller, [{ product_id: product["CMP-2001"], quantity: 1 }]);
      await expect(db.query("update public.sales_orders set status = 'SHIPPED' where id = $1", [so.id])).rejects.toThrow(
        /cannot go from DRAFT to SHIPPED/,
      );
      await step(seller, "confirm_sales_order", so.id);
      await expect(
        db.query("update public.sales_order_items set quantity = 50 where sales_order_id = $1", [so.id]),
      ).rejects.toMatchObject({ code: "SF007" });
      await expect(
        db.query("update public.sales_orders set customer_id = (select id from public.customers where code = 'CUS-002') where id = $1", [so.id]),
      ).rejects.toMatchObject({ code: "SF007" });
      await expect(
        db.query("insert into public.sales_orders (customer_id, warehouse_id, status) values ($1, $2, 'CONFIRMED')", [customerId, warehouseId]),
      ).rejects.toThrow(/start as DRAFT/);
    });

    it("does not let sales stock be posted or reversed outside the workflow", async () => {
      await stock("CMP-2006", 2);
      const so = await processingSo([{ product_id: product["CMP-2006"], quantity: 1 }]);
      await expect(
        as(manager, () =>
          db.query(
            `select public.create_stock_movement($1, $2, 'SALE', 1, p_reference_type => 'SALES_ORDER', p_reference_id => $3)`,
            [product["CMP-2006"], warehouseId, so.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "SF008" });

      await step(manager, "ship_sales_order", so.id);
      const movementId = (
        await db.query<{ id: string }>("select id from public.stock_movements where reference_type = 'SALES_ORDER' and reference_id = $1", [so.id])
      ).rows[0].id;
      await expect(
        as(manager, () => db.query("select public.reverse_stock_movement($1, 'x')", [movementId])),
      ).rejects.toMatchObject({ code: "SF008", message: expect.stringContaining("reverse the order's shipment instead") });
    });
  });

  describe("permissions", () => {
    it("sales drafts, confirms, completes and cancels but cannot process, ship or reverse", async () => {
      await stock("CMP-2004", 1);
      const so = await createSo(seller, [{ product_id: product["CMP-2004"], quantity: 1 }]);
      await step(seller, "confirm_sales_order", so.id);
      await expect(step(seller, "start_processing_sales_order", so.id)).rejects.toMatchObject({ code: "42501" });
      await step(manager, "start_processing_sales_order", so.id);
      await expect(step(seller, "ship_sales_order", so.id)).rejects.toMatchObject({ code: "42501" });
      await step(manager, "ship_sales_order", so.id);
      await expect(withReason(seller, "reverse_sales_order_shipment", so.id)).rejects.toMatchObject({ code: "42501" });
    });

    it("warehouse managers and purchasing cannot create, confirm or cancel sales orders", async () => {
      await expect(createSo(manager, [{ product_id: product["CMP-2001"], quantity: 1 }])).rejects.toMatchObject({ code: "42501" });
      await expect(createSo(buyer, [{ product_id: product["CMP-2001"], quantity: 1 }])).rejects.toMatchObject({ code: "42501" });
      const so = await createSo(seller, [{ product_id: product["CMP-2001"], quantity: 1 }]);
      await expect(step(manager, "confirm_sales_order", so.id)).rejects.toMatchObject({ code: "42501" });
      await expect(withReason(buyer, "cancel_sales_order", so.id)).rejects.toMatchObject({ code: "42501" });
    });

    it("admins can do every step", async () => {
      await stock("CMP-2005", 1);
      const so = await createSo(admin, [{ product_id: product["CMP-2005"], quantity: 1 }]);
      for (const fn of ["confirm_sales_order", "start_processing_sales_order", "ship_sales_order", "complete_sales_order"]) {
        await step(admin, fn, so.id);
      }
      expect(await statusOf(so.id)).toBe("COMPLETED");
    });

    it("rejects anonymous callers and direct client writes", async () => {
      await expect(
        runAs(db, { role: "anon" }, () => db.query("select public.create_sales_order($1, $2, '[]'::jsonb)", [customerId, warehouseId])),
      ).rejects.toThrow(/permission denied for function create_sales_order/);
      await expect(
        as(admin, () => db.query("insert into public.sales_orders (customer_id, warehouse_id) values ($1, $2)", [customerId, warehouseId])),
      ).rejects.toThrow(/permission denied/);
      await expect(as(seller, () => db.query("update public.sales_orders set status = 'COMPLETED'"))).rejects.toThrow(/permission denied/);
    });

    it("sales and admins maintain customers; other roles only read them", async () => {
      await as(seller, () => db.query("insert into public.customers (code, name) values ('CUS-500', 'New Retail Chain Ltd.')"));
      const updated = await as(seller, () => db.query("update public.customers set credit_limit = 50000 where code = 'CUS-500'"));
      expect(updated.affectedRows).toBe(1);

      for (const other of [manager, buyer]) {
        await expect(
          as(other, () => db.query("insert into public.customers (code, name) values ('CUS-501', 'Nope Ltd.')")),
        ).rejects.toThrow(/row-level security/);
        const r = await as(other, () => db.query("update public.customers set credit_limit = 1 where code = 'CUS-500'"));
        expect(r.affectedRows).toBe(0);
      }
      await expect(as(seller, () => db.query("delete from public.customers where code = 'CUS-500'"))).rejects.toThrow(/permission denied/);

      const audit = await db.query<{ action: string; user_email: string }>(
        `select a.action, a.user_email from public.audit_log a join public.customers c on a.entity_id = c.id::text
         where a.entity_type = 'customers' and c.code = 'CUS-500' order by a.id`,
      );
      expect(audit.rows).toEqual([
        { action: "INSERT", user_email: seller.email },
        { action: "UPDATE", user_email: seller.email },
      ]);
    });
  });

  describe("customer sales summary", () => {
    it("reports sales value, last order and open orders", async () => {
      await db.query("insert into public.customers (code, name) values ('CUS-600', 'Summary Customer Ltd.')");
      const summaryCustomer = (await db.query<{ id: string }>("select id from public.customers where code = 'CUS-600'")).rows[0].id;
      await stock("CMP-2006", 10);

      const make = async (quantity: number, price: number) => {
        const r = await as(seller, () =>
          db.query<SalesOrder>("select * from public.create_sales_order($1, $2, $3::jsonb)", [
            summaryCustomer,
            warehouseId,
            JSON.stringify([{ product_id: product["CMP-2006"], quantity, unit_price: price }]),
          ]),
        );
        return r.rows[0];
      };

      await make(1, 5); // draft: not counted as open or sold
      const open = await make(2, 10); // confirmed: open 20
      await step(seller, "confirm_sales_order", open.id);
      const sold = await make(3, 100); // shipped: sold 300
      await step(seller, "confirm_sales_order", sold.id);
      await step(manager, "start_processing_sales_order", sold.id);
      await step(manager, "ship_sales_order", sold.id);
      const cancelled = await make(1, 999);
      await withReason(seller, "cancel_sales_order", cancelled.id);

      const r = await db.query(
        `select order_count, total_sales_value, open_count, open_value, last_order_date = private.business_date() as ordered_today
         from public.customer_sales_summary where customer_id = $1`,
        [summaryCustomer],
      );
      expect(r.rows[0]).toEqual({
        order_count: 3,
        total_sales_value: "300.00",
        open_count: 1,
        open_value: "20.00",
        ordered_today: true,
      });
    });
  });
});
