import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canManageCustomers,
  canManageProducts,
  canManagePurchaseOrders,
  canManageSalesOrders,
  canManageSuppliers,
  canManageWarehouses,
  canMoveStock,
  canReceiveGoods,
  canRequestTransfers,
} from "@/lib/auth/permissions";
import type { AppRole } from "@/lib/auth/roles";
import { createTestDb, createUser, runAs, type TestUser } from "./harness";

/**
 * One matrix for the four roles. The database (RLS + RPC role checks) is the
 * authority; the UI helpers in lib/auth/permissions must say the same thing.
 */
const ROLES: AppRole[] = ["admin", "warehouse_manager", "purchasing", "sales"];

type Capability = {
  name: string;
  roles: AppRole[];
  /** The UI helper that decides whether the button is shown (if any). */
  ui?: (role: AppRole) => boolean;
};

/** Direct master-data writes (RLS policies). */
const TABLE_WRITES: (Capability & { insert: string; update: string })[] = [
  {
    name: "products",
    roles: ["admin", "warehouse_manager"],
    ui: canManageProducts,
    insert: "insert into public.products (sku, name, category_id) values ('RM-{n}', 'Role matrix', (select id from public.categories limit 1))",
    update: "update public.products set description = 'x' where sku = 'CMP-2001'",
  },
  {
    name: "categories",
    roles: ["admin", "warehouse_manager"],
    ui: canManageProducts,
    insert: "insert into public.categories (code, name) values ('RM{n}', 'Role matrix {n}')",
    update: "update public.categories set description = 'x' where code = 'COMP'",
  },
  {
    name: "warehouses",
    roles: ["admin", "warehouse_manager"],
    ui: canManageWarehouses,
    insert: "insert into public.warehouses (code, name, city) values ('RM{n}', 'Role matrix {n}', 'Test')",
    update: "update public.warehouses set phone = '03-555-0101' where code = 'WH-TLV'",
  },
  {
    name: "suppliers",
    roles: ["admin", "purchasing"],
    ui: canManageSuppliers,
    insert: "insert into public.suppliers (code, name) values ('RM{n}', 'Role matrix {n}')",
    update: "update public.suppliers set notes = 'x' where code = 'SUP-001'",
  },
  {
    name: "customers",
    roles: ["admin", "sales"],
    ui: canManageCustomers,
    insert: "insert into public.customers (code, name) values ('RM{n}', 'Role matrix {n}')",
    update: "update public.customers set notes = 'x' where code = 'CUS-001'",
  },
  {
    name: "profiles (users)",
    roles: ["admin"],
    insert: "select 1",
    update: "update public.profiles set full_name = full_name where email = 'admin@stockflow.test'",
  },
];

/** Workflow RPCs. Called with a random id: allowed roles get past the role check (then "not found" / validation). */
const RPCS: (Capability & { sql: string })[] = [
  { name: "create_stock_movement", roles: ["admin", "warehouse_manager"], ui: canMoveStock, sql: "select public.create_stock_movement(gen_random_uuid(), gen_random_uuid(), 'ADJUSTMENT_IN', 1, p_reason => 'x')" },
  { name: "reverse_stock_movement", roles: ["admin", "warehouse_manager"], ui: canMoveStock, sql: "select public.reverse_stock_movement(gen_random_uuid(), 'x')" },
  { name: "create_purchase_order", roles: ["admin", "purchasing"], ui: canManagePurchaseOrders, sql: "select public.create_purchase_order(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb)" },
  { name: "submit_purchase_order", roles: ["admin", "purchasing"], ui: canManagePurchaseOrders, sql: "select public.submit_purchase_order(gen_random_uuid())" },
  { name: "approve_purchase_order", roles: ["admin"], sql: "select public.approve_purchase_order(gen_random_uuid())" },
  { name: "cancel_purchase_order", roles: ["admin", "purchasing"], ui: canManagePurchaseOrders, sql: "select public.cancel_purchase_order(gen_random_uuid(), 'x')" },
  { name: "receive_goods", roles: ["admin", "warehouse_manager"], ui: canReceiveGoods, sql: "select public.receive_goods(gen_random_uuid(), '[]'::jsonb)" },
  { name: "reverse_goods_receipt", roles: ["admin", "warehouse_manager"], ui: canReceiveGoods, sql: "select public.reverse_goods_receipt(gen_random_uuid(), 'x')" },
  { name: "create_sales_order", roles: ["admin", "sales"], ui: canManageSalesOrders, sql: "select public.create_sales_order(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb)" },
  { name: "confirm_sales_order", roles: ["admin", "sales"], ui: canManageSalesOrders, sql: "select public.confirm_sales_order(gen_random_uuid())" },
  { name: "cancel_sales_order", roles: ["admin", "sales"], ui: canManageSalesOrders, sql: "select public.cancel_sales_order(gen_random_uuid(), 'x')" },
  { name: "start_processing_sales_order", roles: ["admin", "warehouse_manager"], sql: "select public.start_processing_sales_order(gen_random_uuid())" },
  { name: "ship_sales_order", roles: ["admin", "warehouse_manager"], sql: "select public.ship_sales_order(gen_random_uuid())" },
  { name: "reverse_sales_order_shipment", roles: ["admin", "warehouse_manager"], sql: "select public.reverse_sales_order_shipment(gen_random_uuid(), 'x')" },
  { name: "complete_sales_order", roles: ["admin", "sales", "warehouse_manager"], sql: "select public.complete_sales_order(gen_random_uuid())" },
  { name: "request_stock_transfer", roles: ["admin", "warehouse_manager"], ui: canRequestTransfers, sql: "select public.request_stock_transfer(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb)" },
  { name: "approve_stock_transfer", roles: ["admin"], sql: "select public.approve_stock_transfer(gen_random_uuid())" },
  { name: "execute_stock_transfer", roles: ["admin", "warehouse_manager"], sql: "select public.execute_stock_transfer(gen_random_uuid())" },
];

