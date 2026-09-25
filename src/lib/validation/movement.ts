import { isManualMovementType, type ManualMovementType } from "@/lib/inventory";
import { isUuid } from "@/lib/search-params";

/** Validation for the manual stock adjustment form. The inventory engine re-checks everything. */

export const ADJUSTMENT_FIELDS = [
  "movement_type",
  "product_id",
  "warehouse_id",
  "quantity",
  "reason",
  "reference_number",
  "notes",
] as const;

export type AdjustmentField = (typeof ADJUSTMENT_FIELDS)[number];
export type AdjustmentFieldErrors = Partial<Record<AdjustmentField, string>>;
export type AdjustmentFormValues = Record<AdjustmentField, string>;

export interface AdjustmentInput {
  movement_type: ManualMovementType;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  reason: string;
  reference_number: string | null;
  notes: string | null;
}

export type AdjustmentValidation =
  | { ok: true; value: AdjustmentInput }
  | { ok: false; errors: AdjustmentFieldErrors };

export const MAX_ADJUSTMENT_QUANTITY = 1_000_000;

export function readAdjustmentForm(formData: FormData): AdjustmentFormValues {
  const values = {} as AdjustmentFormValues;
  for (const field of ADJUSTMENT_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim() : "";
  }
  return values;
}

export function validateAdjustment(values: AdjustmentFormValues): AdjustmentValidation {
  const errors: AdjustmentFieldErrors = {};

  if (!isManualMovementType(values.movement_type)) errors.movement_type = "Choose stock in or stock out.";
  if (!isUuid(values.product_id)) errors.product_id = "Choose a product.";
  if (!isUuid(values.warehouse_id)) errors.warehouse_id = "Choose a warehouse.";

  const quantity = Number(values.quantity);
  if (!/^\d+$/.test(values.quantity) || quantity < 1) errors.quantity = "Enter a whole number of 1 or more.";
  else if (quantity > MAX_ADJUSTMENT_QUANTITY) errors.quantity = "That quantity is too large for a single adjustment.";

  if (values.reason.length === 0) errors.reason = "A reason is required for every adjustment.";
  else if (values.reason.length > 500) errors.reason = "Reason must be 500 characters or fewer.";
  if (values.reference_number.length > 100) errors.reference_number = "Reference must be 100 characters or fewer.";
  if (values.notes.length > 2000) errors.notes = "Notes must be 2,000 characters or fewer.";

  if (Object.keys(errors).length > 0 || !isManualMovementType(values.movement_type)) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      movement_type: values.movement_type,
      product_id: values.product_id,
      warehouse_id: values.warehouse_id,
      quantity,
      reason: values.reason,
      reference_number: values.reference_number || null,
      notes: values.notes || null,
    },
  };
}
