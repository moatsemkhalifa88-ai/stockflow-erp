import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isAppRole, type AppRole } from "./roles";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  roleName: string;
  isActive: boolean;
}

export type SessionState =
  | { status: "anonymous" }
  | { status: "no_profile"; email: string }
  | { status: "inactive"; user: CurrentUser }
  | { status: "active"; user: CurrentUser };

/**
 * Resolves the signed-in user and their profile/role once per request.
 * The JWT is verified with getClaims(); the role always comes from the database.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claimsError || !claims?.sub) return { status: "anonymous" };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_active, role:roles!inner(code, name)")
    .eq("id", claims.sub)
    .maybeSingle();

  if (error) throw new Error(`Could not load user profile: ${error.message}`);
  if (!profile || !isAppRole(profile.role.code)) {
    return { status: "no_profile", email: typeof claims.email === "string" ? claims.email : "" };
  }

  const user: CurrentUser = {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name || profile.email,
    role: profile.role.code,
    roleName: profile.role.name,
    isActive: profile.is_active,
  };

  return user.isActive ? { status: "active", user } : { status: "inactive", user };
});

/** The signed-in, active user, or null. Server Actions must check this themselves. */
export async function getActiveUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  return session.status === "active" ? session.user : null;
}
