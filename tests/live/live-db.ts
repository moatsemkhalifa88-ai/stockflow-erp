/**
 * Helpers for tests that run against a REAL PostgreSQL server (your hosted
 * Supabase project) through a connection pool. Used only by `npm run test:live`.
 *
 * Needs DATABASE_URL in .env.local (Supabase "Session pooler" connection string).
 * Optional DATABASE_CA_CERT: path to Supabase's CA certificate to verify TLS.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { Pool, type PoolClient, type PoolConfig } from "pg";

config({ path: ".env.local", quiet: true });

export interface StockMovementRow {
  id: string;
  movement_number: string;
  quantity_before: number;
  quantity_after: number;
}

export interface Fixture {
  runId: string;
  userId: string;
  categoryId: string;
  warehouseId: string;
  productIds: string[];
  /** Other rows a test created (e.g. a supplier) whose audit entries must be removed too. */
  extraEntityIds: string[];
}

export function createLivePool(max: number): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase Session pooler connection string to .env.local " +
        "(see README > Testing > Concurrency test).",
    );
  }

  const parsed = new URL(url);
  // TLS is configured below; a sslmode in the URL would override it.
  parsed.searchParams.delete("sslmode");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const caPath = process.env.DATABASE_CA_CERT;

  const poolConfig: PoolConfig = {
    connectionString: parsed.toString(),
    // Encrypted always; certificate verified when DATABASE_CA_CERT is provided.
    ssl: isLocal ? false : caPath ? { ca: readFileSync(caPath, "utf8") } : { rejectUnauthorized: false },
    max,
    connectionTimeoutMillis: 20_000,
    // Fail fast with a clear error if a pooled connection dies mid-query,
    // instead of waiting minutes for the TCP connection to time out.
    query_timeout: 60_000,
    application_name: "stockflow-concurrency-test",
  };
  const pool = new Pool(poolConfig);
  // The pooler may close idle connections; pg reports that on the pool. Log it
  // rather than letting it surface as an unhandled error in an unrelated test.
  pool.on("error", (error) => console.warn(`[live-db] idle connection closed: ${error.message}`));
  return pool;
}

/** Fails fast with a clear message when the Phase 2 migration is not on the target database. */
export async function assertEngineInstalled(pool: Pool): Promise<void> {
  const result = await pool.query<{ installed: boolean }>(
    "select to_regproc('public.reverse_stock_movement') is not null as installed",
  );
  if (!result.rows[0].installed) {
    throw new Error("The inventory engine is not installed on this database. Push the Phase 2 migration first.");
  }
}

/**
 * Starts a transaction on `client` that behaves like a PostgREST request from
 * `userId`: role `authenticated` and the JWT subject set for auth.uid().
 */
export async function beginAsUser(client: PoolClient, userId: string): Promise<void> {
  await client.query("begin");
  await client.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true),
            set_config('lock_timeout', '20s', true),
            set_config('statement_timeout', '45s', true)`,
    [JSON.stringify({ sub: userId, role: "authenticated" }), userId],
  );
  await client.query("set local role authenticated");
}

export async function createMovement(
  client: PoolClient,
  productId: string,
  warehouseId: string,
  type: "PURCHASE_RECEIPT" | "SALE" | "ADJUSTMENT_OUT",
  quantity: number,
): Promise<StockMovementRow> {
  const result = await client.query<StockMovementRow>(
    `select id, movement_number, quantity_before, quantity_after
     from public.create_stock_movement(
       p_product_id => $1, p_warehouse_id => $2, p_movement_type => $3::public.movement_type,
       p_quantity => $4, p_reason => 'Concurrency test')`,
    [productId, warehouseId, type, quantity],
  );
  return result.rows[0];
}

/** Runs one committed movement as the test user. */
export async function postCommitted(
  pool: Pool,
  fixture: Fixture,
  productId: string,
  type: "PURCHASE_RECEIPT" | "SALE",
  quantity: number,
): Promise<StockMovementRow> {
  const client = await pool.connect();
  try {
    await beginAsUser(client, fixture.userId);
    const row = await createMovement(client, productId, fixture.warehouseId, type, quantity);
    await client.query("commit");
    return row;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Creates an isolated fixture tagged with a random run id: a warehouse-manager
 * auth user (the profile trigger gives it the role), a category, a warehouse and
 * `productCount` products. Nothing existing is touched.
 */
export async function createFixture(
  pool: Pool,
  productCount: number,
  role: "warehouse_manager" | "admin" = "warehouse_manager",
): Promise<Fixture> {
  const runId = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const userId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
               jsonb_build_object('role', $3::text), '{"full_name":"Concurrency Test"}'::jsonb, now(), now())`,
      [userId, `concurrency-${runId.toLowerCase()}@stockflow.test`, role],
    );
    const category = await client.query<{ id: string }>(
      "insert into public.categories (code, name) values ($1, $2) returning id",
      [`TST-${runId}`, `Concurrency test ${runId}`],
    );
    const warehouse = await client.query<{ id: string }>(
      "insert into public.warehouses (code, name, city) values ($1, $2, 'Test') returning id",
      [`TST-${runId}`, `Concurrency test ${runId}`],
    );
    const productIds: string[] = [];
    for (let i = 1; i <= productCount; i++) {
      const product = await client.query<{ id: string }>(
        `insert into public.products (sku, name, category_id, cost_price, sale_price)
         values ($1, $2, $3, 10, 20) returning id`,
        [`TST-${runId}-${i}`, `Concurrency test product ${i}`, category.rows[0].id],
      );
      productIds.push(product.rows[0].id);
    }
    await client.query("commit");
    return { runId, userId, categoryId: category.rows[0].id, warehouseId: warehouse.rows[0].id, productIds, extraEntityIds: [] };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes everything the fixture created, including its ledger and audit rows.
 *
 * stock_movements and audit_log are append-only, so this test-only cleanup
 * disables their guard triggers INSIDE one transaction as the table owner.
 * DDL is transactional in PostgreSQL: the triggers are re-enabled before commit
 * and no other session ever sees them disabled (ALTER TABLE holds a lock on the
 * table until commit). Only rows belonging to this run's ids are deleted.
 */
