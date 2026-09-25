import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

describe("warehouse maintenance", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let otherManager: TestUser;
  let auditor: TestUser;
  let inactive: TestUser;

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    otherManager = await createUser(db, "manager2@stockflow.test", "warehouse_manager");
    await db.query("insert into public.roles (code, name) values ('auditor', 'Auditor')");
    auditor = await createUser(db, "auditor@stockflow.test", "auditor");
    inactive = await createUser(db, "former@stockflow.test", "warehouse_manager");
    await db.query("update public.profiles set is_active = false where id = $1", [inactive.id]);
  });

  afterAll(async () => {
    await db.close();
  });

  const as = <T>(user: TestUser, fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: user.id }, fn);

  async function createWarehouse(user: TestUser, code: string, managerId: string | null = null): Promise<string> {
    const r = await as(user, () =>
      db.query<{ id: string }>(
        `insert into public.warehouses (code, name, warehouse_type, city, manager_id)
         values ($1, 'Warehouse ' || $1, 'REGIONAL', 'Netanya', $2) returning id`,
        [code, managerId],
      ),
    );
    return r.rows[0].id;
  }

  async function auditFor(id: string) {
    const r = await db.query<{ action: string; user_email: string | null; details: { changed_fields?: Record<string, unknown> } }>(
      "select action, user_email, details from public.audit_log where entity_type = 'warehouses' and entity_id = $1 order by id",
      [id],
    );
    return r.rows;
  }

  it("lets warehouse managers and admins create warehouses, audited with the acting user", async () => {
    const byManager = await createWarehouse(manager, "WH-NTN", manager.id);
    const byAdmin = await createWarehouse(admin, "WH-EIL");

    expect(await auditFor(byManager)).toEqual([
      expect.objectContaining({ action: "INSERT", user_email: manager.email }),
    ]);
    expect(await auditFor(byAdmin)).toEqual([expect.objectContaining({ action: "INSERT", user_email: admin.email })]);
  });

  it("audits every edit with the changed fields", async () => {
    const id = await createWarehouse(manager, "WH-RHV");
    await as(manager, () =>
      db.query("update public.warehouses set name = 'Rehovot Hub', phone = '08-555-0600' where id = $1", [id]),
    );
    const entries = await auditFor(id);
    expect(entries.at(-1)).toMatchObject({
      action: "UPDATE",
      user_email: manager.email,
      details: { changed_fields: { name: "Rehovot Hub", phone: "08-555-0600" } },
    });
  });

  it("deactivates instead of deleting, and the deactivation is audited", async () => {
    const id = await createWarehouse(manager, "WH-KFS");
    await expect(as(manager, () => db.query("delete from public.warehouses where id = $1", [id]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(admin, () => db.query("delete from public.warehouses where id = $1", [id]))).rejects.toThrow(
      /permission denied/,
    );

    await as(manager, () => db.query("update public.warehouses set is_active = false where id = $1", [id]));
    expect((await auditFor(id)).at(-1)).toMatchObject({
      action: "UPDATE",
      details: { changed_fields: { is_active: false } },
    });
    expect(await count(db, "select count(*) n from public.warehouses where id = $1", [id])).toBe(1);
  });

  it("does not let other roles or deactivated users create or edit warehouses", async () => {
    await expect(createWarehouse(auditor, "WH-AUD")).rejects.toThrow(/row-level security/);
    await expect(createWarehouse(inactive, "WH-OLD")).rejects.toThrow(/row-level security/);

    const id = await createWarehouse(manager, "WH-HRZ");
    const updated = await as(auditor, () =>
      db.query("update public.warehouses set name = 'Hijacked' where id = $1", [id]),
    );
    expect(updated.affectedRows).toBe(0);
  });

  it("only accepts an active admin or warehouse manager as the warehouse manager", async () => {
    const id = await createWarehouse(manager, "WH-MOD", otherManager.id);
    await as(manager, () => db.query("update public.warehouses set manager_id = $1 where id = $2", [admin.id, id]));

    await expect(
      as(manager, () => db.query("update public.warehouses set manager_id = $1 where id = $2", [auditor.id, id])),
    ).rejects.toMatchObject({ code: "SF005" });
    await expect(
      as(manager, () => db.query("update public.warehouses set manager_id = $1 where id = $2", [inactive.id, id])),
    ).rejects.toMatchObject({ code: "SF005" });
    await expect(createWarehouse(manager, "WH-BAD", auditor.id)).rejects.toMatchObject({ code: "SF005" });
  });

  it("keeps a warehouse valid when its manager is later deactivated", async () => {
    const id = await createWarehouse(manager, "WH-LOD", otherManager.id);
    await db.query("update public.profiles set is_active = false where id = $1", [otherManager.id]);
    // Editing other fields must still work; only a *new* manager is validated.
    await as(manager, () => db.query("update public.warehouses set phone = '08-555-0700' where id = $1", [id]));
    await db.query("update public.profiles set is_active = true where id = $1", [otherManager.id]);
  });

  it("locks the warehouse code once stock has moved there", async () => {
    const id = await createWarehouse(manager, "WH-ARD");
    await as(manager, () => db.query("update public.warehouses set code = 'WH-ARD2' where id = $1", [id]));

    const productId = (await db.query<{ id: string }>("select id from public.products where sku = 'CMP-2001'")).rows[0].id;
    await as(manager, () =>
      db.query("select public.create_stock_movement($1, $2, 'PURCHASE_RECEIPT', 5)", [productId, id]),
    );

    await expect(
      as(manager, () => db.query("update public.warehouses set code = 'WH-ARD3' where id = $1", [id])),
    ).rejects.toMatchObject({ code: "SF004" });
    await as(manager, () => db.query("update public.warehouses set name = 'Arad Depot' where id = $1", [id]));
  });

  it("stops an inactive warehouse from receiving stock but lets it be emptied", async () => {
    const id = await createWarehouse(manager, "WH-DIM");
    const productId = (await db.query<{ id: string }>("select id from public.products where sku = 'CMP-2002'")).rows[0].id;
    await as(manager, () => db.query("select public.create_stock_movement($1, $2, 'PURCHASE_RECEIPT', 4)", [productId, id]));
    await as(manager, () => db.query("update public.warehouses set is_active = false where id = $1", [id]));

    await expect(
      as(manager, () => db.query("select public.create_stock_movement($1, $2, 'PURCHASE_RECEIPT', 1)", [productId, id])),
    ).rejects.toThrow(/inactive/);
    await as(manager, () =>
      db.query("select public.create_stock_movement($1, $2, 'ADJUSTMENT_OUT', 4, p_reason => 'Site closed')", [productId, id]),
    );
  });
});
