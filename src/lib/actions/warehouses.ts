"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageWarehouses } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError, type DbError } from "@/lib/db-errors";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readWarehouseForm,
  validateWarehouse,
  type WarehouseFieldErrors,
  type WarehouseFormValues,
} from "@/lib/validation/warehouse";
import type { ActionResult } from "./products";

/*
 * Warehouse changes are plain master-data writes checked by RLS. Every insert
 * and update is written to audit_log by the warehouses_audit trigger, with the
 * acting user and the changed fields; there is no path that skips it.
 */

export interface WarehouseFormState {
  error?: string;
  fieldErrors?: WarehouseFieldErrors;
  values?: WarehouseFormValues;
}

const NO_PERMISSION = "You do not have permission to manage warehouses.";

function fieldErrorsFor(error: DbError, message: string): WarehouseFieldErrors | undefined {
  const text = `${error.message} ${error.details ?? ""}`;
  if (text.includes("warehouses_code") || error.code === "SF004") return { code: message };
  if (text.includes("warehouses_name")) return { name: message };
  if (error.code === "SF005") return { manager_id: message };
  return undefined;
}

function revalidateWarehousePages(id?: string): void {
  for (const path of ["/warehouses", "/inventory", "/dashboard", "/movements/new"]) revalidatePath(path);
  if (id) revalidatePath(`/warehouses/${id}`);
}

export async function createWarehouse(_prev: WarehouseFormState, formData: FormData): Promise<WarehouseFormState> {
  const user = await getActiveUser();
  if (!user || !canManageWarehouses(user.role)) return { error: NO_PERMISSION };

  const values = readWarehouseForm(formData);
  const validation = validateWarehouse(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouses").insert(validation.value).select("id").single();
  if (error) {
    const message = describeDbError(error, "The warehouse could not be created.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }

  revalidateWarehousePages();
  redirect(`/warehouses/${data.id}?saved=created`);
}

export async function updateWarehouse(
  warehouseId: string,
  _prev: WarehouseFormState,
  formData: FormData,
): Promise<WarehouseFormState> {
  const user = await getActiveUser();
  if (!user || !canManageWarehouses(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(warehouseId)) return { error: "Unknown warehouse." };

  const values = readWarehouseForm(formData);
  const validation = validateWarehouse(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .update(validation.value)
    .eq("id", warehouseId)
    .select("id");
  if (error) {
    const message = describeDbError(error, "The warehouse could not be saved.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }
  // RLS filters rows silently instead of raising.
  if (data.length === 0) return { error: NO_PERMISSION, values };

  revalidateWarehousePages(warehouseId);
  redirect(`/warehouses/${warehouseId}?saved=updated`);
}

/** Deactivate / reactivate. Warehouses are never deleted. */
export async function setWarehouseActive(warehouseId: string, active: boolean): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user || !canManageWarehouses(user.role)) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(warehouseId)) return { ok: false, error: "Unknown warehouse." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .update({ is_active: active })
    .eq("id", warehouseId)
    .select("id");
  if (error) return { ok: false, error: describeDbError(error) };
  if (data.length === 0) return { ok: false, error: NO_PERMISSION };

  revalidateWarehousePages(warehouseId);
  return { ok: true };
}
