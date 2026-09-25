import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser } from "./harness";

describe("migrations and seed", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
  });

  afterAll(async () => {
    await db.close();
  });

  it("creates every Phase 1 table", async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = result.rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "roles", "profiles", "categories", "products", "suppliers", "customers", "warehouses",
        "inventory", "stock_movements", "purchase_orders", "purchase_order_items",
        "goods_receipts", "goods_receipt_items", "sales_orders", "sales_order_items",
        "stock_transfers", "stock_transfer_items", "audit_log",
      ]),
    );
  });

  it("enables RLS on every public table", async () => {
    const unprotected = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(unprotected.rows).toEqual([]);
  });

  it("gives every table created_at and updated_at", async () => {
    const missing = await db.query<{ table_name: string }>(
      `select t.table_name from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and (select count(*) from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = t.table_name
                and c.column_name in ('created_at', 'updated_at')) < 2`,
    );
    expect(missing.rows).toEqual([]);
  });

  it("seeds realistic master data", async () => {
    expect(await count(db, "select count(*) n from public.warehouses")).toBe(5);
    expect(await count(db, "select count(*) n from public.products where is_active")).toBeGreaterThanOrEqual(50);
    expect(await count(db, "select count(*) n from public.suppliers")).toBe(10);
    expect(await count(db, "select count(*) n from public.customers")).toBe(30);
    expect(await count(db, "select count(*) n from public.categories")).toBeGreaterThanOrEqual(8);
    // Stock only ever comes from movements, so the seed creates none.
    expect(await count(db, "select count(*) n from public.inventory")).toBe(0);
  });

  it("generates valid EAN-13 check digits for seeded barcodes", async () => {
    const result = await db.query<{ barcode: string }>(
      "select barcode from public.products where barcode is not null",
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(50);
    for (const { barcode } of result.rows) {
      const digits = barcode.split("").map(Number);
      const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
      expect((10 - (sum % 10)) % 10).toBe(digits[12]);
    }
  });

  it("is idempotent when the seed runs twice", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    await db.exec(readFileSync(path.resolve(__dirname, "../../supabase/seed.sql"), "utf8"));
    expect(await count(db, "select count(*) n from public.customers")).toBe(30);
  });

  it("creates a profile with the role from app_metadata when an auth user is created", async () => {
    const user = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    const result = await db.query<{ code: string; full_name: string }>(
      `select r.code, p.full_name from public.profiles p join public.roles r on r.id = p.role_id where p.id = $1`,
      [user.id],
    );
    expect(result.rows[0]).toEqual({ code: "warehouse_manager", full_name: "manager@stockflow.test" });
  });

  it("rejects users with an unknown role", async () => {
    await expect(
      db.query(`insert into auth.users (email, raw_app_meta_data) values ('x@stockflow.test', '{"role":"hacker"}')`),
    ).rejects.toThrow(/unknown or inactive role/);
  });
});

