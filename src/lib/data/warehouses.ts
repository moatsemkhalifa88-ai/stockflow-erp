import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/types/database";
import { num, str, unwrap } from "./common";

type SummaryRow = Views<"warehouse_stock_summary">;

export interface WarehouseSummary {
  id: string;
  code: string;
  name: string;
  warehouseType: string;
  city: string;
  isActive: boolean;
  managerName: string | null;
  productCount: number;
  totalQuantity: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

function toWarehouseSummary(r: SummaryRow): WarehouseSummary {
  return {
    id: str(r.warehouse_id),
    code: str(r.code),
    name: str(r.name),
    warehouseType: str(r.warehouse_type),
    city: str(r.city),
    isActive: r.is_active ?? false,
    managerName: r.manager_name,
    productCount: num(r.product_count),
    totalQuantity: num(r.total_quantity),
    inventoryValue: num(r.inventory_value),
    lowStockCount: num(r.low_stock_count),
    outOfStockCount: num(r.out_of_stock_count),
  };
}

export async function listWarehouseSummaries(): Promise<WarehouseSummary[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("warehouse_stock_summary").select("*").order("is_active", { ascending: false }).order("code"),
    "warehouses",
  );
  return rows.map(toWarehouseSummary);
}

export async function getWarehouseSummary(id: string): Promise<WarehouseSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("warehouse_stock_summary").select("*").eq("warehouse_id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load warehouse: ${result.error.message}`);
  return result.data ? toWarehouseSummary(result.data) : null;
}

export type WarehouseRecord = Tables<"warehouses">;

export async function getWarehouse(id: string): Promise<WarehouseRecord | null> {
  const supabase = await createClient();
  const result = await supabase.from("warehouses").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load warehouse: ${result.error.message}`);
  return result.data;
}

/** Company-wide totals, for the dashboard and inventory page headers. */
export function totalsOf(warehouses: WarehouseSummary[]) {
  return warehouses.reduce(
    (acc, w) => ({
      totalQuantity: acc.totalQuantity + w.totalQuantity,
      inventoryValue: acc.inventoryValue + w.inventoryValue,
      lowStockCount: acc.lowStockCount + w.lowStockCount,
      outOfStockCount: acc.outOfStockCount + w.outOfStockCount,
    }),
    { totalQuantity: 0, inventoryValue: 0, lowStockCount: 0, outOfStockCount: 0 },
  );
}
