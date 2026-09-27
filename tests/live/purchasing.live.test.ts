/**
 * Concurrency tests for receive_goods against a real PostgreSQL server with a
 * connection pool: two people receiving the same purchase order line at once.
 *
 * Run: npm run test:live   (needs DATABASE_URL in .env.local - see README)
 * Everything is created under a random run id and removed in afterAll.
 */
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEngineInstalled,
  beginAsUser,
  createFixture,
  createLivePool,
  guardTriggersEnabled,
  leftovers,
  purchasingLeftovers,
  purchasingTriggerEnabled,
  removeFixture,
  removePurchasing,
  waitFor,
  type Fixture,
} from "./live-db";

type Outcome = { ok: true; receiptId: string } | { ok: false; code: string; message: string };

interface ApprovedOrder {
  poId: string;
  lineId: string;
  productId: string;
}

describe("receive_goods under concurrency (live PostgreSQL)", () => {
  let pool: Pool;
  let fixture: Fixture | undefined;
  let supplierId: string | undefined;

  beforeAll(async () => {
    pool = createLivePool(8);
    await assertEngineInstalled(pool);
    const installed = await pool.query<{ ok: boolean }>("select to_regproc('public.receive_goods') is not null as ok");
    if (!installed.rows[0].ok) throw new Error("The purchasing workflow is not installed. Push the Phase 3 migrations first.");

    // Admin: allowed to create, approve and receive, so one test user covers the workflow.
    fixture = await createFixture(pool, 2, "admin");
    const supplier = await pool.query<{ id: string }>(
      "insert into public.suppliers (code, name) values ($1, $2) returning id",
      [`TST-${fixture.runId}`, `Concurrency test supplier ${fixture.runId}`],
    );
    supplierId = supplier.rows[0].id;
    fixture.extraEntityIds.push(supplierId);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (supplierId) {
        await removePurchasing(pool, supplierId);
        expect(await purchasingLeftovers(pool, supplierId)).toBe(0);
        expect(await purchasingTriggerEnabled(pool)).toBe(true);
      }
      if (fixture) {
        await removeFixture(pool, fixture);
        expect(Object.values(await leftovers(pool, fixture)).every((n) => n === 0)).toBe(true);
        expect(await guardTriggersEnabled(pool)).toBe(true);
      }
    } finally {
      await pool.end();
    }
  });

  function fx(): Fixture {
    if (!fixture || !supplierId) throw new Error("fixture not created");
    return fixture;
  }

  /** Creates, submits and approves a one-line order, committed. */
  async function approvedOrder(productId: string, quantity: number): Promise<ApprovedOrder> {
    const f = fx();
    const client = await pool.connect();
    try {
      await beginAsUser(client, f.userId);
      const po = await client.query<{ id: string }>(
        "select id from public.create_purchase_order($1, $2, $3::jsonb)",
        [supplierId, f.warehouseId, JSON.stringify([{ product_id: productId, quantity, unit_cost: 10 }])],
      );
      const poId = po.rows[0].id;
      await client.query("select public.submit_purchase_order($1)", [poId]);
      await client.query("select public.approve_purchase_order($1)", [poId]);
      const line = await client.query<{ id: string }>(
        "select id from public.purchase_order_items where purchase_order_id = $1",
        [poId],
      );
      await client.query("commit");
      return { poId, lineId: line.rows[0].id, productId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  function receive(client: PoolClient, order: ApprovedOrder, quantity: number): Promise<Outcome> {
    return client
      .query<{ id: string }>("select id from public.receive_goods($1, $2::jsonb)", [
        order.poId,
        JSON.stringify([{ purchase_order_item_id: order.lineId, quantity }]),
      ])
      .then(
        (r): Outcome => ({ ok: true, receiptId: r.rows[0].id }),
        (e: { code?: string; message?: string }): Outcome => ({ ok: false, code: e.code ?? "", message: e.message ?? "" }),
      );
  }

  async function state(order: ApprovedOrder) {
    const f = fx();
    const r = await pool.query<{ received: number; status: string; receipts: string; stock: number | null; movements: string }>(
      `select i.quantity_received as received,
              po.status,
              (select count(*) from public.goods_receipts g where g.purchase_order_id = po.id) as receipts,
              (select quantity from public.inventory where product_id = $2 and warehouse_id = $3) as stock,
              (select count(*) from public.stock_movements where product_id = $2 and warehouse_id = $3) as movements
       from public.purchase_orders po
       join public.purchase_order_items i on i.purchase_order_id = po.id
       where po.id = $1`,
      [order.poId, order.productId, f.warehouseId],
    );
    const row = r.rows[0];
    return {
      received: row.received,
      status: row.status,
      receipts: Number(row.receipts),
      stock: row.stock ?? 0,
      movements: Number(row.movements),
    };
  }

  it("makes the second receiver wait for the first, then rejects the over-receipt", async () => {
    const f = fx();
    const order = await approvedOrder(f.productIds[0], 10);

    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await beginAsUser(a, f.userId);
      await beginAsUser(b, f.userId);
      const aPid = (await a.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const bPid = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;

      // A receives 7 of 10 and keeps its transaction open.
      const first = await receive(a, order, 7);
      expect(first.ok).toBe(true);

      // B also tries to receive 7. Without the lock both would see 0 received.
      const second = receive(b, order, 7);
      const blocked = await waitFor(async () => {
        const r = await pool.query<{ blockers: number[] }>("select pg_blocking_pids($1) as blockers", [bPid]);
        return r.rows[0].blockers.includes(aPid);
      }, 15_000);
      expect(blocked).toBe(true);

      await a.query("commit");
      const outcome = await second;
      await b.query("rollback");

      expect(outcome).toEqual({
        ok: false,
        code: "SF006",
        message: "Cannot receive 7 of line 1 (" + `TST-${f.runId}-1` + "): only 3 outstanding (10 ordered, 7 already received)",
      });
    } finally {
      a.release();
      b.release();
    }

    expect(await state(order)).toEqual({ received: 7, status: "PARTIALLY_RECEIVED", receipts: 1, stock: 7, movements: 1 });
  });

  it("never receives more than ordered when many receipts arrive at once", async () => {
    const f = fx();
    const order = await approvedOrder(f.productIds[1], 10);

    const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
    let outcomes: Outcome[];
    try {
      await Promise.all(clients.map((c) => beginAsUser(c, f.userId)));
      outcomes = await Promise.all(
        clients.map(async (client) => {
          const outcome = await receive(client, order, 3);
          await client.query(outcome.ok ? "commit" : "rollback");
          return outcome;
        }),
      );
    } finally {
      for (const c of clients) c.release();
    }

    // 3 + 3 + 3 = 9 fits in 10; the fourth receipt of 3 does not.
    expect(outcomes.filter((o) => o.ok)).toHaveLength(3);
    expect(outcomes.filter((o) => !o.ok)).toEqual([expect.objectContaining({ ok: false, code: "SF006" })]);
    expect(await state(order)).toEqual({ received: 9, status: "PARTIALLY_RECEIVED", receipts: 3, stock: 9, movements: 3 });
  });
});
