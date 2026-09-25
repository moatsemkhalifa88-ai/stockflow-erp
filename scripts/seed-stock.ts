/**
 * Loads demo opening balances THROUGH THE INVENTORY ENGINE: it signs in as the
 * demo admin and calls the create_stock_movement RPC, exactly like the app does.
 * Every quantity therefore has a ledger row, a user and an audit entry.
 *
 * The mix is deterministic: most locations are well stocked, some are below the
 * minimum (Low Stock) and a few were written off to zero (Out of Stock).
 * Runs only when the ledger is empty, so it is safe to run twice.
 *
 * Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 * Needs the demo users (npm run seed:users). Optional: DEMO_USER_PASSWORD.
 *
 * Usage: npm run seed:stock
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database } from "../src/types/database";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const ADMIN_EMAIL = "admin@stockflow.example";
const CONCURRENCY = 6;

interface Line {
  productId: string;
  warehouseId: string;
  sku: string;
  warehouseCode: string;
  opening: number;
  writeOff: number;
}

/** Stable pseudo-random number in [0, 1) for a key. */
function roll(key: string): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) / 2 ** 32;
}

function requireEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`Missing ${name}${fallbackName ? ` (or ${fallbackName})` : ""}. Add it to .env.local.`);
  return value;
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = process.env.DEMO_USER_PASSWORD || "StockFlow!2026";

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
  if (signInError) throw new Error(`Sign-in as ${ADMIN_EMAIL} failed (${signInError.message}). Run npm run seed:users first.`);

  const { count, error: countError } = await supabase.from("stock_movements").select("id", { count: "exact", head: true });
  if (countError) throw new Error(`Could not read the ledger: ${countError.message}`);
  if ((count ?? 0) > 0) {
    console.log(`The ledger already has ${count} movements - nothing to do.`);
    return;
  }

  const [products, warehouses] = await Promise.all([
    supabase.from("products").select("id, sku, min_stock_level, reorder_quantity").eq("is_active", true).order("sku"),
    supabase.from("warehouses").select("id, code, warehouse_type").eq("is_active", true).order("code"),
  ]);
  if (products.error) throw new Error(products.error.message);
  if (warehouses.error) throw new Error(warehouses.error.message);

  const lines: Line[] = [];
  for (const p of products.data) {
    for (const w of warehouses.data) {
      const r = roll(`${p.sku}@${w.code}`);
      const isMain = w.warehouse_type === "MAIN";
      if (!isMain && r < 0.3) continue; // not every product is kept everywhere
      const min = Math.max(p.min_stock_level, 1);
      const shape = roll(`${p.sku}@${w.code}#shape`);
      let opening: number;
      let writeOff = 0;
      if (shape < 0.07) {
        opening = Math.max(1, Math.round(min * 0.5)); // later written off -> Out of Stock
        writeOff = opening;
      } else if (shape < 0.2) {
        opening = Math.max(1, Math.round(min * (0.3 + r * 0.6))); // Low Stock
      } else {
        opening = Math.round(min * (isMain ? 3 : 1.5) + (p.reorder_quantity || min) * r * 2); // In Stock
      }
      lines.push({ productId: p.id, warehouseId: w.id, sku: p.sku, warehouseCode: w.code, opening, writeOff });
    }
  }

  console.log(`Posting opening balances for ${lines.length} product/warehouse locations as ${ADMIN_EMAIL}...`);
  let posted = 0;
  await runPool(lines, async (line) => {
    const opening = await supabase.rpc("create_stock_movement", {
      p_product_id: line.productId,
      p_warehouse_id: line.warehouseId,
      p_movement_type: "ADJUSTMENT_IN",
      p_quantity: line.opening,
      p_reference_type: "OPENING_BALANCE",
      p_reference_number: "OB-2026",
      p_reason: "Opening balance (demo data)",
    });
    if (opening.error) throw new Error(`${line.sku} @ ${line.warehouseCode}: ${opening.error.message}`);

    if (line.writeOff > 0) {
      const writeOff = await supabase.rpc("create_stock_movement", {
        p_product_id: line.productId,
        p_warehouse_id: line.warehouseId,
        p_movement_type: "ADJUSTMENT_OUT",
        p_quantity: line.writeOff,
        p_reference_number: "CS-2026-001",
        p_reason: "Damaged in warehouse",
      });
      if (writeOff.error) throw new Error(`${line.sku} @ ${line.warehouseCode}: ${writeOff.error.message}`);
    }
    posted++;
    if (posted % 50 === 0) console.log(`  ${posted}/${lines.length}`);
  });

  console.log(`Done: ${lines.length} locations, ${lines.filter((l) => l.writeOff > 0).length} written off to zero.`);
  await supabase.auth.signOut();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
