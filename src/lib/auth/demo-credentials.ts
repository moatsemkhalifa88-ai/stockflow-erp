import "server-only";
import type { DemoAccountKey } from "./demo-accounts";

/**
 * Sign-in details for the demo accounts, server side only: the "server-only"
 * import makes the build fail if a Client Component ever imports this file.
 * The accounts are created by `npm run seed:users` (scripts/seed-users.ts).
 */
export const DEMO_ACCOUNT_EMAILS: Record<DemoAccountKey, string> = {
  admin: "admin@stockflow.example",
  purchasing: "purchasing@stockflow.example",
  sales: "sales@stockflow.example",
  "manager-tlv": "manager.tlv@stockflow.example",
  "manager-hfa": "manager.hfa@stockflow.example",
};

/** Same rule as the seed scripts: DEMO_USER_PASSWORD, or the public demo password documented in the README. */
export function demoPassword(): string {
  return process.env.DEMO_USER_PASSWORD || "StockFlow!2026";
}
