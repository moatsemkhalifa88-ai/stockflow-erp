/**
 * Loads 20 demo purchase orders in mixed statuses THROUGH THE WORKFLOW RPCs,
 * each step as the demo user whose role allows it:
 *   purchasing@  creates and submits      admin@  approves
 *   manager.tlv@ receives (receive_goods -> create_stock_movement)
 * so every received unit has a goods receipt, a PURCHASE_RECEIPT movement,
 * inventory and audit entries - exactly as if done in the app.
 *
 * Mix: 5 received, 4 partially received (one via a reversed receipt),
 * 3 approved (some overdue), 3 submitted, 3 drafts, 2 cancelled.
 * Runs only when there are no purchase orders yet.
 *
 * Requires: migrations applied, npm run seed:users (incl. the purchasing user).
 * Usage: npm run seed:purchasing
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { addDays, businessToday } from "../src/lib/format";
import type { Database } from "../src/types/database";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

type Client = SupabaseClient<Database>;
type Plan = "DRAFT" | "SUBMITTED" | "APPROVED" | "PARTIAL" | "REVERSED" | "RECEIVED" | "CANCEL_DRAFT" | "CANCEL_APPROVED";

/** Oldest first, so PO numbers follow order dates. */
const PLANS: { plan: Plan; daysAgo: number }[] = [
  { plan: "RECEIVED", daysAgo: 74 },
  { plan: "RECEIVED", daysAgo: 66 },
  { plan: "RECEIVED", daysAgo: 58 },
  { plan: "CANCEL_APPROVED", daysAgo: 52 },
  { plan: "RECEIVED", daysAgo: 47 },
  { plan: "RECEIVED", daysAgo: 41 },
  { plan: "PARTIAL", daysAgo: 36 },
  { plan: "PARTIAL", daysAgo: 30 },
  { plan: "REVERSED", daysAgo: 26 },
  { plan: "PARTIAL", daysAgo: 22 },
  { plan: "APPROVED", daysAgo: 18 },
  { plan: "CANCEL_DRAFT", daysAgo: 15 },
  { plan: "APPROVED", daysAgo: 11 },
  { plan: "APPROVED", daysAgo: 6 },
  { plan: "SUBMITTED", daysAgo: 5 },
  { plan: "SUBMITTED", daysAgo: 3 },
  { plan: "SUBMITTED", daysAgo: 2 },
  { plan: "DRAFT", daysAgo: 2 },
  { plan: "DRAFT", daysAgo: 1 },
  { plan: "DRAFT", daysAgo: 0 },
];

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

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new Error(`${what}: no data`);
  return result.data;
}

