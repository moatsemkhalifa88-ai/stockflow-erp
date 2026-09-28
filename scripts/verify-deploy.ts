/**
 * Verifies a deployed StockFlow site end-to-end in a real headless browser.
 * Read-only: it signs in and views pages, and never submits a form other than login.
 *
 *   npm run verify:deploy -- https://your-app.vercel.app
 *   (or set VERIFY_BASE_URL; the default is http://localhost:3000)
 *
 * Checks, per demo user: sign-in lands on the dashboard, the KPIs hold real
 * numbers, key pages render without an error boundary or a streamed server
 * error, and the browser console stays clean. Then it scans every HTML and JS
 * file the browser loaded for server-only secrets: their variable names, and
 * their values when .env.local is present (values are never printed).
 *
 * Needs `npx playwright install chromium` once (run as: node node_modules/playwright/cli.js install chromium).
 */
import { config } from "dotenv";
import { chromium, type Page } from "playwright";

config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? process.env.VERIFY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_USER_PASSWORD || "StockFlow!2026";
const USERS = (process.env.VERIFY_USERS ?? "admin@stockflow.example,purchasing@stockflow.example").split(",");
const PAGES = ["/inventory", "/purchase-orders", "/alerts", "/goods-receipts", "/sales-orders", "/reports"];

/** A server component crash still returns 200; the error is streamed as a row with a numeric digest. */
const RSC_ERROR_ROW = /\d+:E\{\\*"digest\\*":\\*"\d+\\*"/;
const ERROR_TEXTS = [
  "This page could not be loaded",
  "Application error",
  "Missing Supabase configuration",
  "Internal Server Error",
  "Server Components render",
];
const SECRET_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "DATABASE_CA_CERT", "DEMO_USER_PASSWORD"];
/** Values that must never reach a browser (only those set locally are checked). */
const SECRET_VALUES = SECRET_NAMES.map((name) => ({ name, value: process.env[name] ?? "" })).filter(
  (s) => s.value.length >= 8 && s.name !== "DEMO_USER_PASSWORD", // the demo password is public by design
);

interface Result {
  check: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];
const consoleErrors: string[] = [];
const bodies = new Map<string, string>(); // url -> text of every HTML/JS response the browser loaded

