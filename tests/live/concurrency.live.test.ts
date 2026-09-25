/**
 * Concurrency tests for create_stock_movement / reverse_stock_movement against a
 * real PostgreSQL server with a connection pool (several backends at once).
 * PGlite is single-connection, so row locking can only be proven here.
 *
 * Run: npm run test:live   (needs DATABASE_URL in .env.local - see README)
 * All data is created under a random run id and removed in afterAll.
 */
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEngineInstalled,
  beginAsUser,
  createFixture,
  createLivePool,
  createMovement,
  guardTriggersEnabled,
  leftovers,
  postCommitted,
  removeFixture,
  waitFor,
  type Fixture,
  type StockMovementRow,
} from "./live-db";

type Outcome = { ok: true; row: StockMovementRow } | { ok: false; code: string; message: string };

function settle(promise: Promise<StockMovementRow>): Promise<Outcome> {
  return promise.then(
    (row) => ({ ok: true, row }),
    (error: { code?: string; message?: string }) => ({ ok: false, code: error.code ?? "", message: error.message ?? "" }),
  );
}

/** Opens `n` transactions as the test user, releases them at the same moment, commits winners, rolls back losers. */
async function runInParallel(
  pool: Pool,
  fixture: Fixture,
  n: number,
  work: (client: PoolClient) => Promise<StockMovementRow>,
): Promise<Outcome[]> {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
  try {
    await Promise.all(clients.map((c) => beginAsUser(c, fixture.userId)));
    // All transactions are open; start every call without awaiting in between.
    const outcomes = await Promise.all(
      clients.map(async (client) => {
        const outcome = await settle(work(client));
        await client.query(outcome.ok ? "commit" : "rollback");
        return outcome;
      }),
    );
    return outcomes;
  } finally {
    for (const c of clients) c.release();
  }
}

async function stockOf(pool: Pool, productId: string, warehouseId: string): Promise<{ rows: number; quantity: number }> {
  const result = await pool.query<{ quantity: number }>(
    "select quantity from public.inventory where product_id = $1 and warehouse_id = $2",
    [productId, warehouseId],
  );
  return { rows: result.rows.length, quantity: result.rows[0]?.quantity ?? 0 };
}

async function ledgerSum(pool: Pool, productId: string, warehouseId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    "select coalesce(sum(quantity_change), 0) as total from public.stock_movements where product_id = $1 and warehouse_id = $2",
    [productId, warehouseId],
  );
  return Number(result.rows[0].total);
}

describe("inventory engine under concurrency (live PostgreSQL)", () => {
  let pool: Pool;
  let fixture: Fixture | undefined;

  beforeAll(async () => {
    pool = createLivePool(12);
    await assertEngineInstalled(pool);
    fixture = await createFixture(pool, 4);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
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
    if (!fixture) throw new Error("fixture not created");
    return fixture;
  }

  it("makes a second transaction wait for the row lock, then re-read the committed quantity", async () => {
    const f = fx();
    const productId = f.productIds[0];
    await postCommitted(pool, f, productId, "PURCHASE_RECEIPT", 10);

    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await beginAsUser(a, f.userId);
      await beginAsUser(b, f.userId);
      const bPid = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const aPid = (await a.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;

      // A takes 7 of 10 and keeps its transaction (and the row lock) open.
      const first = await createMovement(a, productId, f.warehouseId, "SALE", 7);
      expect(first).toMatchObject({ quantity_before: 10, quantity_after: 3 });

      // B asks for 7 too. Without the lock it would also see 10 and succeed.
      const second = settle(createMovement(b, productId, f.warehouseId, "SALE", 7));

      // Prove B is blocked by A (not just slow).
      const blocked = await waitFor(async () => {
        const r = await pool.query<{ blockers: number[] }>("select pg_blocking_pids($1) as blockers", [bPid]);
        return r.rows[0].blockers.includes(aPid);
      }, 15_000);
      expect(blocked).toBe(true);

      await a.query("commit");
      const outcome = await second;
      await b.query("rollback");

      // B saw A's committed quantity (3), not the stale 10.
      expect(outcome).toEqual({ ok: false, code: "SF001", message: "Insufficient stock: 3 available, 7 requested" });
    } finally {
      a.release();
      b.release();
    }

    expect(await stockOf(pool, productId, f.warehouseId)).toEqual({ rows: 1, quantity: 3 });
    expect(await ledgerSum(pool, productId, f.warehouseId)).toBe(3);
  });

  it("lets exactly as many parallel withdrawals succeed as there is stock (no lost updates)", async () => {
    const f = fx();
    const productId = f.productIds[1];
    await postCommitted(pool, f, productId, "PURCHASE_RECEIPT", 5);

    const outcomes = await runInParallel(pool, f, 8, (client) =>
      createMovement(client, productId, f.warehouseId, "SALE", 1),
    );

    const succeeded = outcomes.filter((o) => o.ok);
    const rejected = outcomes.filter((o): o is Extract<Outcome, { ok: false }> => !o.ok);
    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((o) => o.code === "SF001")).toBe(true);

    // Each successful withdrawal saw a different starting quantity: 5, 4, 3, 2, 1.
    const before = succeeded.map((o) => (o.ok ? o.row.quantity_before : -1)).sort((x, y) => y - x);
    expect(before).toEqual([5, 4, 3, 2, 1]);

    expect(await stockOf(pool, productId, f.warehouseId)).toEqual({ rows: 1, quantity: 0 });
    expect(await ledgerSum(pool, productId, f.warehouseId)).toBe(0);
  });

  it("creates exactly one inventory row when the first receipts for a location arrive at the same time", async () => {
    const f = fx();
    const productId = f.productIds[2];

    const outcomes = await runInParallel(pool, f, 4, (client) =>
      createMovement(client, productId, f.warehouseId, "PURCHASE_RECEIPT", 5),
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    const before = outcomes.map((o) => (o.ok ? o.row.quantity_before : -1)).sort((x, y) => x - y);
    expect(before).toEqual([0, 5, 10, 15]);
    expect(await stockOf(pool, productId, f.warehouseId)).toEqual({ rows: 1, quantity: 20 });
    expect(await ledgerSum(pool, productId, f.warehouseId)).toBe(20);
  });

  it("reverses a movement only once when two users reverse it at the same time", async () => {
    const f = fx();
    const productId = f.productIds[3];
    const receipt = await postCommitted(pool, f, productId, "PURCHASE_RECEIPT", 6);

    const outcomes = await runInParallel(pool, f, 2, async (client) => {
      const result = await client.query<StockMovementRow>(
        `select id, movement_number, quantity_before, quantity_after
         from public.reverse_stock_movement($1, 'Concurrency test')`,
        [receipt.id],
      );
      return result.rows[0];
    });

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const loser = outcomes.find((o) => !o.ok);
    expect(loser).toMatchObject({ ok: false, code: "SF002" });
    expect(await stockOf(pool, productId, f.warehouseId)).toEqual({ rows: 1, quantity: 0 });
  });
});
