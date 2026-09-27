import { isUuid } from "@/lib/search-params";

/** Transfer request form: two warehouses plus repeated line_product_id / line_quantity. */

export interface TransferLineValues {
  product_id: string;
  quantity: string;
}

export interface TransferFormValues {
  source_warehouse_id: string;
  destination_warehouse_id: string;
  notes: string;
  lines: TransferLineValues[];
}

export interface TransferFieldErrors {
  source_warehouse_id?: string;
  destination_warehouse_id?: string;
  notes?: string;
  lines?: string;
  lineErrors?: Record<number, Partial<Record<keyof TransferLineValues, string>>>;
}

export interface TransferInput {
  source_warehouse_id: string;
  destination_warehouse_id: string;
  notes: string | null;
  items: { product_id: string; quantity: number }[];
}

export type TransferValidation = { ok: true; value: TransferInput } | { ok: false; errors: TransferFieldErrors };

function text(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export function readTransferForm(formData: FormData): TransferFormValues {
  const products = formData.getAll("line_product_id").map((v) => (typeof v === "string" ? v.trim() : ""));
  const quantities = formData.getAll("line_quantity").map((v) => (typeof v === "string" ? v.trim() : ""));
  return {
    source_warehouse_id: text(formData, "source_warehouse_id"),
    destination_warehouse_id: text(formData, "destination_warehouse_id"),
    notes: text(formData, "notes"),
    lines: products
      .map((product_id, i) => ({ product_id, quantity: quantities[i] ?? "" }))
      .filter((l) => l.product_id || l.quantity),
  };
}

export function validateTransfer(values: TransferFormValues): TransferValidation {
  const errors: TransferFieldErrors = {};

  if (!isUuid(values.source_warehouse_id)) errors.source_warehouse_id = "Choose the warehouse to send from.";
  if (!isUuid(values.destination_warehouse_id)) errors.destination_warehouse_id = "Choose the warehouse to send to.";
  else if (values.destination_warehouse_id === values.source_warehouse_id) {
    errors.destination_warehouse_id = "Source and destination must be different warehouses.";
  }
  if (values.notes.length > 2000) errors.notes = "Notes must be 2,000 characters or fewer.";
  if (values.lines.length === 0) errors.lines = "Add at least one line.";
  else if (values.lines.length > 200) errors.lines = "A transfer can have at most 200 lines.";

  const lineErrors: NonNullable<TransferFieldErrors["lineErrors"]> = {};
  const seen = new Set<string>();
  values.lines.forEach((line, i) => {
    const e: Partial<Record<keyof TransferLineValues, string>> = {};
    if (!isUuid(line.product_id)) e.product_id = "Choose a product.";
    else if (seen.has(line.product_id)) e.product_id = "This product is already on another line.";
    seen.add(line.product_id);
    if (!/^\d{1,7}$/.test(line.quantity) || Number(line.quantity) < 1) e.quantity = "Whole number, 1 or more.";
    if (Object.keys(e).length > 0) lineErrors[i] = e;
  });
  if (Object.keys(lineErrors).length > 0) errors.lineErrors = lineErrors;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      source_warehouse_id: values.source_warehouse_id,
      destination_warehouse_id: values.destination_warehouse_id,
      notes: values.notes || null,
      items: values.lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
    },
  };
}
