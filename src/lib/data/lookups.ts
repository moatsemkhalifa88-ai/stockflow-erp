import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./common";

export interface CategoryOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  isActive: boolean;
}

export interface ManagerOption {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
}

/** People who may manage a warehouse: admins and warehouse managers (see warehouses_validate_change). */
export async function getManagerOptions(): Promise<ManagerOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("profiles")
      .select("id, full_name, email, is_active, role:roles!inner(code, is_active)")
      .in("role.code", ["admin", "warehouse_manager"])
      .order("full_name"),
    "managers",
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name || r.email,
    email: r.email,
    isActive: r.is_active && r.role.is_active,
  }));
}

export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const rows = unwrap(await supabase.from("categories").select("id, name, is_active").order("name"), "categories");
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
}

export async function getWarehouseOptions(): Promise<WarehouseOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("warehouses").select("id, code, name, is_active").order("code"),
    "warehouses",
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.is_active }));
}

export interface SupplierOption {
  id: string;
  code: string;
  name: string;
  leadTimeDays: number;
  isActive: boolean;
}

export async function getSupplierOptions(): Promise<SupplierOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("suppliers").select("id, code, name, lead_time_days, is_active").order("name"),
    "suppliers",
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, leadTimeDays: r.lead_time_days, isActive: r.is_active }));
}

export interface CustomerOption {
  id: string;
  code: string;
  name: string;
  paymentTermsDays: number;
  isActive: boolean;
}

export async function getCustomerOptions(): Promise<CustomerOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("customers").select("id, code, name, payment_terms_days, is_active").order("name"),
    "customers",
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, paymentTermsDays: r.payment_terms_days, isActive: r.is_active }));
}

export interface PricedProductOption extends ProductOption {
  costPrice: number;
  salePrice: number;
}

export async function getPricedProductOptions(): Promise<PricedProductOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("products").select("id, sku, name, is_active, cost_price, sale_price").order("sku").limit(1000),
    "products",
  );
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    isActive: r.is_active,
    costPrice: r.cost_price,
    salePrice: r.sale_price,
  }));
}

export async function getProductOptions(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("products").select("id, sku, name, is_active").order("sku").limit(1000),
    "products",
  );
  return rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, isActive: r.is_active }));
}
