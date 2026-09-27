/**
 * Concurrency tests for ship_sales_order against a real PostgreSQL server with
 * a connection pool: shipments competing for the same limited stock.
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
  postCommitted,
  removeFixture,
  removeSales,
  salesLeftovers,
  salesTriggerEnabled,
  waitFor,
  type Fixture,
} from "./live-db";

type Outcome = { ok: true } | { ok: false; code: string; message: string };

describe("ship_sales_order under concurrency (live PostgreSQL)", () => {
  let pool: Pool;
  let fixture: Fixture | undefined;
  let customerId: string | undefined;

  beforeAll(async () => {
    pool = createLivePool(8);
    await assertEngineInstalled(pool);
    const installed = await pool.query<{ ok: boolean }>("select to_regproc('public.ship_sales_order') is not null as ok");
    if (!installed.rows[0].ok) throw new Error("The sales workflow is not installed. Push the Phase 4 migrations first.");

    // Admin: allowed to create, confirm, process and ship.
    fixture = await createFixture(pool, 4, "admin");
    const customer = await pool.query<{ id: string }>(
      "insert into public.customers (code, name) values ($1, $2) returning id",
      [`TST-${fixture.runId}`, `Concurrency test customer ${fixture.runId}`],
    );
    customerId = customer.rows[0].id;
    fixture.extraEntityIds.push(customerId);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (customerId) {
        await removeSales(pool, customerId);
        expect(await salesLeftovers(pool, customerId)).toBe(0);
        expect(await salesTriggerEnabled(pool)).toBe(true);
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
    if (!fixture || !customerId) throw new Error("fixture not created");
    return fixture;
  }

  /** Creates, confirms and starts processing an order (committed). */
  async function processingOrder(lines: { productId: string; quantity: number }[]): Promise<{ id: string; number: string }> {
    const f = fx();
    const client = await pool.connect();
    try {
      await beginAsUser(client, f.userId);
      const so = await client.query<{ id: string; so_number: string }>(
        "select id, so_number from public.create_sales_order($1, $2, $3::jsonb)",
        [customerId, f.warehouseId, JSON.stringify(lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_price: 20 })))],
      );
      await client.query("select public.confirm_sales_order($1)", [so.rows[0].id]);
      await client.query("select public.start_processing_sales_order($1)", [so.rows[0].id]);
      await client.query("commit");
      return { id: so.rows[0].id, number: so.rows[0].so_number };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  function ship(client: PoolClient, soId: string): Promise<Outcome> {
    return client.query("select public.ship_sales_order($1)", [soId]).then(
      (): Outcome => ({ ok: true }),
      (e: { code?: string; message?: string }): Outcome => ({ ok: false, code: e.code ?? "", message: e.message ?? "" }),
    );
  }

  async function stockOf(productId: string): Promise<number> {
    const r = await pool.query<{ quantity: number }>(
      "select quantity from public.inventory where product_id = $1 and warehouse_id = $2",
      [productId, fx().warehouseId],
    );
    return r.rows[0]?.quantity ?? 0;
  }

  async function statusOf(soId: string): Promise<string> {
    return (await pool.query<{ status: string }>("select status from public.sales_orders where id = $1", [soId])).rows[0].status;
  }

  it("lets only one of two competing shipments through when stock covers just one", async () => {
    const f = fx();
    const product = f.productIds[0];
    await postCommitted(pool, f, product, "PURCHASE_RECEIPT", 10);
    const first = await processingOrder([{ productId: product, quantity: 7 }]);
    const second = await processingOrder([{ productId: product, quantity: 7 }]);

    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await beginAsUser(a, f.userId);
      await beginAsUser(b, f.userId);
      const aPid = (await a.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const bPid = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;

      // A ships 7 of 10 and keeps its transaction open.
      expect(await ship(a, first.id)).toEqual({ ok: true });

      // B tries to ship 7 too and must wait for A's lock on the stock row.
      const pending = ship(b, second.id);
      const blocked = await waitFor(async () => {
        const r = await pool.query<{ blockers: number[] }>("select pg_blocking_pids($1) as blockers", [bPid]);
        return r.rows[0].blockers.includes(aPid);
      }, 15_000);
      expect(blocked).toBe(true);

      await a.query("commit");
      const outcome = await pending;
      await b.query("rollback");

      // B saw A's committed quantity (3) and refused cleanly, naming the product.
      expect(outcome).toMatchObject({ ok: false, code: "SF001" });
      if (!outcome.ok) {
        expect(outcome.message).toBe(
          `Cannot ship ${second.number}: insufficient stock for TST-${f.runId}-1 Concurrency test product 1 (need 7, available 3)`,
        );
      }
    } finally {
      a.release();
      b.release();
    }

    expect(await stockOf(product)).toBe(3);
    expect(await statusOf(first.id)).toBe("SHIPPED");
    expect(await statusOf(second.id)).toBe("PROCESSING");
  });

  it("ships exactly as many parallel orders as the stock allows", async () => {
    const f = fx();
    const product = f.productIds[1];
    await postCommitted(pool, f, product, "PURCHASE_RECEIPT", 10);
    const orders: { id: string; number: string }[] = [];
    for (let i = 0; i < 4; i++) orders.push(await processingOrder([{ productId: product, quantity: 3 }]));

    const clients = await Promise.all(orders.map(() => pool.connect()));
    let outcomes: Outcome[];
    try {
      await Promise.all(clients.map((c) => beginAsUser(c, f.userId)));
      outcomes = await Promise.all(
        clients.map(async (client, i) => {
          const outcome = await ship(client, orders[i].id);
          await client.query(outcome.ok ? "commit" : "rollback");
          return outcome;
        }),
      );
    } finally {
      for (const c of clients) c.release();
    }

    expect(outcomes.filter((o) => o.ok)).toHaveLength(3);
    expect(outcomes.filter((o) => !o.ok)).toEqual([expect.objectContaining({ ok: false, code: "SF001" })]);
    expect(await stockOf(product)).toBe(1);
  });

  it("does not deadlock when two orders lock the same products in opposite line order", async () => {
    const f = fx();
    const [p3, p4] = [f.productIds[2], f.productIds[3]];
    await postCommitted(pool, f, p3, "PURCHASE_RECEIPT", 10);
    await postCommitted(pool, f, p4, "PURCHASE_RECEIPT", 10);
    const x = await processingOrder([
      { productId: p3, quantity: 2 },
      { productId: p4, quantity: 2 },
    ]);
    const y = await processingOrder([
      { productId: p4, quantity: 3 },
      { productId: p3, quantity: 3 },
    ]);

    const clients = await Promise.all([pool.connect(), pool.connect()]);
    let outcomes: Outcome[];
    try {
      await Promise.all(clients.map((c) => beginAsUser(c, f.userId)));
      outcomes = await Promise.all(
        [x, y].map(async (order, i) => {
          const outcome = await ship(clients[i], order.id);
          await clients[i].query(outcome.ok ? "commit" : "rollback");
          return outcome;
        }),
      );
    } finally {
      for (const c of clients) c.release();
    }

    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    expect([await stockOf(p3), await stockOf(p4)]).toEqual([5, 5]);
  });
});
