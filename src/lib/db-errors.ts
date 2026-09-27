/**
 * Turns PostgreSQL / PostgREST errors into messages a warehouse user can act on.
 * Messages raised by our own functions are already written for users, so they
 * are passed through; constraint violations get a friendlier wording.
 */

export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
}

/** SQLSTATEs raised on purpose by the inventory engine and triggers (see migration 0700). */
const USER_FACING_CODES = new Set([
  "SF001", "SF002", "SF003", "SF004", "SF005", "SF006", "SF007", "SF008", "SF009", "SF010",
  "22023", "P0002", "23503", "42501",
]);

const CONSTRAINT_MESSAGES: Record<string, string> = {
  products_sku_key: "A product with this SKU already exists.",
  products_barcode_key: "Another product already uses this barcode.",
  products_sku_check: "SKU must be 3-32 characters: capital letters, digits and dashes, starting with a letter or digit.",
  products_barcode_check: "Barcode must be 8 to 14 digits.",
  products_name_check: "Name must be between 1 and 200 characters.",
  products_cost_price_check: "Cost price cannot be negative.",
  products_sale_price_check: "Sale price cannot be negative.",
  warehouses_code_key: "A warehouse with this code already exists.",
  warehouses_name_key: "A warehouse with this name already exists.",
  warehouses_code_check: "Code must be 2-20 characters: capital letters, digits and dashes.",
  warehouses_name_check: "Name must be between 1 and 150 characters.",
  warehouses_warehouse_type_check: "Choose a valid warehouse type.",
  suppliers_code_key: "A supplier with this code already exists.",
  suppliers_name_key: "A supplier with this name already exists.",
  suppliers_tax_id_key: "Another supplier already uses this tax id.",
  suppliers_code_check: "Code must be 2-20 characters: capital letters, digits and dashes.",
  suppliers_email_check: "Enter a valid email address.",
  suppliers_payment_terms_days_check: "Payment terms must be between 0 and 365 days.",
  suppliers_lead_time_days_check: "Lead time must be between 0 and 365 days.",
  customers_code_key: "A customer with this code already exists.",
  customers_name_key: "A customer with this name already exists.",
  customers_tax_id_key: "Another customer already uses this tax id.",
  customers_code_check: "Code must be 2-20 characters: capital letters, digits and dashes.",
  customers_email_check: "Enter a valid email address.",
  customers_customer_type_check: "Choose a valid customer type.",
  customers_credit_limit_check: "Credit limit cannot be negative.",
  customers_payment_terms_days_check: "Payment terms must be between 0 and 365 days.",
};

export function describeDbError(error: DbError, fallback = "The operation could not be completed."): string {
  if (error.code === "42501" && /permission denied|row-level security/i.test(error.message)) {
    return "You do not have permission to perform this action.";
  }
  if (error.code && USER_FACING_CODES.has(error.code)) return error.message;

  const text = `${error.message} ${error.details ?? ""}`;
  for (const [constraint, message] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (text.includes(constraint)) return message;
  }
  if (error.code === "23505") return "This record already exists.";
  if (error.code === "23514") return "One of the values is not allowed.";
  return fallback;
}