describe("data integrity constraints", () => {
  let db: PGlite;
  let productId: string;
  let warehouseId: string;

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    productId = (await db.query<{ id: string }>("select id from public.products where sku = 'CMP-2001'")).rows[0].id;
    warehouseId = (await db.query<{ id: string }>("select id from public.warehouses where code = 'WH-TLV'")).rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("never allows negative inventory", async () => {
    await expect(
      db.query("insert into public.inventory (product_id, warehouse_id, quantity) values ($1, $2, -1)", [
        productId,
        warehouseId,
      ]),
    ).rejects.toThrow(/inventory_quantity_non_negative/);
  });

  it("allows only one inventory row per product and warehouse", async () => {
    await db.query("insert into public.inventory (product_id, warehouse_id, quantity) values ($1, $2, 0)", [
      productId,
      warehouseId,
    ]);
    await expect(
      db.query("insert into public.inventory (product_id, warehouse_id, quantity) values ($1, $2, 5)", [
        productId,
        warehouseId,
      ]),
    ).rejects.toThrow(/inventory_product_warehouse_key/);
  });

  it("requires movement direction to match the movement type", async () => {
    await expect(
      db.query(
        `insert into public.stock_movements
           (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after)
         values ('SALE', 1, $1, $2, 5, 0, 5)`,
        [productId, warehouseId],
      ),
    ).rejects.toThrow(/stock_movements_direction_matches_type/);
  });

  it("requires quantity_after to equal quantity_before plus the change", async () => {
    await expect(
      db.query(
        `insert into public.stock_movements
           (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after)
         values ('PURCHASE_RECEIPT', 1, $1, $2, 5, 0, 7)`,
        [productId, warehouseId],
      ),
    ).rejects.toThrow(/stock_movements_balance/);
  });

  it("requires a reason for adjustments", async () => {
    await expect(
      db.query(
        `insert into public.stock_movements
           (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after, reason)
         values ('ADJUSTMENT_IN', 1, $1, $2, 5, 0, 5, '  ')`,
        [productId, warehouseId],
      ),
    ).rejects.toThrow(/stock_movements_adjustment_reason/);
  });

  it("keeps stock movements append-only", async () => {
    const inserted = await db.query<{ id: string; movement_number: string; quantity_change: number }>(
      `insert into public.stock_movements
         (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after, reference_type)
       values ('PURCHASE_RECEIPT', 1, $1, $2, 5, 0, 5, 'OPENING_BALANCE')
       returning id, movement_number, quantity_change`,
      [productId, warehouseId],
    );
    const movement = inserted.rows[0];
    expect(movement.movement_number).toMatch(/^MV-\d{7}$/);
    expect(movement.quantity_change).toBe(5);

    await expect(db.query("update public.stock_movements set quantity = 6 where id = $1", [movement.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query("delete from public.stock_movements where id = $1", [movement.id])).rejects.toThrow(
      /append-only/,
    );
  });

  it("rejects a transfer between the same warehouse", async () => {
    await expect(
      db.query(
        "insert into public.stock_transfers (source_warehouse_id, destination_warehouse_id) values ($1, $1)",
        [warehouseId],
      ),
    ).rejects.toThrow(/stock_transfers_different_warehouses/);
  });

  it("rejects receiving more than ordered on a PO line", async () => {
    const supplierId = (await db.query<{ id: string }>("select id from public.suppliers limit 1")).rows[0].id;
    const po = await db.query<{ id: string; po_number: string }>(
      "insert into public.purchase_orders (supplier_id, warehouse_id) values ($1, $2) returning id, po_number",
      [supplierId, warehouseId],
    );
    expect(po.rows[0].po_number).toMatch(/^PO-\d{6}$/);
    await expect(
      db.query(
        `insert into public.purchase_order_items
           (purchase_order_id, line_number, product_id, quantity_ordered, quantity_received, unit_cost)
         values ($1, 1, $2, 10, 11, 32)`,
        [po.rows[0].id, productId],
      ),
    ).rejects.toThrow(/purchase_order_items_received_range/);
  });

  it("derives PO and sales order totals from their lines", async () => {
    const supplierId = (await db.query<{ id: string }>("select id from public.suppliers limit 1")).rows[0].id;
    const customerId = (await db.query<{ id: string }>("select id from public.customers limit 1")).rows[0].id;

    const po = await db.query<{ id: string }>(
      "insert into public.purchase_orders (supplier_id, warehouse_id) values ($1, $2) returning id",
      [supplierId, warehouseId],
    );
    await db.query(
      `insert into public.purchase_order_items (purchase_order_id, line_number, product_id, quantity_ordered, unit_cost)
       values ($1, 1, $2, 10, 32.50)`,
      [po.rows[0].id, productId],
    );
    const poTotal = await db.query<{ total_amount: string }>(
      "select total_amount from public.purchase_orders where id = $1",
      [po.rows[0].id],
    );
    expect(Number(poTotal.rows[0].total_amount)).toBe(325);

    const so = await db.query<{ id: string }>(
      "insert into public.sales_orders (customer_id, warehouse_id) values ($1, $2) returning id",
      [customerId, warehouseId],
    );
    await db.query(
      `insert into public.sales_order_items (sales_order_id, line_number, product_id, quantity, unit_price, discount_percent)
       values ($1, 1, $2, 3, 69.00, 10)`,
      [so.rows[0].id, productId],
    );
    const soTotals = await db.query<{ subtotal: string; discount_amount: string; total_amount: string }>(
      "select subtotal, discount_amount, total_amount from public.sales_orders where id = $1",
      [so.rows[0].id],
    );
    expect(soTotals.rows[0]).toEqual({ subtotal: "207.00", discount_amount: "20.70", total_amount: "186.30" });
  });
});
