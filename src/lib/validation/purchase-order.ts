import { isUuid } from "@/lib/search-params";

/**
 * Purchase order form: header fields plus repeated line fields
 * (line_product_id / line_quantity / line_unit_cost, one per line, in order).
 * create_purchase_order / update_purchase_order re-validate everything.
 */

export interface PurchaseOrderLineValues {
  product_id: string;
  quantity: string;
  unit_cost: string;
}

export interface PurchaseOrderFormValues {
  supplier_id: string;
  warehouse_id: string;
  order_date: string;
  expected_delivery_date: string;
  notes: string;
  lines: PurchaseOrderLineValues[];
}

export type LineFieldErrors = Partial<Record<keyof PurchaseOrderLineValues, string>>;

export interface PurchaseOrderFieldErrors {
  supplier_id?: string;
  warehouse_id?: string;
  order_date?: string;
  expected_delivery_date?: string;
  notes?: string;
  lines?: string;
  /** Keyed by line index. */
  lineErrors?: Record<number, LineFieldErrors>;
}

export interface PurchaseOrderInput {
  supplier_id: string;
  warehouse_id: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  items: { product_id: string; quantity: number; unit_cost: number }[];
}

export type PurchaseOrderValidation =
  | { ok: true; value: PurchaseOrderInput }
  | { ok: false; errors: PurchaseOrderFieldErrors };

export const MAX_PO_LINES = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const QUANTITY_PATTERN = /^\d{1,7}$/;

function text(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function all(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((v) => (typeof v === "string" ? v.trim() : ""));
}

export function readPurchaseOrderForm(formData: FormData): PurchaseOrderFormValues {
  const products = all(formData, "line_product_id");
  const quantities = all(formData, "line_quantity");
  const costs = all(formData, "line_unit_cost");
  const lines = products.map((product_id, i) => ({
    product_id,
    quantity: quantities[i] ?? "",
    unit_cost: costs[i] ?? "",
  }));
  return {
    supplier_id: text(formData, "supplier_id"),
    warehouse_id: text(formData, "warehouse_id"),
    order_date: text(formData, "order_date"),
    expected_delivery_date: text(formData, "expected_delivery_date"),
    notes: text(formData, "notes"),
    // Fully blank rows (added but never filled) are ignored.
    lines: lines.filter((l) => l.product_id || l.quantity || l.unit_cost),
  };
}

export function validatePurchaseOrder(values: PurchaseOrderFormValues, today: string): PurchaseOrderValidation {
  const errors: PurchaseOrderFieldErrors = {};

  if (!isUuid(values.supplier_id)) errors.supplier_id = "Choose a supplier.";
  if (!isUuid(values.warehouse_id)) errors.warehouse_id = "Choose a warehouse.";
  if (!DATE_PATTERN.test(values.order_date)) errors.order_date = "Enter the order date.";
  else if (values.order_date > today) errors.order_date = "Order date cannot be in the future.";
  if (values.expected_delivery_date !== "") {
    if (!DATE_PATTERN.test(values.expected_delivery_date)) errors.expected_delivery_date = "Enter a valid date.";
    else if (values.expected_delivery_date < values.order_date) {
      errors.expected_delivery_date = "Expected delivery cannot be before the order date.";
    }
  }
  if (values.notes.length > 2000) errors.notes = "Notes must be 2,000 characters or fewer.";

  if (values.lines.length === 0) errors.lines = "Add at least one line.";
  else if (values.lines.length > MAX_PO_LINES) errors.lines = `A purchase order can have at most ${MAX_PO_LINES} lines.`;

  const lineErrors: Record<number, LineFieldErrors> = {};
  const seen = new Set<string>();
  values.lines.forEach((line, i) => {
    const e: LineFieldErrors = {};
    if (!isUuid(line.product_id)) e.product_id = "Choose a product.";
    else if (seen.has(line.product_id)) e.product_id = "This product is already on another line.";
    seen.add(line.product_id);
    if (!QUANTITY_PATTERN.test(line.quantity) || Number(line.quantity) < 1) e.quantity = "Whole number, 1 or more.";
    if (!MONEY_PATTERN.test(line.unit_cost)) e.unit_cost = "0 or more, up to 2 decimals.";
    if (Object.keys(e).length > 0) lineErrors[i] = e;
  });
  if (Object.keys(lineErrors).length > 0) errors.lineErrors = lineErrors;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      supplier_id: values.supplier_id,
      warehouse_id: values.warehouse_id,
      order_date: values.order_date,
      expected_delivery_date: values.expected_delivery_date || null,
      notes: values.notes || null,
      items: values.lines.map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit_cost: Number(l.unit_cost),
      })),
    },
  };
}

/** Receipt form: repeated line_id / line_quantity. Blank or 0 means "not received this time". */
export interface ReceiptLineInput {
  purchase_order_item_id: string;
  quantity: number;
}

export type ReceiptValidation =
  | { ok: true; items: ReceiptLineInput[] }
  | { ok: false; error?: string; lineErrors?: Record<string, string> };

export function validateReceipt(
  formData: FormData,
  outstanding: ReadonlyMap<string, number>,
): ReceiptValidation {
  const ids = all(formData, "line_id");
  const quantities = all(formData, "line_quantity");
  const lineErrors: Record<string, string> = {};
  const items: ReceiptLineInput[] = [];

  ids.forEach((id, i) => {
    const raw = quantities[i] ?? "";
    if (raw === "" || raw === "0") return;
    const open = outstanding.get(id);
    if (open === undefined) {
      lineErrors[id] = "This line is not on the purchase order.";
    } else if (!QUANTITY_PATTERN.test(raw)) {
      lineErrors[id] = "Whole number, 0 or more.";
    } else if (Number(raw) > open) {
      lineErrors[id] = `Only ${open} outstanding.`;
    } else {
      items.push({ purchase_order_item_id: id, quantity: Number(raw) });
    }
  });

  if (Object.keys(lineErrors).length > 0) return { ok: false, lineErrors };
  if (items.length === 0) return { ok: false, error: "Enter a received quantity for at least one line." };
  return { ok: true, items };
}
