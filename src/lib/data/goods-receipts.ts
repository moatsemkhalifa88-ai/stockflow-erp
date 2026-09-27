import "server-only";
import { pageRange } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { businessDayRange } from "@/lib/format";
import { num, str, unwrap, unwrapPage, type Page } from "./common";

type OverviewRow = Views<"goods_receipt_overview">;

export interface GoodsReceiptSummary {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  receivedAt: string;
  receivedByName: string | null;
  notes: string | null;
  lineCount: number;
  totalQuantity: number;
  totalValue: number;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

function toSummary(r: OverviewRow): GoodsReceiptSummary {
  return {
    id: str(r.id),
    receiptNumber: str(r.receipt_number),
    purchaseOrderId: str(r.purchase_order_id),
    poNumber: str(r.po_number),
    supplierId: str(r.supplier_id),
    supplierName: str(r.supplier_name),
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    warehouseName: str(r.warehouse_name),
    receivedAt: str(r.received_at),
    receivedByName: r.received_by_name,
    notes: r.notes,
    lineCount: num(r.line_count),
    totalQuantity: num(r.total_quantity),
    totalValue: num(r.total_value),
    reversedAt: r.reversed_at,
    reversedByName: r.reversed_by_name,
    reversalReason: r.reversal_reason,
  };
}

export interface GoodsReceiptFilters {
  q: string;
  warehouseId?: string;
  supplierId?: string;
  from?: string;
  to?: string;
  page: number;
}

export async function listGoodsReceipts(filters: GoodsReceiptFilters): Promise<Page<GoodsReceiptSummary>> {
  const supabase = await createClient();
  let query = supabase.from("goods_receipt_overview").select("*", { count: "exact" });

  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.from) query = query.gte("received_at", businessDayRange(filters.from).start);
  if (filters.to) query = query.lte("received_at", businessDayRange(filters.to).end);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`receipt_number.ilike.${term},po_number.ilike.${term},supplier_name.ilike.${term}`);
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order("received_at", { ascending: false })
    .order("receipt_number", { ascending: false })
    .range(from, to);
  const page = unwrapPage(result, "goods receipts");
  return { rows: page.rows.map(toSummary), total: page.total };
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceiptSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("goods_receipt_overview").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load goods receipt: ${result.error.message}`);
  return result.data ? toSummary(result.data) : null;
}

export async function getReceiptsForPurchaseOrder(poId: string): Promise<GoodsReceiptSummary[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("goods_receipt_overview")
      .select("*")
      .eq("purchase_order_id", poId)
      .order("received_at", { ascending: false }),
    "goods receipts",
  );
  return rows.map(toSummary);
}

export interface GoodsReceiptLine {
  id: string;
  lineNumber: number;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  movementId: string | null;
  movementNumber: string | null;
}

export async function getGoodsReceiptLines(receiptId: string): Promise<GoodsReceiptLine[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("goods_receipt_items")
      .select(
        "id, product_id, quantity_received, unit_cost, stock_movement_id, product:products(sku, name), line:purchase_order_items(line_number), movement:stock_movements(movement_number)",
      )
      .eq("goods_receipt_id", receiptId),
    "goods receipt lines",
  );
  return rows
    .map((r) => ({
      id: r.id,
      lineNumber: r.line?.line_number ?? 0,
      productId: r.product_id,
      sku: r.product?.sku ?? "",
      productName: r.product?.name ?? "",
      quantity: r.quantity_received,
      unitCost: r.unit_cost,
      movementId: r.stock_movement_id,
      movementNumber: r.movement?.movement_number ?? null,
    }))
    .sort((a, b) => a.lineNumber - b.lineNumber);
}

/** The goods receipt a stock movement belongs to, for links from the ledger. */
export async function getReceiptForMovement(movementId: string): Promise<{ id: string; receiptNumber: string } | null> {
  const supabase = await createClient();
  const result = await supabase
    .from("goods_receipt_items")
    .select("goods_receipt:goods_receipts(id, receipt_number)")
    .eq("stock_movement_id", movementId)
    .maybeSingle();
  if (result.error) throw new Error(`Failed to load goods receipt: ${result.error.message}`);
  const receipt = result.data?.goods_receipt;
  return receipt ? { id: receipt.id, receiptNumber: receipt.receipt_number } : null;
}
