import "server-only";
import { toStockStatus, type StockStatus } from "@/lib/inventory";
import { pageRange, type SortState } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/types/database";
import { num, str, unwrapPage, type Page } from "./common";

type SummaryRow = Views<"product_stock_summary">;

/** A product with its stock totals across all warehouses. */
export interface ProductSummary {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  unitOfMeasure: string;
  categoryId: string;
  categoryName: string;
  costPrice: number;
  salePrice: number;
  minStockLevel: number;
  reorderQuantity: number;
  isActive: boolean;
  totalQuantity: number;
  inventoryValue: number;
  warehouseCount: number;
  stockStatus: StockStatus;
}

function toProductSummary(r: SummaryRow): ProductSummary {
  return {
    id: str(r.product_id),
    sku: str(r.sku),
    name: str(r.name),
    barcode: r.barcode,
    unitOfMeasure: str(r.unit_of_measure),
    categoryId: str(r.category_id),
    categoryName: str(r.category_name),
    costPrice: num(r.cost_price),
    salePrice: num(r.sale_price),
    minStockLevel: num(r.min_stock_level),
    reorderQuantity: num(r.reorder_quantity),
    isActive: r.is_active ?? false,
    totalQuantity: num(r.total_quantity),
    inventoryValue: num(r.inventory_value),
    warehouseCount: num(r.warehouse_count),
    stockStatus: toStockStatus(r.stock_status),
  };
}

export const PRODUCT_SORT_COLUMNS = [
  "sku",
  "name",
  "category_name",
  "cost_price",
  "sale_price",
  "total_quantity",
  "inventory_value",
] as const;
export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number];

export const PRODUCT_ACTIVITY_FILTERS = ["active", "inactive", "all"] as const;
export type ProductActivityFilter = (typeof PRODUCT_ACTIVITY_FILTERS)[number];

export interface ProductFilters {
  q: string;
  categoryId?: string;
  activity: ProductActivityFilter;
  stockStatus?: StockStatus;
  sort: SortState<ProductSortColumn>;
  page: number;
}

export async function listProducts(filters: ProductFilters): Promise<Page<ProductSummary>> {
  const supabase = await createClient();
  let query = supabase.from("product_stock_summary").select("*", { count: "exact" });

  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.activity !== "all") query = query.eq("is_active", filters.activity === "active");
  if (filters.stockStatus) query = query.eq("stock_status", filters.stockStatus);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`sku.ilike.${term},name.ilike.${term},barcode.ilike.${term}`);
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order(filters.sort.column, { ascending: filters.sort.ascending })
    .order("sku")
    .range(from, to);
  const page = unwrapPage(result, "products");
  return { rows: page.rows.map(toProductSummary), total: page.total };
}

export async function getProductSummary(id: string): Promise<ProductSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("product_stock_summary").select("*").eq("product_id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load product: ${result.error.message}`);
  return result.data ? toProductSummary(result.data) : null;
}

export type ProductRecord = Tables<"products"> & {
  category: { name: string } | null;
  creator: { full_name: string } | null;
};

/** The full product row, for the detail page and the edit form. */
export async function getProduct(id: string): Promise<ProductRecord | null> {
  const supabase = await createClient();
  const result = await supabase
    .from("products")
    .select("*, category:categories(name), creator:profiles!products_created_by_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(`Failed to load product: ${result.error.message}`);
  return result.data;
}

/** Whether the SKU is locked because stock has already moved (see products_protect_sku trigger). */
export async function hasStockHistory(productId: string): Promise<boolean> {
  const supabase = await createClient();
  const result = await supabase
    .from("stock_movements")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (result.error) throw new Error(`Failed to load product history: ${result.error.message}`);
  return (result.count ?? 0) > 0;
}
