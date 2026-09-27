import "server-only";
import { pageRange, type SortState } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/types/database";
import { num, str, unwrapPage, type Page } from "./common";

type SummaryRow = Views<"supplier_purchase_summary">;

/** A supplier with its purchasing figures (see supplier_purchase_summary). */
export interface SupplierSummary {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string;
  paymentTermsDays: number;
  leadTimeDays: number;
  isActive: boolean;
  orderCount: number;
  totalPurchaseValue: number;
  receivedValue: number;
  lastOrderDate: string | null;
  outstandingCount: number;
  outstandingValue: number;
}

function toSupplierSummary(r: SummaryRow): SupplierSummary {
  return {
    id: str(r.supplier_id),
    code: str(r.code),
    name: str(r.name),
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    city: r.city,
    country: str(r.country),
    paymentTermsDays: num(r.payment_terms_days),
    leadTimeDays: num(r.lead_time_days),
    isActive: r.is_active ?? false,
    orderCount: num(r.order_count),
    totalPurchaseValue: num(r.total_purchase_value),
    receivedValue: num(r.received_value),
    lastOrderDate: r.last_order_date,
    outstandingCount: num(r.outstanding_count),
    outstandingValue: num(r.outstanding_value),
  };
}

export const SUPPLIER_SORT_COLUMNS = ["code", "name", "city", "total_purchase_value", "last_order_date", "outstanding_count"] as const;
export type SupplierSortColumn = (typeof SUPPLIER_SORT_COLUMNS)[number];

export const SUPPLIER_ACTIVITY_FILTERS = ["active", "inactive", "all"] as const;
export type SupplierActivityFilter = (typeof SUPPLIER_ACTIVITY_FILTERS)[number];

export interface SupplierFilters {
  q: string;
  activity: SupplierActivityFilter;
  outstandingOnly: boolean;
  sort: SortState<SupplierSortColumn>;
  page: number;
}

export async function listSuppliers(filters: SupplierFilters): Promise<Page<SupplierSummary>> {
  const supabase = await createClient();
  let query = supabase.from("supplier_purchase_summary").select("*", { count: "exact" });

  if (filters.activity !== "all") query = query.eq("is_active", filters.activity === "active");
  if (filters.outstandingOnly) query = query.gt("outstanding_count", 0);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`code.ilike.${term},name.ilike.${term},contact_name.ilike.${term},email.ilike.${term},city.ilike.${term}`);
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order(filters.sort.column, { ascending: filters.sort.ascending, nullsFirst: false })
    .order("code")
    .range(from, to);
  const page = unwrapPage(result, "suppliers");
  return { rows: page.rows.map(toSupplierSummary), total: page.total };
}

export async function getSupplierSummary(id: string): Promise<SupplierSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("supplier_purchase_summary").select("*").eq("supplier_id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load supplier: ${result.error.message}`);
  return result.data ? toSupplierSummary(result.data) : null;
}

export type SupplierRecord = Tables<"suppliers">;

export async function getSupplier(id: string): Promise<SupplierRecord | null> {
  const supabase = await createClient();
  const result = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load supplier: ${result.error.message}`);
  return result.data;
}
