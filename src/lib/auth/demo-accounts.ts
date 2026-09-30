import type { AppRole } from "./roles";

/**
 * The demo accounts offered on the sign-in screen, as the browser sees them:
 * display data only. The emails and the password stay on the server
 * (demo-credentials.ts); the browser only ever sends back one of these keys.
 */
export const DEMO_ACCOUNT_KEYS = ["admin", "purchasing", "sales", "manager-tlv", "manager-hfa"] as const;

export type DemoAccountKey = (typeof DEMO_ACCOUNT_KEYS)[number];

export interface DemoAccount {
  key: DemoAccountKey;
  name: string;
  role: AppRole;
  /** Second line of the card. Short enough for a half-width card: the role must never be cut off. */
  description: string;
}

/** Display order: admin first (full width), then one card per role. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { key: "admin", name: "Maya Cohen", role: "admin", description: "Administrator · Full access" },
  { key: "purchasing", name: "Dana Mizrahi", role: "purchasing", description: "Purchasing" },
  { key: "sales", name: "Omer Shalev", role: "sales", description: "Sales" },
  { key: "manager-tlv", name: "Eitan Levi", role: "warehouse_manager", description: "Warehouse Manager" },
  { key: "manager-hfa", name: "Noa Ben-Ami", role: "warehouse_manager", description: "Warehouse Manager" },
];

export function isDemoAccountKey(value: unknown): value is DemoAccountKey {
  return typeof value === "string" && (DEMO_ACCOUNT_KEYS as readonly string[]).includes(value);
}
