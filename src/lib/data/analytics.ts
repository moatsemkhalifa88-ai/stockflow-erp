import "server-only";
import type { Bucket, DateRange } from "@/lib/date-range";
import type { MovementType } from "@/lib/inventory";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { num, str, unwrap } from "./common";

/*
 * Dashboard and alert data. Every number comes from the SQL functions and v_*
 * views of migration 14, which the reports and BI tools use as well.
 */

export interface DashboardKpis {
  totalProducts: number;
  inventoryValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  pendingPurchaseOrders: number;
  pendingSalesOrders: number;
  movementsToday: number;
  purchasesMonth: number;
  salesMonth: number;
  monthStart: string;
  today: string;
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("dashboard_kpis"), "dashboard KPIs");
  const r = rows[0];
  if (!r) throw new Error("Failed to load dashboard KPIs: no data returned");
  return {
    totalProducts: r.total_products,
    inventoryValue: r.inventory_value,
    lowStockItems: r.low_stock_items,
    outOfStockItems: r.out_of_stock_items,
    pendingPurchaseOrders: r.pending_purchase_orders,
    pendingSalesOrders: r.pending_sales_orders,
    movementsToday: r.movements_today,
    purchasesMonth: r.purchases_month,
    salesMonth: r.sales_month,
    monthStart: r.month_start,
    today: r.business_today,
  };
}

export interface PurchasesSalesPoint {
  bucketStart: string;
  purchases: number;
  sales: number;
}

export async function getPurchasesVsSales(range: DateRange, bucket: Bucket): Promise<PurchasesSalesPoint[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.rpc("purchases_vs_sales", { p_from: range.from, p_to: range.to, p_bucket: bucket }),
    "purchases vs sales",
  );
  return rows.map((r) => ({ bucketStart: r.bucket_start, purchases: r.purchases, sales: r.sales }));
}

export interface ProductMovement {
  productId: string;
  sku: string;
  productName: string;
  unitsIn: number;
  unitsOut: number;
  unitsMoved: number;
  movementCount: number;
}

export async function getTopProductsByMovement(range: DateRange, limit = 10): Promise<ProductMovement[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.rpc("top_products_by_movement", { p_from: range.from, p_to: range.to, p_limit: limit }),
    "top products",
  );
  return rows.map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    productName: r.product_name,
    unitsIn: r.units_in,
    unitsOut: r.units_out,
    unitsMoved: r.units_moved,
    movementCount: r.movement_count,
  }));
}

export interface MovementTypeTotal {
  movementType: MovementType;
  movementCount: number;
  units: number;
  value: number;
}

export async function getMovementsByType(range: DateRange): Promise<MovementTypeTotal[]> {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("movements_by_type", { p_from: range.from, p_to: range.to }), "movements by type");
  return rows.map((r) => ({ movementType: r.movement_type, movementCount: r.movement_count, units: r.units, value: r.value }));
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export const ALERT_TYPES = ["OUT_OF_STOCK", "LOW_STOCK", "DELAYED_PO", "UNPROCESSED_SO", "PENDING_PO_APPROVAL", "PENDING_TRANSFER"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_SEVERITIES = ["critical", "warning", "info"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  entityType: string;
  entityId: string;
  reference: string;
  title: string;
  detail: string;
  warehouseId: string;
  warehouseCode: string;
  sinceDate: string | null;
  daysOpen: number;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function isAlertType(value: string | null): value is AlertType {
  return value !== null && (ALERT_TYPES as readonly string[]).includes(value);
}

function toAlert(r: Views<"v_alerts">): Alert | null {
  if (!isAlertType(r.alert_type)) return null;
  const severity = (ALERT_SEVERITIES as readonly string[]).includes(r.severity ?? "") ? (r.severity as AlertSeverity) : "info";
  return {
    type: r.alert_type,
    severity,
    entityType: str(r.entity_type),
    entityId: str(r.entity_id),
    reference: str(r.reference),
    title: str(r.title),
    detail: str(r.detail),
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    sinceDate: r.since_date,
    daysOpen: num(r.days_open),
  };
}

/** All current alerts, most severe and oldest first. */
export async function getAlerts(): Promise<Alert[]> {
  const supabase = await createClient();
  const rows = unwrap(await supabase.from("v_alerts").select("*").limit(1000), "alerts");
  return rows
    .map(toAlert)
    .filter((a): a is Alert => a !== null)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        ALERT_TYPES.indexOf(a.type) - ALERT_TYPES.indexOf(b.type) ||
        b.daysOpen - a.daysOpen ||
        a.reference.localeCompare(b.reference),
    );
}

export function countByType(alerts: Alert[]): Record<AlertType, number> {
  const counts = Object.fromEntries(ALERT_TYPES.map((t) => [t, 0])) as Record<AlertType, number>;
  for (const a of alerts) counts[a.type] += 1;
  return counts;
}
