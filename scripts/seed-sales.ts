/**
 * Loads 30 demo sales orders in mixed statuses across the 5 standard
 * warehouses, plus 4 stock transfers, THROUGH THE WORKFLOW RPCs, each step as
 * the demo user whose role allows it:
 *   sales@        drafts, confirms, cancels, completes
 *   manager.tlv@  starts processing, ships (ship_sales_order -> create_stock_movement),
 *                 reverses a shipment, requests and executes transfers
 *   admin@        approves / rejects transfers
 *
 * Mix: 9 completed, 6 shipped, 4 processing, 5 confirmed, 3 drafts and 3
 * cancelled (one of them after its shipment was reversed). Quantities are
 * chosen from current stock so every shipment succeeds; ship dates follow the
 * order dates so sales history spreads over the last two months.
 * Runs only when there are no sales orders yet (transfers: none yet).
 *
 * Requires: migrations applied, npm run seed:users (incl. the sales user), stock
 * (npm run seed:stock / seed:purchasing).
 * Usage: npm run seed:sales
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { addDays, businessToday } from "../src/lib/format";
import type { Database } from "../src/types/database";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

type Client = SupabaseClient<Database>;
type Plan = "DRAFT" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "COMPLETED" | "CANCEL_DRAFT" | "CANCEL_CONFIRMED" | "REVERSED_CANCEL";

/** Oldest first, so SO numbers follow order dates. */
const PLANS: { plan: Plan; daysAgo: number }[] = [
  { plan: "COMPLETED", daysAgo: 58 },
  { plan: "COMPLETED", daysAgo: 55 },
  { plan: "COMPLETED", daysAgo: 51 },
  { plan: "CANCEL_CONFIRMED", daysAgo: 49 },
  { plan: "COMPLETED", daysAgo: 46 },
  { plan: "COMPLETED", daysAgo: 42 },
  { plan: "COMPLETED", daysAgo: 38 },
  { plan: "REVERSED_CANCEL", daysAgo: 35 },
  { plan: "COMPLETED", daysAgo: 31 },
  { plan: "COMPLETED", daysAgo: 27 },
  { plan: "COMPLETED", daysAgo: 24 },
  { plan: "SHIPPED", daysAgo: 20 },
  { plan: "SHIPPED", daysAgo: 17 },
  { plan: "CANCEL_DRAFT", daysAgo: 15 },
  { plan: "SHIPPED", daysAgo: 13 },
  { plan: "SHIPPED", daysAgo: 11 },
  { plan: "SHIPPED", daysAgo: 9 },
  { plan: "SHIPPED", daysAgo: 7 },
  { plan: "PROCESSING", daysAgo: 6 },
  { plan: "CONFIRMED", daysAgo: 6 },
  { plan: "PROCESSING", daysAgo: 5 },
  { plan: "CONFIRMED", daysAgo: 5 },
  { plan: "PROCESSING", daysAgo: 4 },
  { plan: "CONFIRMED", daysAgo: 3 },
  { plan: "PROCESSING", daysAgo: 3 },
  { plan: "CONFIRMED", daysAgo: 2 },
  { plan: "CONFIRMED", daysAgo: 2 },
  { plan: "DRAFT", daysAgo: 1 },
  { plan: "DRAFT", daysAgo: 1 },
  { plan: "DRAFT", daysAgo: 0 },
];

const SHIPS: Plan[] = ["SHIPPED", "COMPLETED", "REVERSED_CANCEL"];

function roll(key: string): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) / 2 ** 32;
}

function requireEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`Missing ${name}${fallbackName ? ` (or ${fallbackName})` : ""}. Add it to .env.local.`);
  return value;
}

