/**
 * Application roles. Mirrors public.roles in the database.
 * Phase 1 ships admin + warehouse_manager; purchasing and sales are added in Phases 3 and 4.
 */
export const APP_ROLES = ["admin", "warehouse_manager", "purchasing", "sales"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  warehouse_manager: "Warehouse Manager",
  purchasing: "Purchasing",
  sales: "Sales",
};

export const ALL_ROLES: readonly AppRole[] = APP_ROLES;

export function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

export function hasRole(role: AppRole, allowed: readonly AppRole[]): boolean {
  return allowed.includes(role);
}
