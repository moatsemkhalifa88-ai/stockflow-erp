"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageSuppliers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError, type DbError } from "@/lib/db-errors";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readSupplierForm,
  validateSupplier,
  type SupplierFieldErrors,
  type SupplierFormValues,
} from "@/lib/validation/supplier";
import type { ActionResult } from "./types";

/* Supplier changes are master-data writes checked by RLS and audited by the suppliers_audit trigger. */

export interface SupplierFormState {
  error?: string;
  fieldErrors?: SupplierFieldErrors;
  values?: SupplierFormValues;
}

const NO_PERMISSION = "You do not have permission to manage suppliers.";

function fieldErrorsFor(error: DbError, message: string): SupplierFieldErrors | undefined {
  const text = `${error.message} ${error.details ?? ""}`;
  if (text.includes("suppliers_code")) return { code: message };
  if (text.includes("suppliers_name")) return { name: message };
  if (text.includes("suppliers_tax_id")) return { tax_id: message };
  if (text.includes("suppliers_email")) return { email: message };
  return undefined;
}

export async function createSupplier(_prev: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const user = await getActiveUser();
  if (!user || !canManageSuppliers(user.role)) return { error: NO_PERMISSION };

  const values = readSupplierForm(formData);
  const validation = validateSupplier(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").insert(validation.value).select("id").single();
  if (error) {
    const message = describeDbError(error, "The supplier could not be created.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }

  revalidatePath("/suppliers");
  redirect(`/suppliers/${data.id}?saved=created`);
}

export async function updateSupplier(
  supplierId: string,
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const user = await getActiveUser();
  if (!user || !canManageSuppliers(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(supplierId)) return { error: "Unknown supplier." };

  const values = readSupplierForm(formData);
  const validation = validateSupplier(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").update(validation.value).eq("id", supplierId).select("id");
  if (error) {
    const message = describeDbError(error, "The supplier could not be saved.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }
  if (data.length === 0) return { error: NO_PERMISSION, values };

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  redirect(`/suppliers/${supplierId}?saved=updated`);
}

/** Deactivate / reactivate. Suppliers are never deleted; inactive suppliers get no new orders. */
export async function setSupplierActive(supplierId: string, active: boolean): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user || !canManageSuppliers(user.role)) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(supplierId)) return { ok: false, error: "Unknown supplier." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").update({ is_active: active }).eq("id", supplierId).select("id");
  if (error) return { ok: false, error: describeDbError(error) };
  if (data.length === 0) return { ok: false, error: NO_PERMISSION };

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true };
}