async function signIn(url: string, key: string, email: string, password: string): Promise<Client> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in as ${email} failed (${error.message}). Run npm run seed:users first.`);
  return client;
}

function ok<T>(result: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new Error(`${what}: no data`);
  return result.data;
}

/** 09:00-17:00 UTC on a given day, never in the future. */
function at(day: string, seed: string): string {
  const hour = 6 + Math.floor(roll(seed) * 8);
  const when = new Date(`${day}T${String(hour).padStart(2, "0")}:15:00Z`);
  return (when.getTime() > Date.now() ? new Date() : when).toISOString();
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = process.env.DEMO_USER_PASSWORD || "StockFlow!2026";

  const seller = await signIn(url, key, "sales@stockflow.example", password);
  const warehouse = await signIn(url, key, "manager.tlv@stockflow.example", password);
  const admin = await signIn(url, key, "admin@stockflow.example", password);

  const existing = await seller.from("sales_orders").select("id", { count: "exact", head: true });
  if (existing.error) throw new Error(`Could not read sales orders: ${existing.error.message}`);

  // Only the standard demo warehouses, never ones users created while trying the app.
  const warehouses = ok(
    await seller.from("warehouses").select("id, code").eq("is_active", true).like("code", "WH-%").order("code"),
    "warehouses",
  );
  const customers = ok(
    await seller.from("customers").select("id, code, customer_type").eq("is_active", true).order("code"),
    "customers",
  );
  const stockRows = ok(
    await seller
      .from("inventory_valuation")
      .select("product_id, warehouse_id, sku, quantity, product_is_active")
      .gt("quantity", 0)
      .eq("product_is_active", true),
    "stock",
  );
  // Working copy of stock per warehouse, decremented as orders ship.
  const stock = new Map<string, { productId: string; sku: string; quantity: number }[]>();
  for (const r of stockRows) {
    if (!r.warehouse_id || !r.product_id || !r.sku) continue;
    const list = stock.get(r.warehouse_id) ?? [];
    list.push({ productId: r.product_id, sku: r.sku, quantity: r.quantity ?? 0 });
    stock.set(r.warehouse_id, list);
  }

  const today = businessToday();

  if ((existing.count ?? 0) > 0) {
    console.log(`There are already ${existing.count} sales orders - skipping sales orders.`);
  } else {
    const tally: Record<string, number> = {};
    let movements = 0;

    for (const [index, { plan, daysAgo }] of PLANS.entries()) {
      const wh = warehouses[index % warehouses.length];
      const customer = customers[(index * 7) % customers.length];
      const orderDate = addDays(today, -daysAgo);
      const available = (stock.get(wh.id) ?? []).filter((s) => s.quantity >= 4);
      if (available.length === 0) throw new Error(`No stock left at ${wh.code} for demo orders.`);

      // 1-4 distinct in-stock products; quantities a slice of what is on hand.
      const lineCount = 1 + Math.floor(roll(`so-lines-${index}`) * 4);
      const picked = new Set<number>();
      for (let n = 0; picked.size < Math.min(lineCount, available.length); n++) {
        picked.add(Math.floor(roll(`so-product-${index}-${n}`) * available.length));
      }
      const bulk = customer.customer_type === "WHOLESALE" || customer.customer_type === "GOVERNMENT";
      const lines = [...picked].map((p) => {
        const item = available[p];
        const quantity = Math.max(1, Math.min(bulk ? 40 : 15, Math.floor(item.quantity * (0.05 + roll(`so-qty-${index}-${p}`) * 0.2))));
        const discountRoll = roll(`so-disc-${index}-${p}`);
        const discount = bulk ? [5, 7.5, 10, 12.5][Math.floor(discountRoll * 4)] : discountRoll < 0.7 ? 0 : 5;
        return { item, quantity, discount };
      });

      const so = ok(
        await seller.rpc("create_sales_order", {
          p_customer_id: customer.id,
          p_warehouse_id: wh.id,
          p_items: lines.map((l) => ({ product_id: l.item.productId, quantity: l.quantity, discount_percent: l.discount })),
          p_order_date: orderDate,
          p_requested_delivery_date: addDays(orderDate, 3 + Math.floor(roll(`so-req-${index}`) * 5)),
          p_notes: plan === "DRAFT" ? "Waiting for the customer's final quantities" : undefined,
        }),
        `create SO ${index + 1}`,
      );

      if (plan === "CANCEL_DRAFT") {
        ok(await seller.rpc("cancel_sales_order", { p_so_id: so.id, p_reason: "Duplicate order entered by mistake" }), "cancel");
      }
      if (plan !== "DRAFT" && plan !== "CANCEL_DRAFT") {
        ok(await seller.rpc("confirm_sales_order", { p_so_id: so.id }), `confirm ${so.so_number}`);
      }
      if (plan === "CANCEL_CONFIRMED") {
        ok(await seller.rpc("cancel_sales_order", { p_so_id: so.id, p_reason: "Customer postponed the project" }), "cancel");
      }
      if (plan === "PROCESSING" || SHIPS.includes(plan)) {
        ok(await warehouse.rpc("start_processing_sales_order", { p_so_id: so.id }), `process ${so.so_number}`);
      }
      if (SHIPS.includes(plan)) {
        const shipDay = addDays(orderDate, 1 + Math.floor(roll(`so-ship-${index}`) * 3));
        ok(
          await warehouse.rpc("ship_sales_order", { p_so_id: so.id, p_shipped_at: at(shipDay > today ? today : shipDay, `ship-${index}`) }),
          `ship ${so.so_number}`,
        );
        for (const l of lines) l.item.quantity -= l.quantity;
        movements += lines.length;
      }
      if (plan === "COMPLETED") {
        ok(await seller.rpc("complete_sales_order", { p_so_id: so.id }), `complete ${so.so_number}`);
      }
      if (plan === "REVERSED_CANCEL") {
        ok(
          await warehouse.rpc("reverse_sales_order_shipment", {
            p_so_id: so.id,
            p_reason: "Customer refused the delivery: wrong model ordered",
          }),
          `reverse ${so.so_number}`,
        );
        for (const l of lines) l.item.quantity += l.quantity;
        ok(await seller.rpc("cancel_sales_order", { p_so_id: so.id, p_reason: "Customer will re-order the correct model" }), "cancel");
      }

      const final = await seller.from("sales_orders").select("so_number, status, total_amount").eq("id", so.id).single();
      if (final.error) throw new Error(final.error.message);
      tally[final.data.status] = (tally[final.data.status] ?? 0) + 1;
      console.log(
        `  ${final.data.so_number}  ${final.data.status.padEnd(10)} ${customer.code} @ ${wh.code}  ${lines.length} lines  ${final.data.total_amount.toFixed(2)}`,
      );
    }
    console.log(`\nSales orders: ${PLANS.length}; sale movements posted: ${movements}.`);
    console.log(Object.entries(tally).map(([s, n]) => `${s}: ${n}`).join(", "));
  }

  // --- Stock transfers ------------------------------------------------------
  const transfers = await warehouse.from("stock_transfers").select("id", { count: "exact", head: true });
  if (transfers.error) throw new Error(transfers.error.message);
  if ((transfers.count ?? 0) > 0) {
    console.log(`There are already ${transfers.count} transfers - skipping transfers.`);
  } else {
    const byCode = new Map(warehouses.map((w) => [w.code, w.id]));
    const route = (from: string, to: string) => {
      const source = byCode.get(from);
      const destination = byCode.get(to);
      if (!source || !destination) throw new Error(`Missing warehouse ${from} or ${to}`);
      const items = (stock.get(source) ?? [])
        .filter((s) => s.quantity >= 20)
        .slice(0, 2)
        .map((s) => ({ product_id: s.productId, quantity: Math.floor(s.quantity / 5) }));
      if (items.length === 0) throw new Error(`No stock at ${from} to transfer`);
      return { p_source_warehouse_id: source, p_destination_warehouse_id: destination, p_items: items };
    };

    const done = ok(await warehouse.rpc("request_stock_transfer", { ...route("WH-TLV", "WH-ASH"), p_notes: "Rebalance before the holiday rush" }), "request 1");
    ok(await admin.rpc("approve_stock_transfer", { p_transfer_id: done.id }), "approve 1");
    ok(await warehouse.rpc("execute_stock_transfer", { p_transfer_id: done.id }), "execute 1");

    const approved = ok(await warehouse.rpc("request_stock_transfer", route("WH-HFA", "WH-JLM")), "request 2");
    ok(await admin.rpc("approve_stock_transfer", { p_transfer_id: approved.id }), "approve 2");

    ok(await warehouse.rpc("request_stock_transfer", { ...route("WH-BSV", "WH-TLV"), p_notes: "Low on these in Tel Aviv" }), "request 3");

    const rejected = ok(await warehouse.rpc("request_stock_transfer", route("WH-ASH", "WH-HFA")), "request 4");
    ok(
      await admin.rpc("reject_stock_transfer", { p_transfer_id: rejected.id, p_reason: "Haifa already has enough of these" }),
      "reject 4",
    );
    console.log("Transfers: 1 completed, 1 approved, 1 requested, 1 rejected.");
  }

  await Promise.all([seller.auth.signOut(), warehouse.auth.signOut(), admin.auth.signOut()]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
