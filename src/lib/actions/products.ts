"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageProducts } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError, type DbError } from "@/lib/db-errors";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readProductForm,
  validateProduct,
  type ProductFieldErrors,
  type ProductFormValues,
} from "@/lib/validation/product";

export interface ProductFormState {
  error?: string;
  fieldErrors?: ProductFieldErrors;
  values?: ProductFormValues;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const NO_PERMISSION = "You do not have permission to manage products.";

/** Unique-key violations belong to a field, so show them there. */
function fieldErrorsFor(error: DbError, message: string): ProductFieldErrors | undefined {
  const text = `${error.message} ${error.details ?? ""}`;
  if (text.includes("products_sku") || error.code === "SF003") return { sku: message };
  if (text.includes("products_barcode")) return { barcode: message };
  return undefined;
}

export async function createProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const user = await getActiveUser();
  if (!user || !canManageProducts(user.role)) return { error: NO_PERMISSION };

  const values = readProductForm(formData);
  const validation = validateProduct(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("products").insert(validation.value).select("id").single();
  if (error) {
    const message = describeDbError(error, "The product could not be created.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }

  revalidatePath("/products");
  redirect(`/products/${data.id}?saved=created`);
}

export async function updateProduct(
  productId: string,
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const user = await getActiveUser();
  if (!user || !canManageProducts(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(productId)) return { error: "Unknown product." };

  const values = readProductForm(formData);
  const validation = validateProduct(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("products").update(validation.value).eq("id", productId).select("id");
  if (error) {
    const message = describeDbError(error, "The product could not be saved.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }
  // RLS filters rows silently instead of raising.
  if (data.length === 0) return { error: NO_PERMISSION, values };

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?saved=updated`);
}

/** Deactivate / reactivate. Products are never hard-deleted. */
export async function setProductActive(productId: string, active: boolean): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user || !canManageProducts(user.role)) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(productId)) return { ok: false, error: "Unknown product." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: active })
    .eq("id", productId)
    .select("id");
  if (error) return { ok: false, error: describeDbError(error) };
  if (data.length === 0) return { ok: false, error: NO_PERMISSION };

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return { ok: true };
}
