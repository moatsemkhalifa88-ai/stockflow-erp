import "server-only";
import type { TransferStatus } from "@/lib/sales";
import { pageRange } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { num, str, unwrap, unwrapPage, type Page } from "./common";

type OverviewRow = Views<"stock_transfer_overview">;

export interface TransferSummary {
  id: string;
  transferNumber: string;
  status: TransferStatus;
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  destinationId: string;
  destinationCode: string;
  destinationName: string;
  notes: string | null;
  lineCount: number;
  totalQuantity: number;
  totalValue: number;
  requestedByName: string | null;
  requestedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  executedByName: string | null;
  executedAt: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

function toSummary(r: OverviewRow): TransferSummary {
  return {
    id: str(r.id),
    transferNumber: str(r.transfer_number),
    status: r.status ?? "REQUESTED",
    sourceId: str(r.source_warehouse_id),
    sourceCode: str(r.source_code),
    sourceName: str(r.source_name),
    destinationId: str(r.destination_warehouse_id),
    destinationCode: str(r.destination_code),
    destinationName: str(r.destination_name),
    notes: r.notes,
    lineCount: num(r.line_count),
    totalQuantity: num(r.total_quantity),
    totalValue: num(r.total_value),
    requestedByName: r.requested_by_name,
    requestedAt: str(r.requested_at),
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at,
    executedByName: r.executed_by_name,
    executedAt: r.executed_at,
    rejectedByName: r.rejected_by_name,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    cancelledByName: r.cancelled_by_name,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

export interface TransferFilters {
  q: string;
  status?: TransferStatus;
  warehouseId?: string;
  page: number;
}

export async function listTransfers(filters: TransferFilters): Promise<Page<TransferSummary>> {
  const supabase = await createClient();
  let query = supabase.from("stock_transfer_overview").select("*", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.warehouseId) {
    query = query.or(`source_warehouse_id.eq.${filters.warehouseId},destination_warehouse_id.eq.${filters.warehouseId}`);
  }
  if (filters.q) query = query.ilike("transfer_number", `%${filters.q}%`);

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order("requested_at", { ascending: false })
    .order("transfer_number", { ascending: false })
    .range(from, to);
  const page = unwrapPage(result, "stock transfers");
  return { rows: page.rows.map(toSummary), total: page.total };
}

export async function getTransfer(id: string): Promise<TransferSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("stock_transfer_overview").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load transfer: ${result.error.message}`);
  return result.data ? toSummary(result.data) : null;
}

export interface TransferLine {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  /** Current stock at the source (for the "can we execute?" check). */
  availableAtSource: number;
}

export async function getTransferLines(transferId: string, sourceWarehouseId: string): Promise<TransferLine[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("stock_transfer_items")
      .select("id, product_id, quantity, product:products(sku, name, unit_of_measure)")
      .eq("stock_transfer_id", transferId),
    "transfer lines",
  );
  const stock = unwrap(
    await supabase
      .from("inventory")
      .select("product_id, quantity")
      .eq("warehouse_id", sourceWarehouseId)
      .in("product_id", rows.map((r) => r.product_id)),
    "stock",
  );
  const available = new Map(stock.map((s) => [s.product_id, s.quantity]));
  return rows
    .map((r) => ({
      id: r.id,
      productId: r.product_id,
      sku: r.product?.sku ?? "",
      productName: r.product?.name ?? "",
      unitOfMeasure: r.product?.unit_of_measure ?? "",
      quantity: r.quantity,
      availableAtSource: available.get(r.product_id) ?? 0,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}