function record(check: string, ok: boolean, detail = ""): void {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}${detail ? `  (${detail})` : ""}`);
}

/** Error rendering, or a blank page. `appShell` pages (signed in) must also have their <main> content. */
async function pageProblem(page: Page, appShell = true): Promise<string | null> {
  const html = await page.content();
  // The digest is what Vercel's runtime logs print next to the real error message.
  const digest = html.match(/"digest\\*":\\*"(\d+)/)?.[1];
  if (RSC_ERROR_ROW.test(html)) return `server render error streamed to the page, digest ${digest}`;
  const text = await page.locator("body").innerText();
  const marker = ERROR_TEXTS.find((m) => text.includes(m) || html.includes(m));
  if (marker) return `error text: "${marker}"${digest ? `, digest ${digest}` : ""}`;
  if (!appShell) return null;
  if (text.trim().length < 200) return "page is (almost) blank";
  if ((await page.locator("main").count()) === 0) return "no <main> content";
  return null;
}

async function visit(page: Page, label: string, path: string): Promise<void> {
  const before = consoleErrors.length;
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const status = response?.status() ?? 0;
  const landed = new URL(page.url()).pathname;
  const problem =
    status >= 400 ? `HTTP ${status}` : landed === "/login" ? "bounced to /login" : await pageProblem(page);
  const newErrors = consoleErrors.length - before;
  record(`${label} ${path} renders`, problem === null, problem ?? `HTTP ${status}`);
  record(`${label} ${path} console clean`, newErrors === 0, newErrors ? `${newErrors} console error(s), listed below` : "");
}

async function main(): Promise<void> {
  console.log(`Verifying ${BASE}\n`);
  const browser = await chromium.launch();
  try {
    // 1. Root -> login page.
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attach(page, "anonymous");
      const response = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const onLogin = new URL(page.url()).pathname === "/login";
      const hasForm = (await page.getByLabel("Email").count()) > 0 && (await page.getByLabel("Password").count()) > 0;
      const problem = await pageProblem(page, false);
      record("root loads and shows the login page", (response?.ok() ?? false) && onLogin && hasForm && !problem, `HTTP ${response?.status()}, at ${new URL(page.url()).pathname}${problem ? `, ${problem}` : ""}`);
      record("login page console clean", consoleErrors.length === 0, consoleErrors.length ? "listed below" : "");
      await context.close();
    }

    for (const email of USERS) {
      const label = email.split("@")[0];
      const context = await browser.newContext();
      const page = await context.newPage();
      attach(page, label);

      // 2. Sign in.
      const errorsBefore = consoleErrors.length;
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      const signedIn = await page
        .waitForURL((url) => url.pathname === "/dashboard", { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForLoadState("networkidle");
      const problem = signedIn ? await pageProblem(page) : `still at ${new URL(page.url()).pathname}`;
      record(`${label} signs in and lands on the dashboard`, signedIn && problem === null, problem ?? "");

      // 3. KPIs hold real data.
      if (signedIn) {
        const kpis = await readKpis(page);
        const nonZero = kpis.filter((k) => /[1-9]/.test(k.value));
        record(
          `${label} dashboard KPIs show real data`,
          kpis.length >= 6 && nonZero.length >= 4,
          kpis.map((k) => `${k.label}: ${k.value}`).join("; "),
        );
      }
      const loginErrors = consoleErrors.length - errorsBefore;
      record(`${label} login + dashboard console clean`, loginErrors === 0, loginErrors ? `${loginErrors} console error(s), listed below` : "");

      // 4 + 5. Other pages, console.
      for (const path of PAGES) await visit(page, label, path);
      await context.close();
    }

    // 6. Secrets in anything the browser downloaded.
    const leaks: string[] = [];
    for (const [url, body] of bodies) {
      for (const name of SECRET_NAMES) if (body.includes(name)) leaks.push(`name ${name} in ${shortUrl(url)}`);
      for (const s of SECRET_VALUES) if (body.includes(s.value)) leaks.push(`VALUE of ${s.name} in ${shortUrl(url)}`);
      if (/"role"\s*:\s*"service_role"/.test(decodeJwts(body))) leaks.push(`a service_role JWT in ${shortUrl(url)}`);
      if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(body)) leaks.push(`an sb_secret_ key in ${shortUrl(url)}`);
    }
    record(
      "no server-only secrets in the client bundle",
      leaks.length === 0,
      `${bodies.size} HTML/JS files scanned, ${SECRET_VALUES.length} secret values compared${leaks.length ? `; ${leaks.join("; ")}` : ""}`,
    );
  } finally {
    await browser.close();
  }

  if (consoleErrors.length > 0) console.log(`\nConsole errors (verbatim):\n${consoleErrors.map((e) => `  ${e}`).join("\n")}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exit(1);
}

function attach(page: Page, label: string): void {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${label} ${new URL(page.url()).pathname}] ${msg.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`[${label} ${new URL(page.url()).pathname}] uncaught: ${error.message}`));
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (!/javascript|html|x-component/.test(type)) return;
    try {
      bodies.set(response.url(), await response.text());
    } catch {
      // Redirects and aborted requests have no body.
    }
  });
}

async function readKpis(page: Page): Promise<{ label: string; value: string }[]> {
  // KpiCard: <p>label</p><p class="text-2xl ...">value</p>
  await page.locator("p.text-2xl").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  return page.locator("p.text-2xl").evaluateAll((nodes) =>
    nodes.map((n) => ({ label: n.previousElementSibling?.textContent?.trim() ?? "?", value: n.textContent?.trim() ?? "" })),
  );
}

/** Decodes the payload of anything shaped like a JWT, so a leaked service_role key is caught by its claim. */
function decodeJwts(body: string): string {
  const matches = body.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? [];
  return matches.map((jwt) => Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).join("\n");
}

const shortUrl = (url: string) => url.replace(BASE, "");

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
