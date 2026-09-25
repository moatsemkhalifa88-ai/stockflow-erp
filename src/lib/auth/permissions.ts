import type { AppRole } from "./roles";

/**
 * UI-level permissions. They decide which buttons are shown; the database
 * (RLS policies and the RPC role checks) is what actually enforces them.
 */

/** Mirrors the products insert/update RLS policies. */
export function canManageProducts(role: AppRole): boolean {
  return role === "admin" || role === "warehouse_manager";
}

/** Mirrors the warehouses insert/update RLS policies (migration 0800). */
export function canManageWarehouses(role: AppRole): boolean {
  return role === "admin" || role === "warehouse_manager";
}

/** Mirrors private.assert_can_move_stock(). */
export function canMoveStock(role: AppRole): boolean {
  return role === "admin" || role === "warehouse_manager";
}