export async function removeFixture(pool: Pool, fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '30s'");
    await client.query("alter table public.stock_movements disable trigger stock_movements_append_only");
    await client.query("alter table public.audit_log disable trigger audit_log_append_only");

    const movements = await client.query<{ id: string }>(
      "delete from public.stock_movements where product_id = any($1::uuid[]) returning id",
      [fixture.productIds],
    );
    await client.query("delete from public.inventory where product_id = any($1::uuid[])", [fixture.productIds]);
    await client.query("delete from public.products where id = any($1::uuid[])", [fixture.productIds]);
    await client.query("delete from public.warehouses where id = $1", [fixture.warehouseId]);
    await client.query("delete from public.categories where id = $1", [fixture.categoryId]);
    await client.query("delete from auth.users where id = $1", [fixture.userId]); // cascades to the profile

    const entityIds = [
      ...movements.rows.map((m) => m.id),
      ...fixture.productIds,
      fixture.warehouseId,
      fixture.categoryId,
      fixture.userId,
      ...fixture.extraEntityIds,
    ];
    await client.query("delete from public.audit_log where user_id = $1 or entity_id = any($2::text[])", [
      fixture.userId,
      entityIds,
    ]);

    await client.query("alter table public.audit_log enable trigger audit_log_append_only");
    await client.query("alter table public.stock_movements enable trigger stock_movements_append_only");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Counts rows the fixture could have left behind. All should be 0 after removeFixture. */
export async function leftovers(pool: Pool, fixture: Fixture): Promise<Record<string, number>> {
  const result = await pool.query<Record<string, string>>(
    `select
       (select count(*) from public.stock_movements where product_id = any($1::uuid[])) as stock_movements,
       (select count(*) from public.inventory where product_id = any($1::uuid[]))       as inventory,
       (select count(*) from public.products where id = any($1::uuid[]))                as products,
       (select count(*) from public.warehouses where id = $2)                           as warehouses,
       (select count(*) from public.categories where id = $3)                           as categories,
       (select count(*) from public.profiles where id = $4)                             as profiles,
       (select count(*) from auth.users where id = $4)                                  as auth_users,
       (select count(*) from public.audit_log
         where user_id = $4 or entity_id = any($5::text[]))                             as audit_log`,
    [
      fixture.productIds,
      fixture.warehouseId,
      fixture.categoryId,
      fixture.userId,
      [...fixture.productIds, fixture.warehouseId, fixture.categoryId, fixture.userId, ...fixture.extraEntityIds],
    ],
  );
  return Object.fromEntries(Object.entries(result.rows[0]).map(([k, v]) => [k, Number(v)]));
}

/** Both append-only guard triggers must be enabled ('O') after the run. */
export async function guardTriggersEnabled(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ n: string }>(
    `select count(*) as n from pg_trigger
     where tgname in ('stock_movements_append_only', 'audit_log_append_only') and tgenabled = 'O'`,
  );
  return Number(result.rows[0].n) === 2;
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Removes purchasing documents created for a supplier (receipts, lines, orders)
 * and the supplier itself. Run BEFORE removeFixture: receipt lines reference the
 * stock movements that removeFixture deletes.
 *
 * Lines of non-draft orders are frozen by a trigger, so this test-only cleanup
 * switches that trigger off inside one transaction as the table owner (same
 * approach and guarantees as removeFixture).
 */
export async function removePurchasing(pool: Pool, supplierId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '30s'");
    await client.query("alter table public.purchase_order_items disable trigger purchase_order_items_enforce_rules");
    await client.query(
      `delete from public.goods_receipt_items where goods_receipt_id in (
         select g.id from public.goods_receipts g join public.purchase_orders po on po.id = g.purchase_order_id
         where po.supplier_id = $1)`,
      [supplierId],
    );
    await client.query(
      "delete from public.goods_receipts where purchase_order_id in (select id from public.purchase_orders where supplier_id = $1)",
      [supplierId],
    );
    await client.query("delete from public.purchase_orders where supplier_id = $1", [supplierId]); // cascades to lines
    await client.query("delete from public.suppliers where id = $1", [supplierId]);
    await client.query("alter table public.purchase_order_items enable trigger purchase_order_items_enforce_rules");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function purchasingLeftovers(pool: Pool, supplierId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select (select count(*) from public.suppliers where id = $1)
          + (select count(*) from public.purchase_orders where supplier_id = $1) as n`,
    [supplierId],
  );
  return Number(r.rows[0].n);
}

export async function purchasingTriggerEnabled(pool: Pool): Promise<boolean> {
  const r = await pool.query<{ n: string }>(
    "select count(*) as n from pg_trigger where tgname = 'purchase_order_items_enforce_rules' and tgenabled = 'O'",
  );
  return Number(r.rows[0].n) === 1;
}