/** Tables every active role may read (seeded, so they have rows). */
const READABLE = ["products", "categories", "warehouses", "suppliers", "customers", "roles", "profiles"];
const READ_ONLY_FOR_CLIENTS = [
  "inventory", "stock_movements", "purchase_orders", "purchase_order_items", "goods_receipts", "goods_receipt_items",
  "sales_orders", "sales_order_items", "stock_transfers", "stock_transfer_items", "audit_log",
];

describe("role matrix: RLS, RPC role checks and UI helpers agree", () => {
  let db: PGlite;
  const users = {} as Record<AppRole | "inactive", TestUser>;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    for (const role of ROLES) users[role] = await createUser(db, `${role}@stockflow.test`, role);
    users.inactive = await createUser(db, "former@stockflow.test", "admin");
    await db.query("update public.profiles set is_active = false where id = $1", [users.inactive.id]);
  });

  afterAll(async () => {
    await db.close();
  });

  const as = <T>(user: TestUser, fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: user.id }, fn);

  /**
   * Runs one statement as `user` in a transaction that is always rolled back,
   * so the matrix never changes data. The role and JWT subject are set LOCAL to
   * that transaction, so nothing has to be reset inside an aborted transaction
   * (which would hide the original error code).
   */
  async function attempt(user: TestUser, sql: string): Promise<{ ok: boolean; code?: string; rows?: number }> {
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [
        user.id,
      ]);
      await db.exec("set local role authenticated");
      const r = await db.query(sql.replace(/\{n\}/g, String(++n)));
      return { ok: true, rows: r.affectedRows ?? r.rows.length };
    } catch (e) {
      return { ok: false, code: (e as { code?: string }).code };
    } finally {
      await db.exec("rollback");
    }
  }

  describe.each(ROLES)("%s", (role) => {
    it("reads operational data", async () => {
      for (const table of [...READABLE, "inventory", "stock_movements"]) {
        await expect(as(users[role], () => db.query(`select 1 from public.${table} limit 1`))).resolves.toBeTruthy();
      }
      const products = await as(users[role], () => db.query<{ n: number }>("select count(*)::int n from public.products"));
      expect(products.rows[0].n).toBeGreaterThan(0);
    });

    it(`${role === "admin" ? "reads" : "cannot read"} the audit log`, async () => {
      await as(users.admin, () => db.query("update public.products set description = 'audit me' where sku = 'CMP-2002'"));
      const r = await as(users[role], () => db.query<{ n: number }>("select count(*)::int n from public.audit_log"));
      expect(r.rows[0].n > 0).toBe(role === "admin");
    });

    it.each(TABLE_WRITES)("master data: $name", async (cap) => {
      const allowed = cap.roles.includes(role);
      if (cap.insert !== "select 1") {
        const insert = await attempt(users[role], cap.insert);
        expect(insert.ok, `insert ${cap.name}`).toBe(allowed);
      }
      const update = await attempt(users[role], cap.update);
      // RLS filters updates silently: allowed roles change 1 row, others 0.
      expect(update.ok && update.rows === 1, `update ${cap.name}`).toBe(allowed);
      if (cap.ui) expect(cap.ui(role), `UI helper for ${cap.name}`).toBe(allowed);
    });

    it.each(RPCS)("workflow: $name", async (cap) => {
      const allowed = cap.roles.includes(role);
      const result = await attempt(users[role], cap.sql);
      if (allowed) expect(result.code, `${cap.name} should pass the role check`).not.toBe("42501");
      else expect(result.code, `${cap.name} should be refused`).toBe("42501");
      if (cap.ui) expect(cap.ui(role), `UI helper for ${cap.name}`).toBe(allowed);
    });

    it("never writes ledger, stock or documents directly, and never deletes", async () => {
      for (const table of READ_ONLY_FOR_CLIENTS) {
        const r = await attempt(users[role], `delete from public.${table}`);
        expect(r, `delete ${table}`).toMatchObject({ ok: false, code: "42501" });
      }
      for (const table of ["products", "warehouses", "suppliers", "customers", "categories"]) {
        const r = await attempt(users[role], `delete from public.${table} where false`);
        expect(r, `delete ${table}`).toMatchObject({ ok: false, code: "42501" });
      }
    });
  });

  it("a deactivated user sees no business data and can do nothing", async () => {
    await as(users.inactive, async () => {
      for (const table of [...READABLE.filter((t) => t !== "profiles"), "inventory", "stock_movements", "audit_log"]) {
        const r = await db.query<{ n: number }>(`select count(*)::int n from public.${table}`);
        expect(r.rows[0].n, table).toBe(0);
      }
    });
    for (const cap of RPCS) {
      expect((await attempt(users.inactive, cap.sql)).code, cap.name).toBe("42501");
    }
    expect((await attempt(users.inactive, TABLE_WRITES[0].insert)).ok).toBe(false);
  });

  it("an anonymous visitor is refused everywhere", async () => {
    for (const table of [...READABLE, ...READ_ONLY_FOR_CLIENTS, "v_inventory_valuation", "v_alerts"]) {
      await expect(runAs(db, { role: "anon" }, () => db.query(`select 1 from public.${table} limit 1`)), table).rejects.toThrow(
        /permission denied/,
      );
    }
    for (const cap of RPCS) {
      await expect(runAs(db, { role: "anon" }, () => db.query(cap.sql)), cap.name).rejects.toThrow(/permission denied/);
    }
  });
});
