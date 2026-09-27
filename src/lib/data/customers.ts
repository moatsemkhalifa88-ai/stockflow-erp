import "server-only";
import { pageRange, type SortState } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/types/database";
import { num, str, unwrapPage, type Page } from "./common";

type SummaryRow = Views<"customer_sales_summary">;

/** A customer with its sales figures (see customer_sales_summary). */
export interface CustomerSummary {
  id: string;
  code: string;
  name: string;
  customerType: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string;
  creditLimit: number;
  paymentTermsDays: number;
  isActive: boolean;
  orderCount: number;
  totalSalesValue: number;
  lastOrderDate: string | null;
  openCount: number;
  openValue: number;
}

function toSummary(r: SummaryRow): CustomerSummary {
  return {
    id: str(r.customer_id),
    code: str(r.code),
    name: str(r.name),
    customerType: str(r.customer_type),
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    city: r.city,
    country: str(r.country),
    creditLimit: num(r.credit_limit),
    paymentTermsDays: num(r.payment_terms_days),
    isActive: r.is_active ?? false,
    orderCount: num(r.order_count),
    totalSalesValue: num(r.total_sales_value),
    lastOrderDate: r.last_order_date,
    openCount: num(r.open_count),
    openValue: num(r.open_value),
  };
}

export const CUSTOMER_SORT_COLUMNS = ["code", "name", "city", "total_sales_value", "last_order_date", "open_count"] as const;
export type CustomerSortColumn = (typeof CUSTOMER_SORT_COLUMNS)[number];

export const CUSTOMER_ACTIVITY_FILTERS = ["active", "inactive", "all"] as const;
export type CustomerActivityFilter = (typeof CUSTOMER_ACTIVITY_FILTERS)[number];

export interface CustomerFilters {
  q: string;
  customerType?: string;
  activity: CustomerActivityFilter;
  openOnly: boolean;
  sort: SortState<CustomerSortColumn>;
  page: number;
}

export async function listCustomers(filters: CustomerFilters): Promise<Page<CustomerSummary>> {
  const supabase = await createClient();
  let query = supabase.from("customer_sales_summary").select("*", { count: "exact" });

  if (filters.customerType) query = query.eq("customer_type", filters.customerType);
  if (filters.activity !== "all") query = query.eq("is_active", filters.activity === "active");
  if (filters.openOnly) query = query.gt("open_count", 0);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`code.ilike.${term},name.ilike.${term},contact_name.ilike.${term},email.ilike.${term},city.ilike.${term}`);
  }

  const { from, to } = pageRange(filters.page);
  const result = await query
    .order(filters.sort.column, { ascending: filters.sort.ascending, nullsFirst: false })
    .order("code")
    .range(from, to);
  const page = unwrapPage(result, "customers");
  return { rows: page.rows.map(toSummary), total: page.total };
}

export async function getCustomerSummary(id: string): Promise<CustomerSummary | null> {
  const supabase = await createClient();
  const result = await supabase.from("customer_sales_summary").select("*").eq("customer_id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load customer: ${result.error.message}`);
  return result.data ? toSummary(result.data) : null;
}

export type CustomerRecord = Tables<"customers">;

export async function getCustomer(id: string): Promise<CustomerRecord | null> {
  const supabase = await createClient();
  const result = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Failed to load customer: ${result.error.message}`);
  return result.data;
}
