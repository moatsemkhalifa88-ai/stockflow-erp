import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

describe("row level security", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let inactive: TestUser;
  let productId: string;
  let warehouseId: string;
  let categoryId: string;

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    inactive = await createUser(db, "former@stockflow.test", "warehouse_manager");
    await db.query("update public.profiles set is_active = false where id = $1", [inactive.id]);

    productId = (await db.query<{ id: string }>("select id from public.products where sku = 'CMP-2001'")).rows[0].id;
    warehouseId = (await db.query<{ id: string }>("select id from public.warehouses where code = 'WH-TLV'")).rows[0].id;
    categoryId = (await db.query<{ id: string }>("select id from public.categories where code = 'COMP'")).rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  const asAdmin = <T>(fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: admin.id }, fn);
  const asManager = <T>(fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: manager.id }, fn);

  describe("unauthenticated (anon)", () => {
    const tables = [
      "profiles", "roles", "products", "categories", "warehouses", "suppliers", "customers",
      "inventory", "stock_movements", "purchase_orders", "sales_orders", "stock_transfers", "audit_log",
    ];

    it.each(tables)("cannot read %s", async (table) => {
      await expect(runAs(db, { role: "anon" }, () => db.query(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    });

    it("cannot insert products", async () => {
      await expect(
        runAs(db, { role: "anon" }, () =>
          db.query("insert into public.products (sku, name, category_id) values ('ANON-1', 'x', $1)", [categoryId]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("deactivated user", () => {
    it("sees no business data but can read their own profile", async () => {
      await runAs(db, { role: "authenticated", userId: inactive.id }, async () => {
        expect(await count(db, "select count(*) n from public.products")).toBe(0);
        expect(await count(db, "select count(*) n from public.customers")).toBe(0);
        expect(await count(db, "select count(*) n from public.profiles")).toBe(1);
      });
    });
  });

  describe("warehouse_manager", () => {
    it("can read master data", async () => {
      await asManager(async () => {
        expect(await count(db, "select count(*) n from public.products")).toBeGreaterThanOrEqual(50);
        expect(await count(db, "select count(*) n from public.warehouses")).toBe(5);
        expect(await count(db, "select count(*) n from public.suppliers")).toBe(10);
      });
    });

    it("can create and update products", async () => {
      await asManager(async () => {
        await db.query(
          "insert into public.products (sku, name, category_id, cost_price, sale_price) values ('CMP-2100', 'USB Hub 4-Port', $1, 30, 59)",
          [categoryId],
        );
        const updated = await db.query("update public.products set sale_price = 64 where sku = 'CMP-2100'");
        expect(updated.affectedRows).toBe(1);
      });
      const createdBy = await db.query<{ created_by: string }>(
        "select created_by from public.products where sku = 'CMP-2100'",
      );
      expect(createdBy.rows[0].created_by).toBe(manager.id);
    });

    it("cannot hard-delete products", async () => {
      await expect(asManager(() => db.query("delete from public.products where id = $1", [productId]))).rejects.toThrow(
        /permission denied/,
      );
    });

    it("cannot write inventory or stock movements directly", async () => {
      await expect(
        asManager(() =>
          db.query("insert into public.inventory (product_id, warehouse_id, quantity) values ($1, $2, 100)", [
            productId,
            warehouseId,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);

      await expect(
        asManager(() =>
          db.query(
            `insert into public.stock_movements
               (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after)
             values ('ADJUSTMENT_IN', 1, $1, $2, 100, 0, 100)`,
            [productId, warehouseId],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("cannot create suppliers, customers or warehouses", async () => {
      await expect(
        asManager(() => db.query("insert into public.suppliers (code, name) values ('SUP-999', 'Rogue Supplier')")),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asManager(() => db.query("insert into public.customers (code, name) values ('CUS-999', 'Rogue Customer')")),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asManager(() => db.query("insert into public.warehouses (code, name, city) values ('WH-X', 'Rogue', 'Nowhere')")),
      ).rejects.toThrow(/row-level security/);
    });

    it("cannot change roles or read the audit log", async () => {
      await asManager(async () => {
        const result = await db.query(
          "update public.profiles set role_id = (select id from public.roles where code = 'admin') where id = $1",
          [manager.id],
        );
        expect(result.affectedRows).toBe(0);
        expect(await count(db, "select count(*) n from public.audit_log")).toBe(0);
      });
    });
  });

  describe("admin", () => {
    it("can create suppliers and customers", async () => {
      await asAdmin(async () => {
        await db.query("insert into public.suppliers (code, name) values ('SUP-100', 'New Supplier Ltd.')");
        await db.query("insert into public.customers (code, name) values ('CUS-100', 'New Customer Ltd.')");
      });
      expect(await count(db, "select count(*) n from public.suppliers where code = 'SUP-100'")).toBe(1);
    });

    it("can deactivate a user", async () => {
      await asAdmin(async () => {
        const result = await db.query("update public.profiles set is_active = true where id = $1", [inactive.id]);
        expect(result.affectedRows).toBe(1);
        await db.query("update public.profiles set is_active = false where id = $1", [inactive.id]);
      });
    });

    it("still cannot write stock movements directly", async () => {
      await expect(
        asAdmin(() =>
          db.query(
            `insert into public.stock_movements
               (movement_type, direction, product_id, warehouse_id, quantity, quantity_before, quantity_after)
             values ('PURCHASE_RECEIPT', 1, $1, $2, 10, 0, 10)`,
            [productId, warehouseId],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("sees product changes in the audit log with the acting user", async () => {
      await asManager(() => db.query("update public.products set cost_price = 33 where id = $1", [productId]));

      const entries = await asAdmin(() =>
        db.query<{ user_email: string; action: string; details: { changed_fields: Record<string, unknown> } }>(
          `select user_email, action, details from public.audit_log
           where entity_type = 'products' and entity_id = $1 and action = 'UPDATE'
           order by id desc limit 1`,
          [productId],
        ),
      );
      expect(entries.rows[0].user_email).toBe(manager.email);
      expect(entries.rows[0].details.changed_fields).toEqual({ cost_price: 33 });
    });

    it("cannot tamper with the audit log", async () => {
      await expect(asAdmin(() => db.query("delete from public.audit_log"))).rejects.toThrow(/permission denied/);
    });
  });
});
