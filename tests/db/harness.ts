import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(root, "supabase", "migrations");

export type AppRole = "admin" | "warehouse_manager";

export interface TestUser {
  id: string;
  email: string;
}

function readSql(file: string): string {
  return readFileSync(file, "utf8");
}

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(migrationsDir, f));
}

/** A fresh in-memory Postgres with the Supabase stub and all migrations applied. */
export async function createTestDb(options: { seed?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readSql(path.join(__dirname, "supabase-stub.sql")));

  for (const file of migrationFiles()) {
    try {
      await db.exec(readSql(file));
    } catch (error) {
      throw new Error(`Migration ${path.basename(file)} failed: ${(error as Error).message}`);
    }
  }

  if (options.seed) {
    await db.exec(readSql(path.join(root, "supabase", "seed.sql")));
  }

  return db;
}

/** Inserts an auth user; the on_auth_user_created trigger creates the profile. */
export async function createUser(db: PGlite, email: string, role: AppRole): Promise<TestUser> {
  const result = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data)
     values ($1, jsonb_build_object('role', $2::text), jsonb_build_object('full_name', $1::text))
     returning id`,
    [email, role],
  );
  return { id: result.rows[0].id, email };
}

/**
 * Runs `fn` as a PostgREST request would: with the given database role and JWT subject.
 * Always resets back to the superuser afterwards.
 */
export async function runAs<T>(
  db: PGlite,
  identity: { role: "anon" } | { role: "authenticated"; userId: string },
  fn: () => Promise<T>,
): Promise<T> {
  const sub = identity.role === "authenticated" ? identity.userId : "";
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [identity.role]);
  await db.exec(`set role ${identity.role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('request.jwt.claim.role', '', false)");
  }
}

export async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query<{ n: number | string }>(sql, params);
  return Number(result.rows[0].n);
}
