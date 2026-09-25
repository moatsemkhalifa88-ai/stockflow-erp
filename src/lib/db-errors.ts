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
const USER_FACING_CODES = new Set(["SF001", "SF002", "SF003", "22023", "P0002", "23503", "42501"]);

const CONSTRAINT_MESSAGES: Record<string, string> = {
  products_sku_key: "A product with this SKU already exists.",
  products_barcode_key: "Another product already uses this barcode.",
  products_sku_check: "SKU must be 3-32 characters: capital letters, digits and dashes, starting with a letter or digit.",
  products_barcode_check: "Barcode must be 8 to 14 digits.",
  products_name_check: "Name must be between 1 and 200 characters.",
  products_cost_price_check: "Cost price cannot be negative.",
  products_sale_price_check: "Sale price cannot be negative.",
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
