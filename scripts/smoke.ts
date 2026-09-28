/**
 * Smoke test: signs in as every demo role and renders every page of a running
 * StockFlow server (a real HTTP request with the session cookie, like a browser),
 * including detail pages for records in the states that show action buttons.
 * Fails if a page errors - e.g. a Server Component passing a function to a
 * Client Component, which type-checks and builds fine but breaks at render time.
 *
 * Read-only: only GET requests; nothing is created or changed.
 *
 *   npm run build && npm run start -- -p 3100      (in another terminal)
 *   npm run smoke                                   (SMOKE_BASE_URL defaults to http://localhost:3100)
 *
 * Needs .env.local (Supabase URL + publishable key) and the demo users (npm run seed:demo).
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database } from "../src/types/database";

config({ path: ".env.local", quiet: true });

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_USER_PASSWORD || "StockFlow!2026";
const USERS = [
  "admin@stockflow.example",
  "manager.tlv@stockflow.example",
  "purchasing@stockflow.example",
  "sales@stockflow.example",
];

/**
 * A Server Component that throws while rendering does NOT make the response fail:
 * the page still returns 200 and the error is streamed to the browser as an RSC
 * error row such as `28:E{"digest":"631588585"}` (the browser then shows the
 * error boundary). This pattern is the reliable signal; the texts below are backups.
 */
// Only NUMERIC digests are crashes: redirect() and notFound() also stream error rows,
// but with named digests (NEXT_REDIRECT;..., NEXT_HTTP_ERROR_FALLBACK;404) - that is normal control flow.
const RSC_ERROR_ROW = /\d+:E\{\\*"digest\\*":\\*"\d+\\*"/;

/** Text that only appears when rendering failed. */
const ERROR_MARKERS = [
  "This page could not be loaded", // (app)/error.tsx
  "Application error",
  "Only plain objects can be passed to Client Components",
  "Functions cannot be passed directly to Client Components",
  "Internal Server Error",
];

const STATIC_PAGES = [
  "/dashboard",
  "/dashboard?range=7d",
  "/alerts",
  "/products",
  "/products/new",
  "/inventory",
  "/movements",
  "/movements/new",
  "/warehouses",
  "/warehouses/new",
  "/suppliers",
  "/suppliers/new",
  "/purchase-orders",
  "/purchase-orders/new",
  "/goods-receipts",
  "/customers",
  "/customers/new",
  "/sales-orders",
  "/sales-orders/new",
  "/transfers",
  "/transfers/new",
  "/reports",
  "/reports/inventory-valuation",
  "/reports/stock-movements",
  "/reports/low-stock",
  "/audit-log",
  "/products/00000000-0000-4000-8000-000000000000", // not found -> in-shell 404
];

type Client = SupabaseClient<Database>;

async function signIn(url: string, key: string, email: string): Promise<{ client: Client; cookie: () => string }> {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in as ${email} failed: ${error.message}`);
  return { client, cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

/** First id of a query result. */
const firstId = (r: { data: { id: string }[] | null }) => r.data?.[0]?.id;

/** Records in the states that render each action component (as seen by this user). */
async function detailPages(client: Client): Promise<string[]> {
  const pages: string[] = [];
  const add = (prefix: string, id: string | undefined, suffixes: string[] = [""]) => {
    if (id) for (const s of suffixes) pages.push(`${prefix}/${id}${s}`);
  };

  add("/products", firstId(await client.from("products").select("id").eq("is_active", true).limit(1)), ["", "/edit"]);
  add("/warehouses", firstId(await client.from("warehouses").select("id").like("code", "WH-%").limit(1)), ["", "/edit"]);
  add("/suppliers", firstId(await client.from("suppliers").select("id").limit(1)), ["", "/edit"]);
  add("/customers", firstId(await client.from("customers").select("id").limit(1)), ["", "/edit"]);
  for (const ref of ["ADJUSTMENT", "GOODS_RECEIPT", "SALES_ORDER", "STOCK_TRANSFER", "REVERSAL"]) {
    add("/movements", firstId(await client.from("stock_movements").select("id").eq("reference_type", ref).limit(1)));
  }
  const poStatuses = ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
  for (const status of poStatuses) {
    const suffixes = status === "DRAFT" ? ["", "/edit"] : status === "APPROVED" || status === "PARTIALLY_RECEIVED" ? ["", "/receive"] : [""];
    add("/purchase-orders", firstId(await client.from("purchase_orders").select("id").eq("status", status).limit(1)), suffixes);
  }
  add("/goods-receipts", firstId(await client.from("goods_receipts").select("id").is("reversed_at", null).limit(1)));
  add("/goods-receipts", firstId(await client.from("goods_receipts").select("id").not("reversed_at", "is", null).limit(1)));
  const soStatuses = ["DRAFT", "CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED"] as const;
  for (const status of soStatuses) {
    add("/sales-orders", firstId(await client.from("sales_orders").select("id").eq("status", status).limit(1)), status === "DRAFT" ? ["", "/edit"] : [""]);
  }
  const transferStatuses = ["REQUESTED", "APPROVED", "COMPLETED", "REJECTED"] as const;
  for (const status of transferStatuses) {
    add("/transfers", firstId(await client.from("stock_transfers").select("id").eq("status", status).limit(1)));
  }
  return pages;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local");

  const health = await fetch(`${BASE}/login`).catch(() => null);
  if (!health?.ok) throw new Error(`No StockFlow server at ${BASE}. Start one: npm run start -- -p 3100`);

  let checked = 0;
  const failures: string[] = [];

  for (const email of USERS) {
    const { client, cookie } = await signIn(url, key, email);
    const pages = [...STATIC_PAGES, ...(await detailPages(client))];
    for (const page of pages) {
      const res = await fetch(`${BASE}${page}`, { headers: { cookie: cookie() }, redirect: "follow" });
      const body = await res.text();
      checked++;
      const marker = RSC_ERROR_ROW.test(body) ? "server render error (RSC error row)" : ERROR_MARKERS.find((m) => body.includes(m));
      const landedOnLogin = new URL(res.url).pathname === "/login";
      if (res.status >= 500 || marker || landedOnLogin) {
        failures.push(`${email.padEnd(32)} ${page}  -> ${res.status}${marker ? ` "${marker}"` : ""}${landedOnLogin ? " (redirected to login)" : ""}`);
      }
    }
    console.log(`${email.padEnd(32)} ${pages.length} pages`);
    await client.auth.signOut();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checked} page renders FAILED:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nAll ${checked} page renders OK.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
