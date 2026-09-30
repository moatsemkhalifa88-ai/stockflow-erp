import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNT_KEYS, DEMO_ACCOUNTS, isDemoAccountKey } from "@/lib/auth/demo-accounts";
import { DEMO_ACCOUNT_EMAILS } from "@/lib/auth/demo-credentials";

/** The accounts `npm run seed:users` creates, read from the seed script itself. */
function seededUsers(): Map<string, { name: string; role: string }> {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../scripts/seed-users.ts"), "utf8");
  const users = new Map<string, { name: string; role: string }>();
  for (const m of source.matchAll(/email: "([^"]+)", fullName: "([^"]+)", role: "([^"]+)"/g)) users.set(m[1], { name: m[2], role: m[3] });
  return users;
}

describe("demo accounts on the sign-in screen", () => {
  it("offers each key exactly once", () => {
    expect(DEMO_ACCOUNTS.map((a) => a.key).sort()).toEqual([...DEMO_ACCOUNT_KEYS].sort());
  });

  it("matches the seeded users: same email, name and role", () => {
    const seeded = seededUsers();
    expect(seeded.size).toBe(DEMO_ACCOUNTS.length);
    for (const account of DEMO_ACCOUNTS) {
      expect(seeded.get(DEMO_ACCOUNT_EMAILS[account.key]), account.key).toEqual({ name: account.name, role: account.role });
    }
  });

  it("keeps sign-in details out of the data sent to the browser", () => {
    const clientData = JSON.stringify(DEMO_ACCOUNTS);
    expect(clientData).not.toContain("@");
    expect(clientData).not.toContain("StockFlow!");
  });

  it("accepts only known keys from the browser", () => {
    expect(isDemoAccountKey("admin")).toBe(true);
    for (const bad of ["root", "", "admin@stockflow.example", null, 1, ["admin"]]) expect(isDemoAccountKey(bad)).toBe(false);
  });
});
