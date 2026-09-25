import "server-only";
import { toStockStatus, type StockStatus } from "@/lib/inventory";
import { pageRange, type SortState } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { num, str, unwrap, unwrapPage, type Page } from "./common";

type ValuationRow = Views<"inventory_valuation">;

/** One product in one warehouse, valued through the inventory_valuation view. */
export interface InventoryLine {
  inventoryId: string;
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
  costPrice: number;
  inventoryValue: number;
  stockStatus: StockStatus;
  productIsActive: boolean;
  lastMovementAt: string | null;
}

export function toInventoryLine(r: ValuationRow): InventoryLine {
  return {
    inventoryId: str(r.inventory_id),
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
    costPrice: num(r.cost_price),
    inventoryValue: num(r.inventory_value),
    stockStatus: toStockStatus(r.stock_status),
    productIsActive: r.product_is_active ?? false,
    lastMovementAt: r.last_movement_at,
  };
}

export const INVENTORY_SORT_COLUMNS = ["sku", "product_name", "warehouse_code", "quantity", "inventory_value"] as const;
export type InventorySortColumn = (typeof INVENTORY_SORT_COLUMNS)[number];

export interface InventoryFilters {
  q: string;
  warehouseId?: string;
  categoryId?: string;
  status?: StockStatus;
  sort: SortState<InventorySortColumn>;
  page: number;
}

export async function listInventory(filters: InventoryFilters): Promise<Page<InventoryLine>> {
  const supabase = await createClient();
  let query = supabase.from("inventory_valuation").select("*", { count: "exact" });

  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.status) query = query.eq("stock_status", filters.status);
  if (filters.q) query = query.or(`sku.ilike.%${filters.q}%,product_name.ilike.%${filters.q}%`);

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order(filters.sort.column, { ascending: filters.sort.ascending })
    .order("sku")
    .order("warehouse_code")
    .range(from, to);
  const page = unwrapPage(result, "inventory");
  return { rows: page.rows.map(toInventoryLine), total: page.total };
}

export interface InventoryTotals {
  lineCount: number;
  totalQuantity: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

/**
 * Totals for exactly the rows listInventory returns (same warehouse, category,
 * status and search filters, all pages), summed in the database.
 */
export async function getInventoryTotals(filters: Omit<InventoryFilters, "sort" | "page">): Promise<InventoryTotals> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.rpc("inventory_totals", {
      p_warehouse_id: filters.warehouseId,
      p_category_id: filters.categoryId,
      p_stock_status: filters.status,
      p_search: filters.q || undefined,
    }),
    "inventory totals",
  );
  const r = rows[0];
  return {
    lineCount: num(r?.line_count),
    totalQuantity: num(r?.total_quantity),
    inventoryValue: num(r?.inventory_value),
    lowStockCount: num(r?.low_stock_count),
    outOfStockCount: num(r?.out_of_stock_count),
  };
}

export async function getStockByWarehouse(productId: string): Promise<InventoryLine[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("inventory_valuation").select("*").eq("product_id", productId).order("warehouse_code"),
    "stock by warehouse",
  );
  return rows.map(toInventoryLine);
}

/** Active products at or below their minimum in a warehouse, most urgent first. */
export async function getLowStockLines(warehouseId: string, limit = 50): Promise<InventoryLine[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("inventory_valuation")
      .select("*")
      .eq("warehouse_id", warehouseId)
      .eq("product_is_active", true)
      .in("stock_status", ["LOW_STOCK", "OUT_OF_STOCK"])
      .order("quantity")
      .order("sku")
      .limit(limit),
    "low-stock items",
  );
  return rows.map(toInventoryLine);
}
