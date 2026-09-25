import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

interface MovementRow {
  id: string;
  movement_number: string;
  movement_type: string;
  direction: number;
  quantity: number;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  unit_cost: string;
  reference_type: string | null;
  reference_number: string | null;
  reversal_of_id: string | null;
  reason: string | null;
  performed_by: string | null;
}

describe("inventory engine", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let auditor: TestUser;
  let inactive: TestUser;
  let warehouseId: string;
  let otherWarehouseId: string;
  let categoryId: string;

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    // A valid, active role that is not allowed to move stock.
    await db.query("insert into public.roles (code, name) values ('auditor', 'Auditor')");
    auditor = await createUser(db, "auditor@stockflow.test", "auditor");
    inactive = await createUser(db, "former@stockflow.test", "warehouse_manager");
    await db.query("update public.profiles set is_active = false where id = $1", [inactive.id]);

    warehouseId = (await db.query<{ id: string }>("select id from public.warehouses where code = 'WH-TLV'")).rows[0].id;
    otherWarehouseId = (await db.query<{ id: string }>("select id from public.warehouses where code = 'WH-HFA'")).rows[0].id;
    categoryId = (await db.query<{ id: string }>("select id from public.categories where code = 'COMP'")).rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  const asManager = <T>(fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: manager.id }, fn);

  /** A fresh product so each test starts from an empty ledger. */
  async function newProduct(sku: string, costPrice = 10, minStock = 5): Promise<string> {
    const result = await db.query<{ id: string }>(
      `insert into public.products (sku, name, category_id, cost_price, sale_price, min_stock_level)
       values ($1, $1, $2, $3::numeric, $3::numeric * 2, $4) returning id`,
      [sku, categoryId, costPrice, minStock],
    );
    return result.rows[0].id;
  }

  async function move(
    productId: string,
    type: string,
    quantity: number,
    options: { reason?: string; warehouse?: string; direction?: number; unitCost?: number } = {},
  ): Promise<MovementRow> {
    const result = await db.query<MovementRow>(
      `select * from public.create_stock_movement(
         p_product_id => $1, p_warehouse_id => $2, p_movement_type => $3::public.movement_type,
         p_quantity => $4, p_reason => $5, p_direction => $6::smallint, p_unit_cost => $7)`,
      [
        productId,
        options.warehouse ?? warehouseId,
        type,
        quantity,
        options.reason ?? null,
        options.direction ?? null,
        options.unitCost ?? null,
      ],
    );
    return result.rows[0];
  }

  async function reverse(movementId: string, reason = "Posted in error"): Promise<MovementRow> {
    const result = await db.query<MovementRow>("select * from public.reverse_stock_movement($1, $2)", [
      movementId,
      reason,
    ]);
    return result.rows[0];
  }

  async function stockOf(productId: string, warehouse = warehouseId): Promise<number | null> {
    const result = await db.query<{ quantity: number }>(
      "select quantity from public.inventory where product_id = $1 and warehouse_id = $2",
      [productId, warehouse],
    );
    return result.rows[0]?.quantity ?? null;
  }

  describe("receipts", () => {
    it("creates the inventory row, the ledger row and an audit entry in one call", async () => {
      const productId = await newProduct("ENG-0001", 12.5);
      const movement = await asManager(() => move(productId, "PURCHASE_RECEIPT", 40));

      expect(movement).toMatchObject({
        movement_type: "PURCHASE_RECEIPT",
        direction: 1,
        quantity: 40,
        quantity_change: 40,
        quantity_before: 0,
        quantity_after: 40,
        unit_cost: "12.50", // snapshot of the product cost price
        performed_by: manager.id,
      });
      expect(movement.movement_number).toMatch(/^MV-\d{7}$/);
      expect(await stockOf(productId)).toBe(40);

      const audit = await db.query<{ action: string; user_email: string; details: { quantity_after: number } }>(
        "select action, user_email, details from public.audit_log where entity_type = 'stock_movements' and entity_id = $1",
        [movement.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ action: "STOCK_MOVEMENT", user_email: manager.email });
      expect(audit.rows[0].details.quantity_after).toBe(40);
    });

    it("accumulates on the existing row and chains quantity_before / quantity_after", async () => {
      const productId = await newProduct("ENG-0002");
      await asManager(async () => {
        await move(productId, "PURCHASE_RECEIPT", 10);
        const second = await move(productId, "ADJUSTMENT_IN", 5, { reason: "Found during cycle count" });
        expect(second).toMatchObject({ quantity_before: 10, quantity_after: 15, reference_type: "ADJUSTMENT" });
      });
      expect(await stockOf(productId)).toBe(15);
      expect(
        await count(db, "select count(*) n from public.inventory where product_id = $1", [productId]),
      ).toBe(1);
    });

    it("keeps stock per warehouse", async () => {
      const productId = await newProduct("ENG-0003");
      await asManager(async () => {
        await move(productId, "PURCHASE_RECEIPT", 7);
        await move(productId, "PURCHASE_RECEIPT", 3, { warehouse: otherWarehouseId });
      });
      expect(await stockOf(productId)).toBe(7);
      expect(await stockOf(productId, otherWarehouseId)).toBe(3);
    });
  });

  describe("negative stock", () => {
    it("rejects a movement that would take stock below zero and changes nothing", async () => {
      const productId = await newProduct("ENG-0101");
      await asManager(() => move(productId, "PURCHASE_RECEIPT", 5));
      const movementsBefore = await count(db, "select count(*) n from public.stock_movements");
      const auditBefore = await count(db, "select count(*) n from public.audit_log");

      await expect(asManager(() => move(productId, "SALE", 6))).rejects.toMatchObject({
        code: "SF001",
        message: "Insufficient stock: 5 available, 6 requested",
      });

      expect(await stockOf(productId)).toBe(5);
      expect(await count(db, "select count(*) n from public.stock_movements")).toBe(movementsBefore);
      expect(await count(db, "select count(*) n from public.audit_log")).toBe(auditBefore);
    });

    it("rejects stock out of a location that never had stock and leaves no inventory row behind", async () => {
      const productId = await newProduct("ENG-0102");
      await expect(
        asManager(() => move(productId, "ADJUSTMENT_OUT", 1, { reason: "Damaged" })),
      ).rejects.toMatchObject({ code: "SF001" });
      expect(await stockOf(productId)).toBeNull();
    });

    it("allows taking stock down to exactly zero", async () => {
      const productId = await newProduct("ENG-0103");
      await asManager(async () => {
        await move(productId, "PURCHASE_RECEIPT", 4);
        const out = await move(productId, "SALE", 4);
        expect(out.quantity_after).toBe(0);
      });
      expect(await stockOf(productId)).toBe(0);
    });
  });

  describe("validation", () => {
    it("requires a reason for adjustments", async () => {
      const productId = await newProduct("ENG-0201");
      await expect(asManager(() => move(productId, "ADJUSTMENT_IN", 3, { reason: "   " }))).rejects.toMatchObject({
        code: "22023",
        message: "A reason is required for stock adjustments",
      });
    });

    it("rejects zero or negative quantities", async () => {
      const productId = await newProduct("ENG-0202");
      await expect(asManager(() => move(productId, "PURCHASE_RECEIPT", 0))).rejects.toMatchObject({ code: "22023" });
      await expect(asManager(() => move(productId, "PURCHASE_RECEIPT", -5))).rejects.toMatchObject({ code: "22023" });
    });

    it("derives direction from the type and rejects a contradicting direction", async () => {
      const productId = await newProduct("ENG-0203");
      await expect(asManager(() => move(productId, "SALE", 1, { direction: 1 }))).rejects.toMatchObject({
        code: "22023",
      });
    });

    it("requires an explicit direction for RETURN", async () => {
      const productId = await newProduct("ENG-0204");
      await expect(asManager(() => move(productId, "RETURN", 1))).rejects.toMatchObject({ code: "22023" });
      const customerReturn = await asManager(() => move(productId, "RETURN", 2, { direction: 1 }));
      expect(customerReturn).toMatchObject({ direction: 1, quantity_after: 2 });
    });

    it("does not let inactive products receive stock but still lets them be written off", async () => {
      const productId = await newProduct("ENG-0205");
      await asManager(() => move(productId, "PURCHASE_RECEIPT", 3));
      await db.query("update public.products set is_active = false where id = $1", [productId]);

      await expect(asManager(() => move(productId, "PURCHASE_RECEIPT", 1))).rejects.toThrow(/inactive/);
      const writeOff = await asManager(() => move(productId, "ADJUSTMENT_OUT", 3, { reason: "Discontinued" }));
      expect(writeOff.quantity_after).toBe(0);
    });

    it("rejects references to documents that do not exist", async () => {
      const productId = await newProduct("ENG-0206");
      await expect(
        asManager(() =>
          db.query(
            `select public.create_stock_movement($1, $2, 'PURCHASE_RECEIPT', 1,
               p_reference_type => 'PURCHASE_ORDER', p_reference_id => gen_random_uuid())`,
            [productId, warehouseId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("does not accept hand-made reversals", async () => {
      const productId = await newProduct("ENG-0207");
      await expect(
        asManager(() =>
          db.query(
            `select public.create_stock_movement($1, $2, 'ADJUSTMENT_IN', 1, p_reference_type => 'REVERSAL', p_reason => 'x')`,
            [productId, warehouseId],
          ),
        ),
      ).rejects.toThrow(/reverse_stock_movement/);
    });

    it("locks the SKU once stock has moved", async () => {
      const productId = await newProduct("ENG-0208");
      await db.query("update public.products set sku = 'ENG-0208-B' where id = $1", [productId]);
      await asManager(() => move(productId, "PURCHASE_RECEIPT", 1));
      await expect(
        db.query("update public.products set sku = 'ENG-0208-C' where id = $1", [productId]),
      ).rejects.toMatchObject({ code: "SF003" });
      // Other fields remain editable.
      await db.query("update public.products set name = 'Renamed' where id = $1", [productId]);
    });
  });

  describe("reversals", () => {
    it("posts an opposite movement and leaves the original untouched", async () => {
      const productId = await newProduct("ENG-0301", 8);
      const receipt = await asManager(() => move(productId, "PURCHASE_RECEIPT", 20));
      const reversal = await asManager(() => reverse(receipt.id, "Wrong product scanned"));

      expect(reversal).toMatchObject({
        movement_type: "ADJUSTMENT_OUT",
        direction: -1,
        quantity: 20,
        quantity_before: 20,
        quantity_after: 0,
        unit_cost: "8.00",
        reference_type: "REVERSAL",
        reference_number: receipt.movement_number,
        reversal_of_id: receipt.id,
        reason: "Wrong product scanned",
      });
      expect(await stockOf(productId)).toBe(0);

      const original = await db.query<MovementRow>("select * from public.stock_movements where id = $1", [receipt.id]);
      expect(original.rows[0]).toEqual(receipt);

      const audit = await db.query<{ action: string }>(
        "select action from public.audit_log where entity_type = 'stock_movements' and entity_id = $1",
        [reversal.id],
      );
      expect(audit.rows).toEqual([{ action: "STOCK_REVERSAL" }]);
    });

    it("reverses an outbound movement by putting the stock back", async () => {
      const productId = await newProduct("ENG-0302");
      await asManager(() => move(productId, "PURCHASE_RECEIPT", 10));
      const sale = await asManager(() => move(productId, "SALE", 4));
      const reversal = await asManager(() => reverse(sale.id));
      expect(reversal).toMatchObject({ movement_type: "ADJUSTMENT_IN", direction: 1, quantity_after: 10 });
    });

    it("allows a movement to be reversed only once", async () => {
      const productId = await newProduct("ENG-0303");
      const receipt = await asManager(() => move(productId, "PURCHASE_RECEIPT", 5));
      const reversal = await asManager(() => reverse(receipt.id));
      await expect(asManager(() => reverse(receipt.id))).rejects.toMatchObject({
        code: "SF002",
        message: `Movement ${receipt.movement_number} was already reversed by ${reversal.movement_number}`,
      });
    });

    it("does not reverse a reversal", async () => {
      const productId = await newProduct("ENG-0304");
      const receipt = await asManager(() => move(productId, "PURCHASE_RECEIPT", 5));
      const reversal = await asManager(() => reverse(receipt.id));
      await expect(asManager(() => reverse(reversal.id))).rejects.toThrow(/cannot be reversed/);
    });

    it("rejects reversing a receipt whose stock has already been used", async () => {
      const productId = await newProduct("ENG-0305");
      const receipt = await asManager(() => move(productId, "PURCHASE_RECEIPT", 10));
      await asManager(() => move(productId, "SALE", 7));
      await expect(asManager(() => reverse(receipt.id))).rejects.toMatchObject({ code: "SF001" });
      expect(await stockOf(productId)).toBe(3);
    });

    it("requires a reason", async () => {
      const productId = await newProduct("ENG-0306");
      const receipt = await asManager(() => move(productId, "PURCHASE_RECEIPT", 1));
      await expect(asManager(() => reverse(receipt.id, ""))).rejects.toMatchObject({ code: "22023" });
    });

    it("keeps the ledger and the inventory in agreement", async () => {
      const mismatches = await db.query(
        `select i.product_id, i.warehouse_id, i.quantity, coalesce(sum(m.quantity_change), 0) as ledger
         from public.inventory i
         left join public.stock_movements m on m.product_id = i.product_id and m.warehouse_id = i.warehouse_id
         group by i.id
         having i.quantity <> coalesce(sum(m.quantity_change), 0)`,
      );
      expect(mismatches.rows).toEqual([]);
    });
  });

  describe("inventory valuation view", () => {
    it("values stock at quantity x cost price and classifies stock status", async () => {
      const inStock = await newProduct("ENG-0401", 19.99, 5);
      const low = await newProduct("ENG-0402", 100, 10);
      const out = await newProduct("ENG-0403", 7.25, 2);
      await asManager(async () => {
        await move(inStock, "PURCHASE_RECEIPT", 12);
        await move(low, "PURCHASE_RECEIPT", 10); // exactly at the minimum counts as low
        await move(out, "PURCHASE_RECEIPT", 3);
        await move(out, "SALE", 3);
      });

      const rows = await asManager(() =>
        db.query<{ sku: string; quantity: number; inventory_value: string; stock_status: string }>(
          `select sku, quantity, inventory_value, stock_status from public.inventory_valuation
           where sku in ('ENG-0401', 'ENG-0402', 'ENG-0403') order by sku`,
        ),
      );
      expect(rows.rows).toEqual([
        { sku: "ENG-0401", quantity: 12, inventory_value: "239.88", stock_status: "IN_STOCK" },
        { sku: "ENG-0402", quantity: 10, inventory_value: "1000.00", stock_status: "LOW_STOCK" },
        { sku: "ENG-0403", quantity: 0, inventory_value: "0.00", stock_status: "OUT_OF_STOCK" },
      ]);
    });

    it("re-values stock when the cost price changes", async () => {
      const productId = await newProduct("ENG-0404", 10, 0);
      await asManager(() => move(productId, "PURCHASE_RECEIPT", 3));
      await db.query("update public.products set cost_price = 11.10 where id = $1", [productId]);
      const value = await db.query<{ inventory_value: string }>(
        "select inventory_value from public.inventory_valuation where product_id = $1",
        [productId],
      );
      expect(value.rows[0].inventory_value).toBe("33.30");
    });

    it("rolls product and warehouse totals up from the same view", async () => {
      const productId = await newProduct("ENG-0405", 2.5, 0);
      await asManager(async () => {
        await move(productId, "PURCHASE_RECEIPT", 4);
        await move(productId, "PURCHASE_RECEIPT", 6, { warehouse: otherWarehouseId });
      });

      const product = await db.query<{ total_quantity: number; inventory_value: string; warehouse_count: number }>(
        "select total_quantity, inventory_value, warehouse_count from public.product_stock_summary where product_id = $1",
        [productId],
      );
      expect(product.rows[0]).toEqual({ total_quantity: 10, inventory_value: "25.00", warehouse_count: 2 });

      const totals = await db.query<{ from_view: string; from_summary: string }>(
        `select (select sum(inventory_value) from public.inventory_valuation where warehouse_id = $1) as from_view,
                (select inventory_value from public.warehouse_stock_summary where warehouse_id = $1) as from_summary`,
        [warehouseId],
      );
      expect(totals.rows[0].from_summary).toBe(totals.rows[0].from_view);
    });

    it("lists products that never had stock as out of stock", async () => {
      const productId = await newProduct("ENG-0406");
      const result = await db.query<{ total_quantity: number; stock_status: string }>(
        "select total_quantity, stock_status from public.product_stock_summary where product_id = $1",
        [productId],
      );
      expect(result.rows[0]).toEqual({ total_quantity: 0, stock_status: "OUT_OF_STOCK" });
    });
  });

  describe("permissions", () => {
    let productId: string;

    beforeAll(async () => {
      productId = await newProduct("ENG-0501");
    });

    it("lets admins and warehouse managers move stock", async () => {
      await runAs(db, { role: "authenticated", userId: admin.id }, () => move(productId, "PURCHASE_RECEIPT", 2));
      await asManager(() => move(productId, "PURCHASE_RECEIPT", 2));
      expect(await stockOf(productId)).toBe(4);
    });

    it("rejects an active user whose role may not move stock", async () => {
      await expect(
        runAs(db, { role: "authenticated", userId: auditor.id }, () => move(productId, "PURCHASE_RECEIPT", 1)),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("rejects a deactivated warehouse manager", async () => {
      await expect(
        runAs(db, { role: "authenticated", userId: inactive.id }, () => move(productId, "PURCHASE_RECEIPT", 1)),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("rejects reversals by users who may not move stock", async () => {
      const receipt = await asManager(() => move(productId, "PURCHASE_RECEIPT", 1));
      await expect(
        runAs(db, { role: "authenticated", userId: auditor.id }, () => reverse(receipt.id)),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("does not let anonymous users execute the engine", async () => {
      await expect(runAs(db, { role: "anon" }, () => move(productId, "PURCHASE_RECEIPT", 1))).rejects.toThrow(
        /permission denied for function create_stock_movement/,
      );
      await expect(
        runAs(db, { role: "anon" }, () => db.query("select public.reverse_stock_movement(gen_random_uuid(), 'x')")),
      ).rejects.toThrow(/permission denied for function reverse_stock_movement/);
    });

    it("does not let clients call the private core directly", async () => {
      await expect(
        asManager(() =>
          db.query(
            `select private.post_stock_movement($1, $2, 'ADJUSTMENT_IN', 1::smallint, 1000, 0, null, null, null, null, 'x', null, null)`,
            [productId, warehouseId],
          ),
        ),
      ).rejects.toThrow(/permission denied for function post_stock_movement/);
    });

    it("still blocks direct writes to inventory and stock movements", async () => {
      await expect(
        asManager(() => db.query("update public.inventory set quantity = 999 where product_id = $1", [productId])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asManager(() => db.query("delete from public.inventory where product_id = $1", [productId])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        runAs(db, { role: "authenticated", userId: admin.id }, () =>
          db.query(
            `insert into public.stock_movements
               (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after)
             values ('ADJUSTMENT_IN', 1, $1, $2, 1, 0, 1)`,
            [productId, warehouseId],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("grants clients read-only access to the reporting views", async () => {
      const privileges = await db.query<{ view: string; can_select: boolean; can_write: boolean }>(
        `select v as view,
                has_table_privilege('authenticated', 'public.' || v, 'SELECT') as can_select,
                has_table_privilege('authenticated', 'public.' || v, 'INSERT, UPDATE, DELETE') as can_write
         from unnest(array['inventory_valuation', 'product_stock_summary', 'warehouse_stock_summary', 'stock_movement_ledger']) v`,
      );
      for (const row of privileges.rows) expect(row).toMatchObject({ can_select: true, can_write: false });
      await expect(asManager(() => db.query("update public.inventory_valuation set quantity = 1"))).rejects.toThrow();
    });

    it("hides the reporting views from anonymous users", async () => {
      for (const view of ["inventory_valuation", "product_stock_summary", "warehouse_stock_summary", "stock_movement_ledger"]) {
        await expect(runAs(db, { role: "anon" }, () => db.query(`select * from public.${view}`))).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it("applies RLS through the views: deactivated users see no stock", async () => {
      await runAs(db, { role: "authenticated", userId: inactive.id }, async () => {
        expect(await count(db, "select count(*) n from public.inventory_valuation")).toBe(0);
        expect(await count(db, "select count(*) n from public.stock_movement_ledger")).toBe(0);
      });
      await asManager(async () => {
        expect(await count(db, "select count(*) n from public.inventory_valuation")).toBeGreaterThan(0);
      });
    });
  });
});
