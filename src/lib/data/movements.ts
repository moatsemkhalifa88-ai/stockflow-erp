import "server-only";
import { businessDayRange } from "@/lib/format";
import type { MovementType } from "@/lib/inventory";
import { pageRange } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { num, str, unwrap, unwrapPage, type Page } from "./common";

type LedgerRow = Views<"stock_movement_ledger">;

export interface Movement {
  id: string;
  movementNumber: string;
  movementType: MovementType;
  quantity: number;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost: number;
  movementValue: number;
  productId: string;
  sku: string;
  productName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  reversalOfId: string | null;
  reversalOfNumber: string | null;
  reversedById: string | null;
  reversedByNumber: string | null;
  reason: string | null;
  notes: string | null;
  performedByName: string | null;
  movementDate: string;
  createdAt: string;
}

function toMovement(r: LedgerRow): Movement {
  return {
    id: str(r.id),
    movementNumber: str(r.movement_number),
    movementType: r.movement_type ?? "ADJUSTMENT_IN",
    quantity: num(r.quantity),
    quantityChange: num(r.quantity_change),
    quantityBefore: num(r.quantity_before),
    quantityAfter: num(r.quantity_after),
    unitCost: num(r.unit_cost),
    movementValue: num(r.movement_value),
    productId: str(r.product_id),
    sku: str(r.sku),
    productName: str(r.product_name),
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    warehouseName: str(r.warehouse_name),
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    referenceNumber: r.reference_number,
    reversalOfId: r.reversal_of_id,
    reversalOfNumber: r.reversal_of_number,
    reversedById: r.reversed_by_id,
    reversedByNumber: r.reversed_by_number,
    reason: r.reason,
    notes: r.notes,
    performedByName: r.performed_by_name,
    movementDate: str(r.movement_date),
    createdAt: str(r.created_at),
  };
}

export interface MovementFilters {
  q: string;
  type?: MovementType;
  warehouseId?: string;
  productId?: string;
  from?: string;
  to?: string;
  page: number;
}

export async function listMovements(filters: MovementFilters): Promise<Page<Movement>> {
  const supabase = await createClient();
  let query = supabase.from("stock_movement_ledger").select("*", { count: "exact" });

  if (filters.type) query = query.eq("movement_type", filters.type);
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.productId) query = query.eq("product_id", filters.productId);
  // Dates are whole days in business time (Asia/Jerusalem, DST-aware).
  if (filters.from) query = query.gte("movement_date", businessDayRange(filters.from).start);
  if (filters.to) query = query.lte("movement_date", businessDayRange(filters.to).end);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(
      `movement_number.ilike.${term},sku.ilike.${term},product_name.ilike.${term},reference_number.ilike.${term}`,
    );
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order("movement_date", { ascending: false })
    .order("movement_number", { ascending: false })
    .range(from, to);
  const page = unwrapPage(result, "stock movements");
  return { rows: page.rows.map(toMovement), total: page.total };
}

export async function getMovement(id: string): Promise<Movement | null> {
  const supabase = await createClient();
  const result = await supabase.from("stock_movement_ledger").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load movement: ${result.error.message}`);
  return result.data ? toMovement(result.data) : null;
}

export async function getRecentMovements(
  scope: { productId: string } | { warehouseId: string },
  limit = 10,
): Promise<Movement[]> {
  const supabase = await createClient();
  let query = supabase.from("stock_movement_ledger").select("*");
  query = "productId" in scope ? query.eq("product_id", scope.productId) : query.eq("warehouse_id", scope.warehouseId);
  const rows = unwrap(
    await query.order("movement_date", { ascending: false }).order("movement_number", { ascending: false }).limit(limit),
    "recent movements",
  );
  return rows.map(toMovement);
}