/** A receipt timestamp on a given day (08:30 UTC), never in the future. */
function receivedAt(day: string): string {
  const at = new Date(`${day}T08:30:00Z`);
  return (at.getTime() > Date.now() ? new Date() : at).toISOString();
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = process.env.DEMO_USER_PASSWORD || "StockFlow!2026";

  const buyer = await signIn(url, key, "purchasing@stockflow.example", password);
  const admin = await signIn(url, key, "admin@stockflow.example", password);
  const receiver = await signIn(url, key, "manager.tlv@stockflow.example", password);

  const existing = await buyer.from("purchase_orders").select("id", { count: "exact", head: true });
  if (existing.error) throw new Error(`Could not read purchase orders: ${existing.error.message}`);
  if ((existing.count ?? 0) > 0) {
    console.log(`There are already ${existing.count} purchase orders - nothing to do.`);
    return;
  }

  const suppliers = check(
    await buyer.from("suppliers").select("id, code, lead_time_days").eq("is_active", true).order("code"),
    "suppliers",
  );
  // Only the standard demo warehouses (seed.sql), never ones users created while trying the app.
  const warehouses = check(
    await buyer.from("warehouses").select("id, code").eq("is_active", true).like("code", "WH-%").order("code"),
    "warehouses",
  );
  const products = check(
    await buyer.from("products").select("id, sku, cost_price, reorder_quantity").eq("is_active", true).order("sku"),
    "products",
  );
  if (suppliers.length === 0 || warehouses.length === 0 || products.length < 4) throw new Error("Seed master data first.");

  const today = businessToday();
  const tally: Record<string, number> = {};
  let receipts = 0;
  let movements = 0;

  for (const [index, { plan, daysAgo }] of PLANS.entries()) {
    const supplier = suppliers[index % suppliers.length];
    const warehouse = warehouses[index % warehouses.length];
    const orderDate = addDays(today, -daysAgo);
    const deliveryDate = addDays(orderDate, supplier.lead_time_days);

    // 2-4 distinct products, deterministic per order.
    const lineCount = 2 + Math.floor(roll(`lines-${index}`) * 3);
    const picked = new Set<number>();
    for (let n = 0; picked.size < lineCount; n++) picked.add(Math.floor(roll(`product-${index}-${n}`) * products.length));
    const items = [...picked].map((p) => {
      const product = products[p];
      const base = Math.max(product.reorder_quantity, 10);
      return {
        product_id: product.id,
        quantity: Math.max(1, Math.round(base * (0.5 + roll(`qty-${index}-${p}`)))),
        // Negotiated prices: 0-6% below list cost.
        unit_cost: Math.round(product.cost_price * (0.94 + roll(`cost-${index}-${p}`) * 0.06) * 100) / 100,
      };
    });

    const po = check(
      await buyer.rpc("create_purchase_order", {
        p_supplier_id: supplier.id,
        p_warehouse_id: warehouse.id,
        p_items: items,
        p_order_date: orderDate,
        p_expected_delivery_date: deliveryDate,
        p_notes: plan === "DRAFT" ? "Awaiting final quantities from the warehouse" : undefined,
      }),
      `create PO ${index + 1}`,
    );

    if (plan === "CANCEL_DRAFT") {
      check(await buyer.rpc("cancel_purchase_order", { p_po_id: po.id, p_reason: "Duplicate of an existing order" }), "cancel");
    }
    if (plan !== "DRAFT" && plan !== "CANCEL_DRAFT") {
      check(await buyer.rpc("submit_purchase_order", { p_po_id: po.id }), `submit ${po.po_number}`);
    }
    if (["APPROVED", "PARTIAL", "REVERSED", "RECEIVED", "CANCEL_APPROVED"].includes(plan)) {
      check(await admin.rpc("approve_purchase_order", { p_po_id: po.id }), `approve ${po.po_number}`);
    }
    if (plan === "CANCEL_APPROVED") {
      check(
        await buyer.rpc("cancel_purchase_order", { p_po_id: po.id, p_reason: "Supplier discontinued the product line" }),
        `cancel ${po.po_number}`,
      );
    }

    if (plan === "PARTIAL" || plan === "REVERSED" || plan === "RECEIVED") {
      const lines = check(
        await receiver
          .from("purchase_order_items")
          .select("id, quantity_ordered")
          .eq("purchase_order_id", po.id)
          .order("line_number"),
        "lines",
      );
      // Deliveries arrive around the expected date, in one or two drops.
      const firstDrop = lines.slice(0, Math.ceil(lines.length / 2));
      const secondDrop = lines.slice(firstDrop.length);
      const deliveries: { day: string; items: { purchase_order_item_id: string; quantity: number }[] }[] = [];

      if (plan === "PARTIAL") {
        deliveries.push({
          day: addDays(orderDate, supplier.lead_time_days - 1),
          items: [
            ...firstDrop.map((l) => ({ purchase_order_item_id: l.id, quantity: l.quantity_ordered })),
            ...secondDrop.slice(0, 1).map((l) => ({ purchase_order_item_id: l.id, quantity: Math.floor(l.quantity_ordered / 2) })),
          ].filter((i) => i.quantity > 0),
        });
      } else {
        deliveries.push({
          day: addDays(orderDate, supplier.lead_time_days - 1),
          items: firstDrop.map((l) => ({ purchase_order_item_id: l.id, quantity: l.quantity_ordered })),
        });
        deliveries.push({
          day: addDays(orderDate, supplier.lead_time_days + 1),
          items: secondDrop.map((l) => ({ purchase_order_item_id: l.id, quantity: l.quantity_ordered })),
        });
      }

      let lastReceiptId = "";
      for (const delivery of deliveries.filter((d) => d.items.length > 0)) {
        const day = delivery.day < orderDate ? orderDate : delivery.day;
        const receipt = check(
          await receiver.rpc("receive_goods", {
            p_po_id: po.id,
            p_items: delivery.items,
            p_notes: `Delivery note DN-${String(4000 + index * 7 + receipts).padStart(5, "0")}`,
            p_received_at: receivedAt(day > today ? today : day),
          }),
          `receive ${po.po_number}`,
        );
        lastReceiptId = receipt.id;
        receipts++;
        movements += delivery.items.length;
      }

      if (plan === "REVERSED" && lastReceiptId) {
        check(
          await receiver.rpc("reverse_goods_receipt", {
            p_goods_receipt_id: lastReceiptId,
            p_reason: "Delivered to the wrong warehouse; returned to the carrier",
          }),
          `reverse receipt on ${po.po_number}`,
        );
      }
    }

    const { data: final, error: finalError } = await buyer
      .from("purchase_orders")
      .select("po_number, status")
      .eq("id", po.id)
      .single();
    if (finalError) throw new Error(`status of ${po.po_number}: ${finalError.message}`);
    tally[final.status] = (tally[final.status] ?? 0) + 1;
    console.log(`  ${final.po_number}  ${final.status.padEnd(18)} ${supplier.code} -> ${warehouse.code}  ${items.length} lines`);
  }

  console.log(`\nDone: ${PLANS.length} purchase orders, ${receipts} goods receipts, ${movements} purchase-receipt movements.`);
  console.log(Object.entries(tally).map(([s, n]) => `${s}: ${n}`).join(", "));
  await Promise.all([buyer.auth.signOut(), admin.auth.signOut(), receiver.auth.signOut()]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
