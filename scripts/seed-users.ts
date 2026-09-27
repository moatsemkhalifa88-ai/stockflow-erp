/**
 * Creates (or updates) the demo login accounts through the Supabase Auth Admin API.
 * The on_auth_user_created trigger creates each profile with the role from app_metadata.
 *
 * Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only secret).
 * Optional: DEMO_USER_PASSWORD (defaults to the value documented in the README).
 *
 * Usage: npm run seed:users
 */
import { createClient, type User } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database } from "../src/types/database";

config({ path: ".env.local" });
config();

type DemoRole = "admin" | "warehouse_manager" | "purchasing" | "sales";

interface DemoUser {
  email: string;
  fullName: string;
  role: DemoRole;
  /** Warehouse codes this person manages. */
  manages: string[];
}

const DEMO_USERS: DemoUser[] = [
  { email: "admin@stockflow.example", fullName: "Maya Cohen", role: "admin", manages: [] },
  { email: "manager.tlv@stockflow.example", fullName: "Eitan Levi", role: "warehouse_manager", manages: ["WH-TLV", "WH-ASH"] },
  { email: "manager.hfa@stockflow.example", fullName: "Noa Ben-Ami", role: "warehouse_manager", manages: ["WH-HFA", "WH-JLM", "WH-BSV"] },
  { email: "purchasing@stockflow.example", fullName: "Dana Mizrahi", role: "purchasing", manages: [] },
  { email: "sales@stockflow.example", fullName: "Omer Shalev", role: "sales", manages: [] },
];

function requireEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) {
    throw new Error(`Missing ${name}${fallbackName ? ` (or ${fallbackName})` : ""}. Add it to .env.local.`);
  }
  return value;
}

async function findUserByEmail(
  supabase: ReturnType<typeof createClient<Database>>,
  email: string,
): Promise<User | undefined> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match || data.users.length < 200) return match;
  }
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
  const password = process.env.DEMO_USER_PASSWORD || "StockFlow!2026";

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: roles, error: rolesError } = await supabase.from("roles").select("id, code");
  if (rolesError) throw new Error(`Could not read roles - did you apply the migrations? ${rolesError.message}`);

  for (const demo of DEMO_USERS) {
    const attributes = {
      password,
      email_confirm: true,
      app_metadata: { role: demo.role },
      user_metadata: { full_name: demo.fullName },
    };

    const existing = await findUserByEmail(supabase, demo.email);
    const result = existing
      ? await supabase.auth.admin.updateUserById(existing.id, attributes)
      : await supabase.auth.admin.createUser({ email: demo.email, ...attributes });
    if (result.error) throw new Error(`${demo.email}: ${result.error.message}`);
    const userId = result.data.user.id;

    // Keep the profile in sync when the user already existed.
    const roleId = roles.find((r) => r.code === demo.role)?.id;
    if (roleId === undefined) throw new Error(`Role ${demo.role} not found`);
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ full_name: demo.fullName, role_id: roleId, is_active: true })
      .eq("id", userId);
    if (profileError) throw new Error(`${demo.email} profile: ${profileError.message}`);

    if (demo.manages.length > 0) {
      const { error: whError } = await supabase.from("warehouses").update({ manager_id: userId }).in("code", demo.manages);
      if (whError) throw new Error(`${demo.email} warehouses: ${whError.message}`);
    }

    console.log(`${existing ? "updated" : "created"}  ${demo.email.padEnd(32)} ${demo.role}`);
  }

  console.log(`\nDemo users ready. Password: ${process.env.DEMO_USER_PASSWORD ? "(from DEMO_USER_PASSWORD)" : password}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
