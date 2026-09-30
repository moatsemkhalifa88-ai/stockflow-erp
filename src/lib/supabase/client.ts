import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/env";
import type { Database } from "@/types/database";
import { withClockSkewRetry } from "./clock-skew-fetch";

/** Supabase client for Client Components. */
export function createClient() {
  const { url, key } = getSupabaseEnv();
  return createBrowserClient<Database>(url, key, { global: { fetch: withClockSkewRetry() } });
}
