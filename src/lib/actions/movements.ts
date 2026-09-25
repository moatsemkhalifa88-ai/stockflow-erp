"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canMoveStock } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError } from "@/lib/db-errors";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readAdjustmentForm,
  validateAdjustment,
  type AdjustmentFieldErrors,
  type AdjustmentFormValues,
} from "@/lib/validation/movement";

export interface AdjustmentFormState {
  error?: string;
  fieldErrors?: AdjustmentFieldErrors;
  values?: AdjustmentFormValues;
}

export interface ReverseFormState {
  error?: string;
  reason?: string;
}

const NO_PERMISSION = "You do not have permission to change stock levels.";

/** Every page that shows stock must re-render after a movement. */
function revalidateStockPages(productId: string, warehouseId: string): void {
  for (const path of ["/movements", "/inventory", "/products", "/warehouses", "/dashboard"]) revalidatePath(path);
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/warehouses/${warehouseId}`);
}

/** Posts a manual ADJUSTMENT_IN / ADJUSTMENT_OUT through the inventory engine. */
export async function createAdjustment(_prev: AdjustmentFormState, formData: FormData): Promise<AdjustmentFormState> {
  const user = await getActiveUser();
  if (!user || !canMoveStock(user.role)) return { error: NO_PERMISSION };

  const values = readAdjustmentForm(formData);
  const validation = validateAdjustment(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };
  const input = validation.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_movement", {
    p_product_id: input.product_id,
    p_warehouse_id: input.warehouse_id,
    p_movement_type: input.movement_type,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_reference_number: input.reference_number ?? undefined,
    p_notes: input.notes ?? undefined,
  });

  if (error) {
    const message = describeDbError(error, "The adjustment could not be posted.");
    // Insufficient stock is about the quantity the user typed.
    return error.code === "SF001" ? { fieldErrors: { quantity: message }, values } : { error: message, values };
  }

  revalidateStockPages(input.product_id, input.warehouse_id);
  redirect(`/movements/${data.id}?saved=created`);
}

/** Reverses a movement by posting its opposite; history is never edited. */
export async function reverseMovement(
  movementId: string,
  _prev: ReverseFormState,
  formData: FormData,
): Promise<ReverseFormState> {
  const user = await getActiveUser();
  if (!user || !canMoveStock(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(movementId)) return { error: "Unknown movement." };

  const raw = formData.get("reason");
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length === 0) return { error: "A reason is required to reverse a movement.", reason };
  if (reason.length > 500) return { error: "Reason must be 500 characters or fewer.", reason };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_stock_movement", {
    p_movement_id: movementId,
    p_reason: reason,
  });
  if (error) return { error: describeDbError(error, "The movement could not be reversed."), reason };

  revalidateStockPages(data.product_id, data.warehouse_id);
  revalidatePath(`/movements/${movementId}`);
  redirect(`/movements/${data.id}?saved=reversed`);
}
