import "server-only";
import type { MovementType } from "@/lib/inventory";
import { toStockStatus, type StockStatus } from "@/lib/inventory";
import { pageRange } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { fetchAllPages, num, str, unwrap, unwrapPage, type Page } from "./common";

/*
 * Report data. Each report reads the same v_* view / function for the screen
 * and for the CSV export, so the file always matches what was on screen.
 */

// ---------------------------------------------------------------------------
// Inventory valuation (as of a date)
// ---------------------------------------------------------------------------
export interface ValuationFilters {
  asOf: string;
  warehouseId?: string;
  categoryId?: string;
}

export interface ValuationLine {
  productId: string;
  sku: string;
  productName: string;
  categoryName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
  costPrice: number;
  inventoryValue: number;
}

function valuationQuery(supabase: Awaited<ReturnType<typeof createClient>>, f: ValuationFilters) {
  return supabase.rpc("inventory_valuation_as_of", {
    p_as_of: f.asOf,
    p_warehouse_id: f.warehouseId,
    p_category_id: f.categoryId,
  });
}

export async function getValuationReport(f: ValuationFilters): Promise<ValuationLine[]> {
  const supabase = await createClient();
  const rows = await fetchAllPages((from, to) => valuationQuery(supabase, f).range(from, to), "inventory valuation");
  return rows.map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    productName: r.product_name,
    categoryName: r.category_name,
    warehouseId: r.warehouse_id,
    warehouseCode: r.warehouse_code,
    warehouseName: r.warehouse_name,
    quantity: r.quantity,
    costPrice: r.cost_price,
    inventoryValue: r.inventory_value,
  }));
}

// ---------------------------------------------------------------------------
// Stock movements (date range)
// ---------------------------------------------------------------------------
export interface MovementReportFilters {
  from: string;
  to: string;
  warehouseId?: string;
  categoryId?: string;
  movementType?: MovementType;
}

export interface MovementReportLine {
  movementId: string;
  movementNumber: string;
  businessDate: string;
  movementType: MovementType;
  isReversal: boolean;
  referenceType: string | null;
  referenceNumber: string | null;
  sku: string;
  productName: string;
  categoryName: string;
  warehouseCode: string;
  quantityChange: number;
  unitCost: number;
  valueChange: number;
  reason: string | null;
  performedByName: string | null;
}

type MovementRow = Views<"v_stock_movements">;

function toMovementLine(r: MovementRow): MovementReportLine {
  return {
    movementId: str(r.movement_id),
    movementNumber: str(r.movement_number),
    businessDate: str(r.business_date),
    movementType: r.movement_type ?? "ADJUSTMENT_IN",
    isReversal: r.is_reversal ?? false,
    referenceType: r.reference_type,
    referenceNumber: r.reference_number,
    sku: str(r.sku),
    productName: str(r.product_name),
    categoryName: str(r.category_name),
    warehouseCode: str(r.warehouse_code),
    quantityChange: num(r.quantity_change),
    unitCost: num(r.unit_cost),
    valueChange: num(r.value_change),
    reason: r.reason,
    performedByName: r.performed_by_name,
  };
}

function movementQuery(supabase: Awaited<ReturnType<typeof createClient>>, f: MovementReportFilters, count: boolean) {
  let query = supabase
    .from("v_stock_movements")
    .select("*", count ? { count: "exact" } : undefined)
    .gte("business_date", f.from)
    .lte("business_date", f.to);
  if (f.warehouseId) query = query.eq("warehouse_id", f.warehouseId);
  if (f.categoryId) query = query.eq("category_id", f.categoryId);
  if (f.movementType) query = query.eq("movement_type", f.movementType);
  return query.order("movement_date", { ascending: false }).order("movement_number", { ascending: false });
}

export async function getMovementReportPage(f: MovementReportFilters, page: number, pageSize: number): Promise<Page<MovementReportLine>> {
  const supabase = await createClient();
  const { from, to } = pageRange(page, pageSize);
  const result = await movementQuery(supabase, f, true).range(from, to);
  const rows = unwrapPage(result, "stock movement report");
  return { rows: rows.rows.map(toMovementLine), total: rows.total };
}

export async function getMovementReportAll(f: MovementReportFilters): Promise<MovementReportLine[]> {
  const supabase = await createClient();
  const rows = await fetchAllPages((from, to) => movementQuery(supabase, f, false).range(from, to), "stock movement report");
  return rows.map(toMovementLine);
}

export interface MovementReportTotals {
  movementCount: number;
  unitsIn: number;
  unitsOut: number;
  valueIn: number;
  valueOut: number;
}

export async function getMovementReportTotals(f: MovementReportFilters): Promise<MovementReportTotals> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.rpc("movement_report_totals", {
      p_from: f.from,
      p_to: f.to,
      p_warehouse_id: f.warehouseId,
      p_category_id: f.categoryId,
      p_movement_type: f.movementType,
    }),
    "movement totals",
  );
  const r = rows[0];
  return {
    movementCount: r?.movement_count ?? 0,
    unitsIn: r?.units_in ?? 0,
    unitsOut: r?.units_out ?? 0,
    valueIn: r?.value_in ?? 0,
    valueOut: r?.value_out ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Low stock (current)
// ---------------------------------------------------------------------------
export interface LowStockFilters {
  warehouseId?: string;
  categoryId?: string;
  status?: Extract<StockStatus, "LOW_STOCK" | "OUT_OF_STOCK">;
}

export interface LowStockLine {
  productId: string;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  categoryName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
  minStockLevel: number;
  shortfall: number;
  suggestedOrderQuantity: number;
  suggestedOrderValue: number;
  costPrice: number;
  stockStatus: StockStatus;
  lastMovementAt: string | null;
}

function toLowStockLine(r: Views<"v_low_stock">): LowStockLine {
  return {
    productId: str(r.product_id),
    sku: str(r.sku),
    productName: str(r.product_name),
    unitOfMeasure: str(r.unit_of_measure),
    categoryName: str(r.category_name),
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    warehouseName: str(r.warehouse_name),
    quantity: num(r.quantity),
    minStockLevel: num(r.min_stock_level),
    shortfall: num(r.shortfall),
    suggestedOrderQuantity: num(r.suggested_order_quantity),
    suggestedOrderValue: num(r.suggested_order_value),
    costPrice: num(r.cost_price),
    stockStatus: toStockStatus(r.stock_status),
    lastMovementAt: r.last_movement_at,
  };
}

/** Out of stock first, then by how far below the minimum (as a share of it). */
export async function getLowStockReport(f: LowStockFilters): Promise<LowStockLine[]> {
  const supabase = await createClient();
  const rows = await fetchAllPages((from, to) => {
    let query = supabase.from("v_low_stock").select("*");
    if (f.warehouseId) query = query.eq("warehouse_id", f.warehouseId);
    if (f.categoryId) query = query.eq("category_id", f.categoryId);
    if (f.status) query = query.eq("stock_status", f.status);
    return query.order("quantity").order("sku").order("warehouse_code").range(from, to);
  }, "low stock report");
  const coverage = (l: LowStockLine) => (l.minStockLevel > 0 ? l.quantity / l.minStockLevel : 0);
  return rows
    .map(toLowStockLine)
    .sort((a, b) => coverage(a) - coverage(b) || b.shortfall - a.shortfall || a.sku.localeCompare(b.sku));
}
