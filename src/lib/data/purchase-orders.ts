import "server-only";
import type { PurchaseOrderStatus } from "@/lib/purchasing";
import { pageRange, type SortState } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { num, str, unwrap, unwrapPage, type Page } from "./common";

type OverviewRow = Views<"purchase_order_overview">;

export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  totalAmount: number;
  notes: string | null;
  lineCount: number;
  quantityOrdered: number;
  quantityReceived: number;
  receivedValue: number;
  outstandingValue: number;
  createdByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lastReceivedAt: string | null;
  createdAt: string;
}

function toSummary(r: OverviewRow): PurchaseOrderSummary {
  return {
    id: str(r.id),
    poNumber: str(r.po_number),
    status: r.status ?? "DRAFT",
    supplierId: str(r.supplier_id),
    supplierCode: str(r.supplier_code),
    supplierName: str(r.supplier_name),
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    warehouseName: str(r.warehouse_name),
    orderDate: str(r.order_date),
    expectedDeliveryDate: r.expected_delivery_date,
    totalAmount: num(r.total_amount),
    notes: r.notes,
    lineCount: num(r.line_count),
    quantityOrdered: num(r.quantity_ordered),
    quantityReceived: num(r.quantity_received),
    receivedValue: num(r.received_value),
    outstandingValue: num(r.outstanding_value),
    createdByName: r.created_by_name,
    submittedAt: r.submitted_at,
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    lastReceivedAt: r.last_received_at,
    createdAt: str(r.created_at),
  };
}

export const PO_SORT_COLUMNS = ["po_number", "order_date", "expected_delivery_date", "supplier_name", "total_amount"] as const;
export type PurchaseOrderSortColumn = (typeof PO_SORT_COLUMNS)[number];

export interface PurchaseOrderFilters {
  q: string;
  status?: PurchaseOrderStatus;
  /** "open" = submitted, approved or partially received. */
  openOnly: boolean;
  supplierId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  sort: SortState<PurchaseOrderSortColumn>;
  page: number;
}

export async function listPurchaseOrders(filters: PurchaseOrderFilters): Promise<Page<PurchaseOrderSummary>> {
  const supabase = await createClient();
  let query = supabase.from("purchase_order_overview").select("*", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.openOnly) query = query.in("status", ["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"]);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.from) query = query.gte("order_date", filters.from);
  if (filters.to) query = query.lte("order_date", filters.to);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`po_number.ilike.${term},supplier_name.ilike.${term},supplier_code.ilike.${term}`);
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order(filters.sort.column, { ascending: filters.sort.ascending, nullsFirst: false })
    .order("po_number", { ascending: false })
    .range(from, to);
  const page = unwrapPage(result, "purchase orders");
  return { rows: page.rows.map(toSummary), total: page.total };
}

export async function getPurchaseOrderSummary(id: string): Promise<PurchaseOrderSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("purchase_order_overview").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load purchase order: ${result.error.message}`);
  return result.data ? toSummary(result.data) : null;
}

export async function getRecentPurchaseOrders(supplierId: string, limit = 15): Promise<PurchaseOrderSummary[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("purchase_order_overview")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("order_date", { ascending: false })
      .order("po_number", { ascending: false })
      .limit(limit),
    "purchase orders",
  );
  return rows.map(toSummary);
}

export interface PurchaseOrderLine {
  id: string;
  lineNumber: number;
  productId: string;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  quantityReceived: number;
  outstanding: number;
  unitCost: number;
  lineTotal: number;
}

export async function getPurchaseOrderLines(poId: string): Promise<PurchaseOrderLine[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("purchase_order_items")
      .select("id, line_number, product_id, quantity_ordered, quantity_received, unit_cost, line_total, product:products(sku, name, unit_of_measure)")
      .eq("purchase_order_id", poId)
      .order("line_number"),
    "purchase order lines",
  );
  return rows.map((r) => ({
    id: r.id,
    lineNumber: r.line_number,
    productId: r.product_id,
    sku: r.product?.sku ?? "",
    productName: r.product?.name ?? "",
    unitOfMeasure: r.product?.unit_of_measure ?? "",
    quantityOrdered: r.quantity_ordered,
    quantityReceived: r.quantity_received,
    outstanding: r.quantity_ordered - r.quantity_received,
    unitCost: r.unit_cost,
    lineTotal: r.line_total ?? r.quantity_ordered * r.unit_cost,
  }));
}

/** Counts per status, for the list page tabs. */
export async function getPurchaseOrderStatusCounts(): Promise<Record<PurchaseOrderStatus, number>> {
  const supabase = await createClient();
  const statuses: PurchaseOrderStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];
  const results = await Promise.all(
    statuses.map((s) => supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", s)),
  );
  const counts = {} as Record<PurchaseOrderStatus, number>;
  statuses.forEach((s, i) => {
    const r = results[i];
    if (r.error) throw new Error(`Failed to count purchase orders: ${r.error.message}`);
    counts[s] = r.count ?? 0;
  });
  return counts;
}

/** Orders due for delivery by a date (inclusive) and still waiting for goods. */
export function isOverdue(po: Pick<PurchaseOrderSummary, "status" | "expectedDeliveryDate">, today: string): boolean {
  return (
    (po.status === "APPROVED" || po.status === "PARTIALLY_RECEIVED") &&
    po.expectedDeliveryDate !== null &&
    po.expectedDeliveryDate < today
  );
}

