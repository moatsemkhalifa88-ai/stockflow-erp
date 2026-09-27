import { isUuid } from "@/lib/search-params";

/**
 * Sales order form: header fields plus repeated line fields (line_product_id /
 * line_quantity / line_unit_price / line_discount_percent). The RPCs re-validate.
 */

export interface SalesOrderLineValues {
  product_id: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
}

export interface SalesOrderFormValues {
  customer_id: string;
  warehouse_id: string;
  order_date: string;
  requested_delivery_date: string;
  notes: string;
  lines: SalesOrderLineValues[];
}

export type SalesLineFieldErrors = Partial<Record<keyof SalesOrderLineValues, string>>;

export interface SalesOrderFieldErrors {
  customer_id?: string;
  warehouse_id?: string;
  order_date?: string;
  requested_delivery_date?: string;
  notes?: string;
  lines?: string;
  lineErrors?: Record<number, SalesLineFieldErrors>;
}

export interface SalesOrderItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
}

export interface SalesOrderInput {
  customer_id: string;
  warehouse_id: string;
  order_date: string;
  requested_delivery_date: string | null;
  notes: string | null;
  items: SalesOrderItemInput[];
}

export type SalesOrderValidation = { ok: true; value: SalesOrderInput } | { ok: false; errors: SalesOrderFieldErrors };

export const MAX_SO_LINES = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
const QUANTITY_PATTERN = /^\d{1,7}$/;

function text(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function all(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((v) => (typeof v === "string" ? v.trim() : ""));
}

export function readSalesOrderForm(formData: FormData): SalesOrderFormValues {
  const products = all(formData, "line_product_id");
  const quantities = all(formData, "line_quantity");
  const prices = all(formData, "line_unit_price");
  const discounts = all(formData, "line_discount_percent");
  return {
    customer_id: text(formData, "customer_id"),
    warehouse_id: text(formData, "warehouse_id"),
    order_date: text(formData, "order_date"),
    requested_delivery_date: text(formData, "requested_delivery_date"),
    notes: text(formData, "notes"),
    lines: products
      .map((product_id, i) => ({
        product_id,
        quantity: quantities[i] ?? "",
        unit_price: prices[i] ?? "",
        discount_percent: discounts[i] ?? "",
      }))
      // Rows that were added but never filled in are ignored.
      .filter((l) => l.product_id || l.quantity || l.unit_price),
  };
}

/** Line amounts exactly as the database computes them (round each part to cents). */
export function lineAmounts(quantity: number, unitPrice: number, discountPercent: number) {
  const gross = Math.round(quantity * unitPrice * 100) / 100;
  const discount = Math.round(quantity * unitPrice * discountPercent) / 100;
  return { gross, discount, total: Math.round((gross - discount) * 100) / 100 };
}

export function validateSalesOrder(values: SalesOrderFormValues, today: string): SalesOrderValidation {
  const errors: SalesOrderFieldErrors = {};

  if (!isUuid(values.customer_id)) errors.customer_id = "Choose a customer.";
  if (!isUuid(values.warehouse_id)) errors.warehouse_id = "Choose a warehouse.";
  if (!DATE_PATTERN.test(values.order_date)) errors.order_date = "Enter the order date.";
  else if (values.order_date > today) errors.order_date = "Order date cannot be in the future.";
  if (values.requested_delivery_date !== "") {
    if (!DATE_PATTERN.test(values.requested_delivery_date)) errors.requested_delivery_date = "Enter a valid date.";
    else if (values.requested_delivery_date < values.order_date) {
      errors.requested_delivery_date = "Requested delivery cannot be before the order date.";
    }
  }
  if (values.notes.length > 2000) errors.notes = "Notes must be 2,000 characters or fewer.";

  if (values.lines.length === 0) errors.lines = "Add at least one line.";
  else if (values.lines.length > MAX_SO_LINES) errors.lines = `A sales order can have at most ${MAX_SO_LINES} lines.`;

  const lineErrors: Record<number, SalesLineFieldErrors> = {};
  const seen = new Set<string>();
  values.lines.forEach((line, i) => {
    const e: SalesLineFieldErrors = {};
    if (!isUuid(line.product_id)) e.product_id = "Choose a product.";
    else if (seen.has(line.product_id)) e.product_id = "This product is already on another line.";
    seen.add(line.product_id);
    if (!QUANTITY_PATTERN.test(line.quantity) || Number(line.quantity) < 1) e.quantity = "Whole number, 1 or more.";
    if (!MONEY_PATTERN.test(line.unit_price)) e.unit_price = "0 or more, up to 2 decimals.";
    const discount = line.discount_percent === "" ? "0" : line.discount_percent;
    if (!PERCENT_PATTERN.test(discount) || Number(discount) > 100) e.discount_percent = "0 to 100.";
    if (Object.keys(e).length > 0) lineErrors[i] = e;
  });
  if (Object.keys(lineErrors).length > 0) errors.lineErrors = lineErrors;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      customer_id: values.customer_id,
      warehouse_id: values.warehouse_id,
      order_date: values.order_date,
      requested_delivery_date: values.requested_delivery_date || null,
      notes: values.notes || null,
      items: values.lines.map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        discount_percent: l.discount_percent === "" ? 0 : Number(l.discount_percent),
      })),
    },
  };
}
