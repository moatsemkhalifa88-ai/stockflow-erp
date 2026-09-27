import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  total_amount: string;
}

interface Line {
  id: string;
  line_number: number;
  product_id: string;
  quantity_ordered: number;
  quantity_received: number;
}

interface Receipt {
  id: string;
  receipt_number: string;
}

describe("purchasing workflow", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let buyer: TestUser;
  let inactiveBuyer: TestUser;
  let supplierId: string;
  let warehouseId: string;
  let mouse: string; // CMP-2001, cost 32.00
  let keyboard: string; // CMP-2002, cost 180.00

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    buyer = await createUser(db, "buyer@stockflow.test", "purchasing");
    inactiveBuyer = await createUser(db, "former.buyer@stockflow.test", "purchasing");
    await db.query("update public.profiles set is_active = false where id = $1", [inactiveBuyer.id]);

    supplierId = (await db.query<{ id: string }>("select id from public.suppliers order by code limit 1")).rows[0].id;
    warehouseId = (await db.query<{ id: string }>("select id from public.warehouses where code = 'WH-TLV'")).rows[0].id;
    mouse = (await db.query<{ id: string }>("select id from public.products where sku = 'CMP-2001'")).rows[0].id;
    keyboard = (await db.query<{ id: string }>("select id from public.products where sku = 'CMP-2002'")).rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  const as = <T>(user: TestUser, fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: user.id }, fn);

  async function createPo(
    user: TestUser,
    items: { product_id: string; quantity: number; unit_cost?: number }[],
  ): Promise<PurchaseOrder> {
    const r = await as(user, () =>
      db.query<PurchaseOrder>("select * from public.create_purchase_order($1, $2, $3::jsonb)", [
        supplierId,
        warehouseId,
        JSON.stringify(items),
      ]),
    );
    return r.rows[0];
  }

  async function step(user: TestUser, fn: "submit" | "approve", poId: string): Promise<PurchaseOrder> {
    const r = await as(user, () => db.query<PurchaseOrder>(`select * from public.${fn}_purchase_order($1)`, [poId]));
    return r.rows[0];
  }

  async function cancel(user: TestUser, poId: string, reason = "Supplier cannot deliver"): Promise<PurchaseOrder> {
    const r = await as(user, () =>
      db.query<PurchaseOrder>("select * from public.cancel_purchase_order($1, $2)", [poId, reason]),
    );
    return r.rows[0];
  }

  /** Draft -> submitted (buyer) -> approved (admin). */
  async function approvedPo(items: { product_id: string; quantity: number; unit_cost?: number }[]): Promise<PurchaseOrder> {
    const po = await createPo(buyer, items);
    await step(buyer, "submit", po.id);
    return step(admin, "approve", po.id);
  }

  async function lines(poId: string): Promise<Line[]> {
    const r = await db.query<Line>(
      "select id, line_number, product_id, quantity_ordered, quantity_received from public.purchase_order_items where purchase_order_id = $1 order by line_number",
      [poId],
    );
    return r.rows;
  }

  async function receive(user: TestUser, poId: string, items: { line: Line; quantity: number }[]): Promise<Receipt> {
    const payload = items.map((i) => ({ purchase_order_item_id: i.line.id, quantity: i.quantity }));
    const r = await as(user, () =>
      db.query<Receipt>("select * from public.receive_goods($1, $2::jsonb)", [poId, JSON.stringify(payload)]),
    );
    return r.rows[0];
  }

  async function statusOf(poId: string): Promise<string> {
    return (await db.query<{ status: string }>("select status from public.purchase_orders where id = $1", [poId])).rows[0].status;
  }

  async function stockOf(productId: string): Promise<number> {
    const r = await db.query<{ quantity: number }>(
      "select quantity from public.inventory where product_id = $1 and warehouse_id = $2",
      [productId, warehouseId],
    );
    return r.rows[0]?.quantity ?? 0;
  }

  describe("drafting", () => {
    it("creates a DRAFT with numbered lines, default unit cost and a derived total", async () => {
      const po = await createPo(buyer, [
        { product_id: mouse, quantity: 10 },
        { product_id: keyboard, quantity: 2, unit_cost: 175.5 },
      ]);
      expect(po.status).toBe("DRAFT");
      expect(po.po_number).toMatch(/^PO-\d{6}$/);
      expect(po.total_amount).toBe("671.00"); // 10 x 32.00 + 2 x 175.50
      expect((await lines(po.id)).map((l) => l.line_number)).toEqual([1, 2]);

      const audit = await db.query<{ action: string; user_email: string }>(
        "select action, user_email from public.audit_log where entity_type = 'purchase_orders' and entity_id = $1",
        [po.id],
      );
      expect(audit.rows).toEqual([{ action: "PO_CREATE", user_email: buyer.email }]);
    });

    it("replaces the lines when a draft is edited", async () => {
      const po = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      const r = await as(buyer, () =>
        db.query<PurchaseOrder>("select * from public.update_purchase_order($1, $2, $3, $4::jsonb)", [
          po.id,
          supplierId,
          warehouseId,
          JSON.stringify([{ product_id: keyboard, quantity: 3 }]),
        ]),
      );
      expect(r.rows[0].total_amount).toBe("540.00");
      expect((await lines(po.id)).map((l) => l.product_id)).toEqual([keyboard]);
    });

    it("validates lines: none, duplicates, bad quantities, inactive products", async () => {
      await expect(createPo(buyer, [])).rejects.toThrow(/at least one line/);
      await expect(
        createPo(buyer, [
          { product_id: mouse, quantity: 1 },
          { product_id: mouse, quantity: 2 },
        ]),
      ).rejects.toThrow(/appears more than once/);
      await expect(createPo(buyer, [{ product_id: mouse, quantity: 0 }])).rejects.toThrow(/whole number of 1 or more/);
      const discontinued = (await db.query<{ id: string }>("select id from public.products where not is_active limit 1")).rows[0].id;
      await expect(createPo(buyer, [{ product_id: discontinued, quantity: 1 }])).rejects.toThrow(/inactive/);
    });
  });

  describe("full receipt", () => {
    it("receives every line: goods receipt, one movement per line, RECEIVED, audited", async () => {
      const mouseBefore = await stockOf(mouse);
      const keyboardBefore = await stockOf(keyboard);
      const po = await approvedPo([
        { product_id: mouse, quantity: 10, unit_cost: 30 },
        { product_id: keyboard, quantity: 4 },
      ]);
      const [l1, l2] = await lines(po.id);

      const receipt = await receive(manager, po.id, [
        { line: l1, quantity: 10 },
        { line: l2, quantity: 4 },
      ]);
      expect(receipt.receipt_number).toMatch(/^GR-\d{6}$/);
      expect(await statusOf(po.id)).toBe("RECEIVED");
      expect(await stockOf(mouse)).toBe(mouseBefore + 10);
      expect(await stockOf(keyboard)).toBe(keyboardBefore + 4);

      const movements = await db.query<{
        movement_type: string;
        quantity: number;
        unit_cost: string;
        reference_type: string;
        reference_number: string;
        performed_by: string;
      }>(
        `select m.movement_type, m.quantity, m.unit_cost, m.reference_type, m.reference_number, m.performed_by
         from public.goods_receipt_items g join public.stock_movements m on m.id = g.stock_movement_id
         where g.goods_receipt_id = $1 order by m.quantity desc`,
        [receipt.id],
      );
      expect(movements.rows).toEqual([
        {
          movement_type: "PURCHASE_RECEIPT",
          quantity: 10,
          unit_cost: "30.00", // the PO price, not the product's cost price
          reference_type: "GOODS_RECEIPT",
          reference_number: receipt.receipt_number,
          performed_by: manager.id,
        },
        expect.objectContaining({ movement_type: "PURCHASE_RECEIPT", quantity: 4, unit_cost: "180.00" }),
      ]);

      const actions = await db.query<{ action: string }>(
        `select action from public.audit_log
         where (entity_type = 'goods_receipts' and entity_id = $1::text)
            or (entity_type = 'stock_movements' and details ->> 'movement_number' in
                (select m.movement_number from public.goods_receipt_items g join public.stock_movements m on m.id = g.stock_movement_id where g.goods_receipt_id = $1::uuid))
         order by id`,
        [receipt.id],
      );
      expect(actions.rows.map((a) => a.action)).toEqual(["STOCK_MOVEMENT", "STOCK_MOVEMENT", "GOODS_RECEIPT"]);
    });
  });

  describe("partial receipt then completion", () => {
    it("goes APPROVED -> PARTIALLY_RECEIVED -> RECEIVED across two receipts", async () => {
      const before = await stockOf(mouse);
      const po = await approvedPo([
        { product_id: mouse, quantity: 10 },
        { product_id: keyboard, quantity: 5 },
      ]);
      const [l1, l2] = await lines(po.id);

      await receive(manager, po.id, [{ line: l1, quantity: 6 }]);
      expect(await statusOf(po.id)).toBe("PARTIALLY_RECEIVED");
      expect((await lines(po.id)).map((l) => l.quantity_received)).toEqual([6, 0]);

      await receive(admin, po.id, [
        { line: l1, quantity: 4 },
        { line: l2, quantity: 5 },
      ]);
      expect(await statusOf(po.id)).toBe("RECEIVED");
      expect(await stockOf(mouse)).toBe(before + 10);
      expect(await count(db, "select count(*) n from public.goods_receipts where purchase_order_id = $1", [po.id])).toBe(2);

      const overview = await db.query<{ quantity_received: number; outstanding_value: string; line_count: number }>(
        "select quantity_received, outstanding_value, line_count from public.purchase_order_overview where id = $1",
        [po.id],
      );
      expect(overview.rows[0]).toEqual({ quantity_received: 15, outstanding_value: "0.00", line_count: 2 });
    });
  });

  describe("over-receipt", () => {
    it("rejects receiving more than ordered and changes nothing", async () => {
      const po = await approvedPo([{ product_id: keyboard, quantity: 3 }]);
      const [line] = await lines(po.id);
      const stock = await stockOf(keyboard);
      const receipts = await count(db, "select count(*) n from public.goods_receipts");

      await expect(receive(manager, po.id, [{ line, quantity: 4 }])).rejects.toMatchObject({ code: "SF006" });

      expect(await stockOf(keyboard)).toBe(stock);
      expect(await count(db, "select count(*) n from public.goods_receipts")).toBe(receipts);
      expect(await statusOf(po.id)).toBe("APPROVED");
    });

    it("rejects the cumulative over-receipt on a later receipt", async () => {
      const po = await approvedPo([{ product_id: keyboard, quantity: 5 }]);
      const [line] = await lines(po.id);
      await receive(manager, po.id, [{ line, quantity: 3 }]);
      await expect(receive(manager, po.id, [{ line, quantity: 3 }])).rejects.toMatchObject({
        code: "SF006",
        message: "Cannot receive 3 of line 1 (CMP-2002): only 2 outstanding (5 ordered, 3 already received)",
      });
      expect((await lines(po.id))[0].quantity_received).toBe(3);
    });

    it("rejects receiving a fully received order", async () => {
      const po = await approvedPo([{ product_id: mouse, quantity: 1 }]);
      const [line] = await lines(po.id);
      await receive(manager, po.id, [{ line, quantity: 1 }]);
      await expect(receive(manager, po.id, [{ line, quantity: 1 }])).rejects.toMatchObject({ code: "SF007" });
    });
  });

  describe("cancellation", () => {
    it("cancels a draft, submitted or approved order without touching inventory", async () => {
      const movements = await count(db, "select count(*) n from public.stock_movements");
      const inventory = await db.query("select product_id, warehouse_id, quantity from public.inventory order by 1, 2");

      const draft = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      const submitted = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      await step(buyer, "submit", submitted.id);
      const approved = await approvedPo([{ product_id: mouse, quantity: 1 }]);

      for (const po of [draft, submitted, approved]) {
        const cancelled = await cancel(buyer, po.id);
        expect(cancelled.status).toBe("CANCELLED");
      }

      expect(await count(db, "select count(*) n from public.stock_movements")).toBe(movements);
      expect((await db.query("select product_id, warehouse_id, quantity from public.inventory order by 1, 2")).rows).toEqual(
        inventory.rows,
      );
      const po = await db.query<{ cancelled_by: string; cancel_reason: string }>(
        "select cancelled_by, cancel_reason from public.purchase_orders where id = $1",
        [approved.id],
      );
      expect(po.rows[0]).toEqual({ cancelled_by: buyer.id, cancel_reason: "Supplier cannot deliver" });
    });

    it("requires a reason", async () => {
      const po = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      await expect(cancel(buyer, po.id, " ")).rejects.toMatchObject({ code: "22023" });
    });

    it("refuses to cancel after a receipt; reversing the receipt makes it cancellable", async () => {
      const before = await stockOf(keyboard);
      const po = await approvedPo([{ product_id: keyboard, quantity: 4 }]);
      const [line] = await lines(po.id);
      const receipt = await receive(manager, po.id, [{ line, quantity: 2 }]);

      await expect(cancel(buyer, po.id)).rejects.toMatchObject({ code: "SF009" });

      await as(manager, () => db.query("select public.reverse_goods_receipt($1, 'Wrong delivery')", [receipt.id]));
      expect(await statusOf(po.id)).toBe("APPROVED");
      expect(await stockOf(keyboard)).toBe(before);
      expect((await lines(po.id))[0].quantity_received).toBe(0);

      expect((await cancel(buyer, po.id)).status).toBe("CANCELLED");
    });
  });

  describe("goods receipt reversal", () => {
    it("reverses each movement through reverse_stock_movement and keeps history", async () => {
      const po = await approvedPo([
        { product_id: mouse, quantity: 5 },
        { product_id: keyboard, quantity: 5 },
      ]);
      const [l1, l2] = await lines(po.id);
      const first = await receive(manager, po.id, [{ line: l1, quantity: 5 }]);
      await receive(manager, po.id, [{ line: l2, quantity: 5 }]);
      expect(await statusOf(po.id)).toBe("RECEIVED");

      await as(manager, () => db.query("select public.reverse_goods_receipt($1, 'Damaged pallet')", [first.id]));
      expect(await statusOf(po.id)).toBe("PARTIALLY_RECEIVED");

      const reversals = await db.query<{ movement_type: string; quantity_change: number; reference_type: string }>(
        `select r.movement_type, r.quantity_change, r.reference_type
         from public.goods_receipt_items g
         join public.stock_movements r on r.reversal_of_id = g.stock_movement_id
         where g.goods_receipt_id = $1`,
        [first.id],
      );
      expect(reversals.rows).toEqual([{ movement_type: "ADJUSTMENT_OUT", quantity_change: -5, reference_type: "REVERSAL" }]);
      // The receipt and its original movement are still there.
      expect(await count(db, "select count(*) n from public.goods_receipt_items where goods_receipt_id = $1", [first.id])).toBe(1);

      await expect(
        as(manager, () => db.query("select public.reverse_goods_receipt($1, 'Again')", [first.id])),
      ).rejects.toMatchObject({ code: "SF010" });
    });

    it("rejects the reversal when the received stock has already been used", async () => {
      const po = await approvedPo([{ product_id: keyboard, quantity: 1 }]);
      const [line] = await lines(po.id);
      const receipt = await receive(manager, po.id, [{ line, quantity: 1 }]);
      const stock = await stockOf(keyboard);
      await as(manager, () =>
        db.query("select public.create_stock_movement($1, $2, 'SALE', $3)", [keyboard, warehouseId, stock]),
      );

      await expect(
        as(manager, () => db.query("select public.reverse_goods_receipt($1, 'Too late')", [receipt.id])),
      ).rejects.toMatchObject({ code: "SF001" });
      expect(await statusOf(po.id)).toBe("RECEIVED");
      const reversed = await db.query<{ reversed_at: string | null }>(
        "select reversed_at from public.goods_receipts where id = $1",
        [receipt.id],
      );
      expect(reversed.rows[0].reversed_at).toBeNull();
    });
  });

  describe("status transitions are enforced in the database", () => {
    it("rejects out-of-order workflow calls", async () => {
      const draft = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      await expect(step(admin, "approve", draft.id)).rejects.toMatchObject({ code: "SF007" });
      const [line] = await lines(draft.id);
      await expect(receive(manager, draft.id, [{ line, quantity: 1 }])).rejects.toMatchObject({ code: "SF007" });

      await step(buyer, "submit", draft.id);
      await expect(step(buyer, "submit", draft.id)).rejects.toMatchObject({ code: "SF007" });
      await expect(receive(manager, draft.id, [{ line, quantity: 1 }])).rejects.toMatchObject({ code: "SF007" });

      await cancel(buyer, draft.id);
      await expect(step(admin, "approve", draft.id)).rejects.toMatchObject({ code: "SF007" });
      await expect(cancel(buyer, draft.id)).rejects.toMatchObject({ code: "SF007" });
    });

    it("rejects invalid transitions even for direct SQL by the table owner", async () => {
      const po = await createPo(buyer, [{ product_id: mouse, quantity: 2 }]);
      await expect(
        db.query("update public.purchase_orders set status = 'RECEIVED' where id = $1", [po.id]),
      ).rejects.toThrow(/cannot go from DRAFT to RECEIVED/);
      await expect(
        db.query("update public.purchase_orders set status = 'APPROVED' where id = $1", [po.id]),
      ).rejects.toThrow(/cannot go from DRAFT to APPROVED/);
      await expect(
        db.query("insert into public.purchase_orders (supplier_id, warehouse_id, status) values ($1, $2, 'APPROVED')", [
          supplierId,
          warehouseId,
        ]),
      ).rejects.toThrow(/start as DRAFT/);
    });

    it("freezes lines and header once submitted", async () => {
      const po = await createPo(buyer, [{ product_id: mouse, quantity: 2 }]);
      await step(buyer, "submit", po.id);
      await expect(
        db.query("update public.purchase_order_items set quantity_ordered = 99 where purchase_order_id = $1", [po.id]),
      ).rejects.toMatchObject({ code: "SF007" });
      await expect(
        db.query("update public.purchase_orders set warehouse_id = (select id from public.warehouses where code = 'WH-HFA') where id = $1", [po.id]),
      ).rejects.toMatchObject({ code: "SF007" });
      await expect(
        as(buyer, () =>
          db.query("select public.update_purchase_order($1, $2, $3, $4::jsonb)", [
            po.id,
            supplierId,
            warehouseId,
            JSON.stringify([{ product_id: mouse, quantity: 3 }]),
          ]),
        ),
      ).rejects.toMatchObject({ code: "SF007" });
    });

    it("does not let receipt stock be posted or reversed outside the workflow", async () => {
      const po = await approvedPo([{ product_id: mouse, quantity: 2 }]);
      const [line] = await lines(po.id);
      const receipt = await receive(manager, po.id, [{ line, quantity: 1 }]);

      // Posting more stock against the receipt from outside receive_goods.
      await expect(
        as(manager, () =>
          db.query(
            `select public.create_stock_movement($1, $2, 'PURCHASE_RECEIPT', 5, p_reference_type => 'GOODS_RECEIPT', p_reference_id => $3)`,
            [mouse, warehouseId, receipt.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "SF008" });

      // Reversing a receipt movement directly would leave the PO out of sync.
      const movementId = (
        await db.query<{ stock_movement_id: string }>(
          "select stock_movement_id from public.goods_receipt_items where goods_receipt_id = $1",
          [receipt.id],
        )
      ).rows[0].stock_movement_id;
      await expect(
        as(manager, () => db.query("select public.reverse_stock_movement($1, 'x')", [movementId])),
      ).rejects.toMatchObject({ code: "SF008", message: expect.stringContaining("reverse the goods receipt instead") });
    });
  });

  describe("permissions", () => {
    it("purchasing drafts, submits and cancels but cannot approve or receive", async () => {
      const po = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      await step(buyer, "submit", po.id);
      await expect(step(buyer, "approve", po.id)).rejects.toMatchObject({ code: "42501" });
      await step(admin, "approve", po.id);
      const [line] = await lines(po.id);
      await expect(receive(buyer, po.id, [{ line, quantity: 1 }])).rejects.toMatchObject({ code: "42501" });
    });

    it("warehouse managers receive but cannot create, approve or cancel orders", async () => {
      await expect(createPo(manager, [{ product_id: mouse, quantity: 1 }])).rejects.toMatchObject({ code: "42501" });
      const po = await createPo(buyer, [{ product_id: mouse, quantity: 1 }]);
      await step(buyer, "submit", po.id);
      await expect(step(manager, "approve", po.id)).rejects.toMatchObject({ code: "42501" });
      await expect(cancel(manager, po.id)).rejects.toMatchObject({ code: "42501" });
    });

    it("admins can do every step", async () => {
      const po = await createPo(admin, [{ product_id: mouse, quantity: 1 }]);
      await step(admin, "submit", po.id);
      await step(admin, "approve", po.id);
      const [line] = await lines(po.id);
      await receive(admin, po.id, [{ line, quantity: 1 }]);
      expect(await statusOf(po.id)).toBe("RECEIVED");
    });

    it("rejects deactivated users and anonymous callers", async () => {
      await expect(createPo(inactiveBuyer, [{ product_id: mouse, quantity: 1 }])).rejects.toMatchObject({ code: "42501" });
      await expect(
        runAs(db, { role: "anon" }, () =>
          db.query("select public.create_purchase_order($1, $2, '[]'::jsonb)", [supplierId, warehouseId]),
        ),
      ).rejects.toThrow(/permission denied for function create_purchase_order/);
    });

    it("keeps purchase orders and receipts read-only for direct client writes", async () => {
      await expect(
        as(admin, () =>
          db.query("insert into public.purchase_orders (supplier_id, warehouse_id) values ($1, $2)", [supplierId, warehouseId]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(buyer, () => db.query("update public.purchase_orders set status = 'APPROVED'")),
      ).rejects.toThrow(/permission denied/);
      await expect(as(manager, () => db.query("delete from public.goods_receipts"))).rejects.toThrow(/permission denied/);
    });

    it("purchasing and admins maintain suppliers; warehouse managers only read them", async () => {
      await as(buyer, () => db.query("insert into public.suppliers (code, name) values ('SUP-500', 'Buyer Supplier Ltd.')"));
      const updated = await as(buyer, () =>
        db.query("update public.suppliers set lead_time_days = 12 where code = 'SUP-500'"),
      );
      expect(updated.affectedRows).toBe(1);

      await expect(
        as(manager, () => db.query("insert into public.suppliers (code, name) values ('SUP-501', 'Nope Ltd.')")),
      ).rejects.toThrow(/row-level security/);
      const managerUpdate = await as(manager, () =>
        db.query("update public.suppliers set lead_time_days = 1 where code = 'SUP-500'"),
      );
      expect(managerUpdate.affectedRows).toBe(0);
      await expect(as(buyer, () => db.query("delete from public.suppliers where code = 'SUP-500'"))).rejects.toThrow(
        /permission denied/,
      );

      const audit = await db.query<{ action: string; user_email: string }>(
        `select a.action, a.user_email from public.audit_log a
         join public.suppliers s on a.entity_id = s.id::text
         where a.entity_type = 'suppliers' and s.code = 'SUP-500' order by a.id`,
      );
      expect(audit.rows).toEqual([
        { action: "INSERT", user_email: buyer.email },
        { action: "UPDATE", user_email: buyer.email },
      ]);
    });
  });

  describe("business calendar", () => {
    it("uses Israel dates, not the UTC database clock", async () => {
      // 22:30 UTC on 25 Sep is already 26 Sep in Israel (UTC+3 in summer, UTC+2 in winter).
      const r = await db.query<{ summer: string; winter: string }>(
        `select private.business_date('2026-09-25 22:30:00+00')::text as summer,
                private.business_date('2026-01-15 21:59:00+00')::text as winter`,
      );
      expect(r.rows[0]).toEqual({ summer: "2026-09-26", winter: "2026-01-15" });
    });

    it("rejects an order date after today's business date", async () => {
      await expect(
        as(buyer, () =>
          db.query("select public.create_purchase_order($1, $2, $3::jsonb, private.business_date() + 1)", [
            supplierId,
            warehouseId,
            JSON.stringify([{ product_id: mouse, quantity: 1 }]),
          ]),
        ),
      ).rejects.toThrow();
    });
  });

  describe("supplier purchase summary", () => {
    it("reports committed value, last order and outstanding orders", async () => {
      await db.query("insert into public.suppliers (code, name) values ('SUP-600', 'Summary Supplier Ltd.')");
      const summarySupplier = (await db.query<{ id: string }>("select id from public.suppliers where code = 'SUP-600'")).rows[0].id;

      const make = async (items: { product_id: string; quantity: number; unit_cost: number }[]) => {
        const r = await as(buyer, () =>
          db.query<PurchaseOrder>("select * from public.create_purchase_order($1, $2, $3::jsonb)", [
            summarySupplier,
            warehouseId,
            JSON.stringify(items),
          ]),
        );
        return r.rows[0];
      };

      await make([{ product_id: mouse, quantity: 1, unit_cost: 5 }]); // draft: not committed, not outstanding
      const submitted = await make([{ product_id: mouse, quantity: 1, unit_cost: 7 }]);
      await step(buyer, "submit", submitted.id); // outstanding, not committed
      const partial = await make([{ product_id: mouse, quantity: 10, unit_cost: 10 }]);
      await step(buyer, "submit", partial.id);
      await step(admin, "approve", partial.id);
      const [line] = await lines(partial.id);
      await receive(manager, partial.id, [{ line, quantity: 4 }]); // committed 100, outstanding 60
      const cancelled = await make([{ product_id: mouse, quantity: 1, unit_cost: 999 }]);
      await cancel(buyer, cancelled.id);

      const r = await db.query(
        `select order_count, total_purchase_value, received_value, outstanding_count, outstanding_value,
                last_order_date = private.business_date() as ordered_today
         from public.supplier_purchase_summary where supplier_id = $1`,
        [summarySupplier],
      );
      expect(r.rows[0]).toEqual({
        order_count: 3,
        total_purchase_value: "100.00",
        received_value: "40.00",
        outstanding_count: 2,
        outstanding_value: "60.00",
        ordered_today: true,
      });
    });
  });
});
