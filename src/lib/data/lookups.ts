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

export async function getProductOptions(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("products").select("id, sku, name, is_active").order("sku").limit(1000),
    "products",
  );
  return rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, isActive: r.is_active }));
}
