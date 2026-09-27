import "server-only";
import type { SalesOrderStatus } from "@/lib/sales";
import { pageRange, type SortState } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Views } from "@/types/database";
import { num, str, unwrap, unwrapPage, type Page } from "./common";

type OverviewRow = Views<"sales_order_overview">;

export interface SalesOrderSummary {
  id: string;
  soNumber: string;
  status: SalesOrderStatus;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerType: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  orderDate: string;
  requestedDeliveryDate: string | null;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  notes: string | null;
  lineCount: number;
  quantity: number;
  quantityShipped: number;
  createdByName: string | null;
  confirmedAt: string | null;
  processingStartedAt: string | null;
  shippedAt: string | null;
  shippedByName: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  shipmentReversedAt: string | null;
  shipmentReversalReason: string | null;
  createdAt: string;
}

function toSummary(r: OverviewRow): SalesOrderSummary {
  return {
    id: str(r.id),
    soNumber: str(r.so_number),
    status: r.status ?? "DRAFT",
    customerId: str(r.customer_id),
    customerCode: str(r.customer_code),
    customerName: str(r.customer_name),
    customerType: str(r.customer_type),
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    warehouseName: str(r.warehouse_name),
    orderDate: str(r.order_date),
    requestedDeliveryDate: r.requested_delivery_date,
    subtotal: num(r.subtotal),
    discountAmount: num(r.discount_amount),
    totalAmount: num(r.total_amount),
    notes: r.notes,
    lineCount: num(r.line_count),
    quantity: num(r.quantity),
    quantityShipped: num(r.quantity_shipped),
    createdByName: r.created_by_name,
    confirmedAt: r.confirmed_at,
    processingStartedAt: r.processing_started_at,
    shippedAt: r.shipped_at,
    shippedByName: r.shipped_by_name,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    shipmentReversedAt: r.shipment_reversed_at,
    shipmentReversalReason: r.shipment_reversal_reason,
    createdAt: str(r.created_at),
  };
}

export const SO_SORT_COLUMNS = ["so_number", "order_date", "requested_delivery_date", "customer_name", "total_amount"] as const;
export type SalesOrderSortColumn = (typeof SO_SORT_COLUMNS)[number];

export interface SalesOrderFilters {
  q: string;
  status?: SalesOrderStatus;
  /** "open" = confirmed or processing. */
  openOnly: boolean;
  customerId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  sort: SortState<SalesOrderSortColumn>;
  page: number;
}

export async function listSalesOrders(filters: SalesOrderFilters): Promise<Page<SalesOrderSummary>> {
  const supabase = await createClient();
  let query = supabase.from("sales_order_overview").select("*", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.openOnly) query = query.in("status", ["CONFIRMED", "PROCESSING"]);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.from) query = query.gte("order_date", filters.from);
  if (filters.to) query = query.lte("order_date", filters.to);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`so_number.ilike.${term},customer_name.ilike.${term},customer_code.ilike.${term}`);
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order(filters.sort.column, { ascending: filters.sort.ascending, nullsFirst: false })
    .order("so_number", { ascending: false })
    .range(from, to);
  const page = unwrapPage(result, "sales orders");
  return { rows: page.rows.map(toSummary), total: page.total };
}

export async function getSalesOrderSummary(id: string): Promise<SalesOrderSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("sales_order_overview").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load sales order: ${result.error.message}`);
  return result.data ? toSummary(result.data) : null;
}

export async function getRecentSalesOrders(customerId: string, limit = 20): Promise<SalesOrderSummary[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("sales_order_overview")
      .select("*")
      .eq("customer_id", customerId)
      .order("order_date", { ascending: false })
      .order("so_number", { ascending: false })
      .limit(limit),
    "sales orders",
  );
  return rows.map(toSummary);
}

export interface SalesOrderLine {
  id: string;
  lineNumber: number;
  productId: string;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  quantityShipped: number;
  unitPrice: number;
  discountPercent: number;
  grossAmount: number;
  discountAmount: number;
  lineTotal: number;
  /** Stock at the order's warehouse right now (for the "can we ship?" check). */
  available: number;
}

export async function getSalesOrderLines(soId: string, warehouseId: string): Promise<SalesOrderLine[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("sales_order_items")
      .select(
        "id, line_number, product_id, quantity, quantity_shipped, unit_price, discount_percent, gross_amount, discount_amount, line_total, product:products(sku, name, unit_of_measure)",
      )
      .eq("sales_order_id", soId)
      .order("line_number"),
    "sales order lines",
  );
  const stock = unwrap(
    await supabase
      .from("inventory")
      .select("product_id, quantity")
      .eq("warehouse_id", warehouseId)
      .in("product_id", rows.map((r) => r.product_id)),
    "stock",
  );
  const available = new Map(stock.map((s) => [s.product_id, s.quantity]));

  return rows.map((r) => ({
    id: r.id,
    lineNumber: r.line_number,
    productId: r.product_id,
    sku: r.product?.sku ?? "",
    productName: r.product?.name ?? "",
    unitOfMeasure: r.product?.unit_of_measure ?? "",
    quantity: r.quantity,
    quantityShipped: r.quantity_shipped,
    unitPrice: r.unit_price,
    discountPercent: r.discount_percent,
    grossAmount: r.gross_amount ?? 0,
    discountAmount: r.discount_amount ?? 0,
    lineTotal: r.line_total ?? 0,
    available: available.get(r.product_id) ?? 0,
  }));
}

export async function getSalesOrderStatusCounts(): Promise<Record<SalesOrderStatus, number>> {
  const supabase = await createClient();
  const statuses: SalesOrderStatus[] = ["DRAFT", "CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED", "CANCELLED"];
  const results = await Promise.all(
    statuses.map((s) => supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("status", s)),
  );
  const counts = {} as Record<SalesOrderStatus, number>;
  statuses.forEach((s, i) => {
    const r = results[i];
    if (r.error) throw new Error(`Failed to count sales orders: ${r.error.message}`);
    counts[s] = r.count ?? 0;
  });
  return counts;
}

/** Past the requested delivery date and not shipped yet. */
export function isLate(so: Pick<SalesOrderSummary, "status" | "requestedDeliveryDate">, today: string): boolean {
  return (
    (so.status === "CONFIRMED" || so.status === "PROCESSING") &&
    so.requestedDeliveryDate !== null &&
    so.requestedDeliveryDate < today
  );
}
