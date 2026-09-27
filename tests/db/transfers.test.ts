import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, createTestDb, createUser, runAs, type TestUser } from "./harness";

interface Transfer {
  id: string;
  transfer_number: string;
  status: string;
}

describe("stock transfers", () => {
  let db: PGlite;
  let admin: TestUser;
  let manager: TestUser;
  let seller: TestUser;
  let buyer: TestUser;
  let tlv: string;
  let hfa: string;
  let jlm: string;
  const product: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    admin = await createUser(db, "admin@stockflow.test", "admin");
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    seller = await createUser(db, "seller@stockflow.test", "sales");
    buyer = await createUser(db, "buyer@stockflow.test", "purchasing");
    const wh = async (code: string) => (await db.query<{ id: string }>("select id from public.warehouses where code = $1", [code])).rows[0].id;
    tlv = await wh("WH-TLV");
    hfa = await wh("WH-HFA");
    jlm = await wh("WH-JLM");
    for (const sku of ["OFF-4001", "OFF-4002", "OFF-4003"]) {
      product[sku] = (await db.query<{ id: string }>("select id from public.products where sku = $1", [sku])).rows[0].id;
    }
  });

  afterAll(async () => {
    await db.close();
  });

  const as = <T>(user: TestUser, fn: () => Promise<T>) => runAs(db, { role: "authenticated", userId: user.id }, fn);

  async function stock(sku: string, warehouse: string, quantity: number): Promise<void> {
    await as(manager, () =>
      db.query("select public.create_stock_movement($1, $2, 'ADJUSTMENT_IN', $3, p_reason => 'Test stock')", [product[sku], warehouse, quantity]),
    );
  }

  async function stockOf(sku: string, warehouse: string): Promise<number> {
    const r = await db.query<{ quantity: number }>(
      "select quantity from public.inventory where product_id = $1 and warehouse_id = $2",
      [product[sku], warehouse],
    );
    return r.rows[0]?.quantity ?? 0;
  }

  async function request(user: TestUser, from: string, to: string, items: { sku: string; quantity: number }[]): Promise<Transfer> {
    const r = await as(user, () =>
      db.query<Transfer>("select * from public.request_stock_transfer($1, $2, $3::jsonb)", [
        from,
        to,
        JSON.stringify(items.map((i) => ({ product_id: product[i.sku], quantity: i.quantity }))),
      ]),
    );
    return r.rows[0];
  }

  async function step(user: TestUser, fn: string, id: string): Promise<Transfer> {
    return (await as(user, () => db.query<Transfer>(`select * from public.${fn}($1)`, [id]))).rows[0];
  }

  async function approved(from: string, to: string, items: { sku: string; quantity: number }[]): Promise<Transfer> {
    const t = await request(manager, from, to, items);
    return step(admin, "approve_stock_transfer", t.id);
  }

  it("moves stock from source to destination: TRANSFER_OUT + TRANSFER_IN, COMPLETED, audited", async () => {
    await stock("OFF-4001", tlv, 50);
    await stock("OFF-4002", tlv, 20);
    const hfaBefore = await stockOf("OFF-4001", hfa);
    const t = await approved(tlv, hfa, [
      { sku: "OFF-4001", quantity: 30 },
      { sku: "OFF-4002", quantity: 20 },
    ]);

    const done = await step(manager, "execute_stock_transfer", t.id);
    expect(done.status).toBe("COMPLETED");
    expect(await stockOf("OFF-4001", tlv)).toBe(20);
    expect(await stockOf("OFF-4002", tlv)).toBe(0);
    expect(await stockOf("OFF-4001", hfa)).toBe(hfaBefore + 30);
    expect(await stockOf("OFF-4002", hfa)).toBe(20);

    const legs = await db.query<{ movement_type: string; warehouse_id: string; quantity_change: number; reference_number: string }>(
      `select movement_type, warehouse_id, quantity_change, reference_number from public.stock_movements
       where reference_type = 'STOCK_TRANSFER' and reference_id = $1 order by movement_type, quantity_change`,
      [t.id],
    );
    expect(legs.rows).toEqual([
      { movement_type: "TRANSFER_IN", warehouse_id: hfa, quantity_change: 20, reference_number: t.transfer_number },
      { movement_type: "TRANSFER_IN", warehouse_id: hfa, quantity_change: 30, reference_number: t.transfer_number },
      { movement_type: "TRANSFER_OUT", warehouse_id: tlv, quantity_change: -30, reference_number: t.transfer_number },
      { movement_type: "TRANSFER_OUT", warehouse_id: tlv, quantity_change: -20, reference_number: t.transfer_number },
    ]);
    const actions = await db.query<{ action: string }>(
      "select action from public.audit_log where entity_type = 'stock_transfers' and entity_id = $1 order by id",
      [t.id],
    );
    expect(actions.rows.map((a) => a.action)).toEqual(["TRANSFER_REQUEST", "TRANSFER_APPROVE", "TRANSFER_EXECUTE"]);
  });

  it("changes nothing at either warehouse when the source is short on any line", async () => {
    await stock("OFF-4003", tlv, 5);
    await stock("OFF-4001", tlv, 5);
    const before = {
      a: await stockOf("OFF-4003", tlv),
      b: await stockOf("OFF-4001", tlv),
      c: await stockOf("OFF-4003", jlm),
      d: await stockOf("OFF-4001", jlm),
    };
    const movements = await count(db, "select count(*) n from public.stock_movements");
    const t = await approved(tlv, jlm, [
      { sku: "OFF-4003", quantity: 5 }, // enough
      { sku: "OFF-4001", quantity: before.b + 1 }, // short by one
    ]);

    await expect(step(manager, "execute_stock_transfer", t.id)).rejects.toMatchObject({
      code: "SF001",
      message: expect.stringMatching(new RegExp(`^Cannot execute ${t.transfer_number}: insufficient stock at the source for OFF-4001 .+ \\(need ${before.b + 1}, available ${before.b}\\)$`)),
    });
    expect({
      a: await stockOf("OFF-4003", tlv),
      b: await stockOf("OFF-4001", tlv),
      c: await stockOf("OFF-4003", jlm),
      d: await stockOf("OFF-4001", jlm),
    }).toEqual(before);
    expect(await count(db, "select count(*) n from public.stock_movements")).toBe(movements);
    expect((await db.query<{ status: string }>("select status from public.stock_transfers where id = $1", [t.id])).rows[0].status).toBe("APPROVED");
  });

  it("requires different source and destination warehouses", async () => {
    await expect(request(manager, tlv, tlv, [{ sku: "OFF-4001", quantity: 1 }])).rejects.toThrow(/must be different/);
    await expect(
      db.query("insert into public.stock_transfers (source_warehouse_id, destination_warehouse_id) values ($1, $1)", [tlv]),
    ).rejects.toThrow(/stock_transfers_different_warehouses/);
  });

  it("refuses to execute into an inactive destination", async () => {
    await stock("OFF-4002", hfa, 5);
    const t = await approved(hfa, jlm, [{ sku: "OFF-4002", quantity: 1 }]);
    await db.query("update public.warehouses set is_active = false where id = $1", [jlm]);
    try {
      await expect(step(manager, "execute_stock_transfer", t.id)).rejects.toThrow(/inactive/);
    } finally {
      await db.query("update public.warehouses set is_active = true where id = $1", [jlm]);
    }
  });

  describe("status transitions", () => {
    it("follows request -> approval -> execution only", async () => {
      await stock("OFF-4002", tlv, 3);
      const t = await request(manager, tlv, hfa, [{ sku: "OFF-4002", quantity: 1 }]);
      await expect(step(manager, "execute_stock_transfer", t.id)).rejects.toMatchObject({ code: "SF007" });
      await step(admin, "approve_stock_transfer", t.id);
      await expect(step(admin, "approve_stock_transfer", t.id)).rejects.toMatchObject({ code: "SF007" });
      await step(manager, "execute_stock_transfer", t.id);
      await expect(step(manager, "execute_stock_transfer", t.id)).rejects.toMatchObject({ code: "SF007" });
      await expect(
        as(manager, () => db.query("select public.cancel_stock_transfer($1, 'too late')", [t.id])),
      ).rejects.toMatchObject({ code: "SF007" });
    });

    it("rejects and cancels without touching inventory", async () => {
      const movements = await count(db, "select count(*) n from public.stock_movements");
      const rejected = await request(manager, tlv, hfa, [{ sku: "OFF-4001", quantity: 1 }]);
      await as(admin, () => db.query("select public.reject_stock_transfer($1, 'Not needed at Haifa')", [rejected.id]));
      await expect(step(admin, "approve_stock_transfer", rejected.id)).rejects.toMatchObject({ code: "SF007" });

      const cancelled = await approved(tlv, hfa, [{ sku: "OFF-4001", quantity: 1 }]);
      await as(manager, () => db.query("select public.cancel_stock_transfer($1, 'Truck unavailable')", [cancelled.id]));
      await expect(step(manager, "execute_stock_transfer", cancelled.id)).rejects.toMatchObject({ code: "SF007" });

      expect(await count(db, "select count(*) n from public.stock_movements")).toBe(movements);
    });

    it("rejects invalid transitions and line edits even for direct SQL", async () => {
      const t = await request(manager, tlv, hfa, [{ sku: "OFF-4001", quantity: 1 }]);
      await expect(db.query("update public.stock_transfers set status = 'COMPLETED' where id = $1", [t.id])).rejects.toThrow(
        /cannot go from REQUESTED to COMPLETED/,
      );
      await step(admin, "approve_stock_transfer", t.id);
      await expect(
        db.query("update public.stock_transfer_items set quantity = 99 where stock_transfer_id = $1", [t.id]),
      ).rejects.toMatchObject({ code: "SF007" });
      await expect(
        db.query("update public.stock_transfers set destination_warehouse_id = $2 where id = $1", [t.id, jlm]),
      ).rejects.toMatchObject({ code: "SF007" });
    });

    it("keeps transfer legs inside the workflow and never reverses one leg alone", async () => {
      await stock("OFF-4003", hfa, 4);
      const t = await approved(hfa, tlv, [{ sku: "OFF-4003", quantity: 2 }]);
      await expect(
        as(manager, () =>
          db.query(
            `select public.create_stock_movement($1, $2, 'TRANSFER_IN', 100, p_reference_type => 'STOCK_TRANSFER', p_reference_id => $3)`,
            [product["OFF-4003"], tlv, t.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "SF008" });

      await step(manager, "execute_stock_transfer", t.id);
      const leg = (
        await db.query<{ id: string }>(
          "select id from public.stock_movements where reference_id = $1 and movement_type = 'TRANSFER_IN'",
          [t.id],
        )
      ).rows[0].id;
      await expect(as(manager, () => db.query("select public.reverse_stock_movement($1, 'x')", [leg]))).rejects.toMatchObject({
        code: "SF008",
        message: expect.stringContaining("transfer back"),
      });
    });
  });

  describe("permissions", () => {
    it("only admins approve or reject", async () => {
      const t = await request(manager, tlv, hfa, [{ sku: "OFF-4001", quantity: 1 }]);
      await expect(step(manager, "approve_stock_transfer", t.id)).rejects.toMatchObject({ code: "42501" });
      await expect(
        as(manager, () => db.query("select public.reject_stock_transfer($1, 'no')", [t.id])),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("sales and purchasing cannot request, execute or cancel transfers", async () => {
      for (const user of [seller, buyer]) {
        await expect(request(user, tlv, hfa, [{ sku: "OFF-4001", quantity: 1 }])).rejects.toMatchObject({ code: "42501" });
      }
      const t = await approved(tlv, hfa, [{ sku: "OFF-4001", quantity: 1 }]);
      await expect(step(seller, "execute_stock_transfer", t.id)).rejects.toMatchObject({ code: "42501" });
      await expect(
        as(buyer, () => db.query("select public.cancel_stock_transfer($1, 'no')", [t.id])),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("blocks anonymous callers and direct client writes", async () => {
      await expect(
        runAs(db, { role: "anon" }, () => db.query("select public.request_stock_transfer($1, $2, '[]'::jsonb)", [tlv, hfa])),
      ).rejects.toThrow(/permission denied for function request_stock_transfer/);
      await expect(
        as(admin, () =>
          db.query("insert into public.stock_transfers (source_warehouse_id, destination_warehouse_id) values ($1, $2)", [tlv, hfa]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
