import { UNITS_OF_MEASURE, type UnitOfMeasure } from "@/lib/inventory";
import { isUuid } from "@/lib/search-params";

/** Mirrors the CHECK constraints on public.products so users get field-level errors before the database does. */

export const PRODUCT_FIELDS = [
  "sku",
  "name",
  "description",
  "category_id",
  "unit_of_measure",
  "barcode",
  "cost_price",
  "sale_price",
  "min_stock_level",
  "reorder_quantity",
] as const;

export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductFieldErrors = Partial<Record<ProductField, string>>;
/** Raw form values, echoed back to the form when validation fails. */
export type ProductFormValues = Record<ProductField, string>;

/** Defaults for the create form. */
export const EMPTY_PRODUCT: ProductFormValues = {
  sku: "",
  name: "",
  description: "",
  category_id: "",
  unit_of_measure: "EA",
  barcode: "",
  cost_price: "0.00",
  sale_price: "0.00",
  min_stock_level: "0",
  reorder_quantity: "0",
};

export interface ProductInput {
  sku: string;
  name: string;
  description: string | null;
  category_id: string;
  unit_of_measure: UnitOfMeasure;
  barcode: string | null;
  cost_price: number;
  sale_price: number;
  min_stock_level: number;
  reorder_quantity: number;
}

export type ProductValidation =
  | { ok: true; value: ProductInput }
  | { ok: false; errors: ProductFieldErrors };

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const BARCODE_PATTERN = /^[0-9]{8,14}$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const INTEGER_PATTERN = /^\d{1,9}$/;

export function readProductForm(formData: FormData): ProductFormValues {
  const values = {} as ProductFormValues;
  for (const field of PRODUCT_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim() : "";
  }
  values.sku = values.sku.toUpperCase();
  return values;
}

export function validateProduct(values: ProductFormValues): ProductValidation {
  const errors: ProductFieldErrors = {};

  if (!SKU_PATTERN.test(values.sku)) {
    errors.sku = "3-32 characters: capital letters, digits and dashes, starting with a letter or digit.";
  }
  if (values.name.length === 0) errors.name = "Name is required.";
  else if (values.name.length > 200) errors.name = "Name must be 200 characters or fewer.";
  if (values.description.length > 2000) errors.description = "Description must be 2,000 characters or fewer.";
  if (!isUuid(values.category_id)) errors.category_id = "Choose a category.";
  if (!(UNITS_OF_MEASURE as readonly string[]).includes(values.unit_of_measure)) {
    errors.unit_of_measure = "Choose a unit of measure.";
  }
  if (values.barcode !== "" && !BARCODE_PATTERN.test(values.barcode)) errors.barcode = "Barcode must be 8 to 14 digits.";

  for (const field of ["cost_price", "sale_price"] as const) {
    if (!MONEY_PATTERN.test(values[field])) errors[field] = "Enter an amount of 0 or more with up to 2 decimals.";
  }
  for (const field of ["min_stock_level", "reorder_quantity"] as const) {
    if (!INTEGER_PATTERN.test(values[field])) errors[field] = "Enter a whole number of 0 or more.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      sku: values.sku,
      name: values.name,
      description: values.description || null,
      category_id: values.category_id,
      unit_of_measure: values.unit_of_measure as UnitOfMeasure,
      barcode: values.barcode || null,
      cost_price: Number(values.cost_price),
      sale_price: Number(values.sale_price),
      min_stock_level: Number(values.min_stock_level),
      reorder_quantity: Number(values.reorder_quantity),
    },
  };
}
