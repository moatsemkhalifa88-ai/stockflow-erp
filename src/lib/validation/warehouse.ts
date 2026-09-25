import { isUuid } from "@/lib/search-params";

/** Mirrors the CHECK constraints on public.warehouses so users get field-level errors first. */

export const WAREHOUSE_TYPES = ["MAIN", "REGIONAL", "DISTRIBUTION", "RETURNS"] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const WAREHOUSE_FIELDS = [
  "code",
  "name",
  "warehouse_type",
  "address_line",
  "city",
  "country",
  "phone",
  "manager_id",
] as const;

export type WarehouseField = (typeof WAREHOUSE_FIELDS)[number];
export type WarehouseFieldErrors = Partial<Record<WarehouseField, string>>;
export type WarehouseFormValues = Record<WarehouseField, string>;

export interface WarehouseInput {
  code: string;
  name: string;
  warehouse_type: WarehouseType;
  address_line: string | null;
  city: string;
  country: string;
  phone: string | null;
  manager_id: string | null;
}

export type WarehouseValidation =
  | { ok: true; value: WarehouseInput }
  | { ok: false; errors: WarehouseFieldErrors };

/** Defaults for the create form. */
export const EMPTY_WAREHOUSE: WarehouseFormValues = {
  code: "",
  name: "",
  warehouse_type: "REGIONAL",
  address_line: "",
  city: "",
  country: "Israel",
  phone: "",
  manager_id: "",
};

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const PHONE_PATTERN = /^[0-9+()\-\s]{6,30}$/;

export function readWarehouseForm(formData: FormData): WarehouseFormValues {
  const values = {} as WarehouseFormValues;
  for (const field of WAREHOUSE_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim() : "";
  }
  values.code = values.code.toUpperCase();
  return values;
}

function isWarehouseType(value: string): value is WarehouseType {
  return (WAREHOUSE_TYPES as readonly string[]).includes(value);
}

export function validateWarehouse(values: WarehouseFormValues): WarehouseValidation {
  const errors: WarehouseFieldErrors = {};

  if (!CODE_PATTERN.test(values.code)) {
    errors.code = "2-20 characters: capital letters, digits and dashes, e.g. WH-NTN.";
  }
  if (values.name.length === 0) errors.name = "Name is required.";
  else if (values.name.length > 150) errors.name = "Name must be 150 characters or fewer.";
  if (!isWarehouseType(values.warehouse_type)) errors.warehouse_type = "Choose a warehouse type.";
  if (values.address_line.length > 200) errors.address_line = "Address must be 200 characters or fewer.";
  if (values.city.length === 0) errors.city = "City is required.";
  else if (values.city.length > 100) errors.city = "City must be 100 characters or fewer.";
  if (values.country.length === 0) errors.country = "Country is required.";
  else if (values.country.length > 100) errors.country = "Country must be 100 characters or fewer.";
  if (values.phone !== "" && !PHONE_PATTERN.test(values.phone)) errors.phone = "Enter a valid phone number.";
  if (values.manager_id !== "" && !isUuid(values.manager_id)) errors.manager_id = "Choose a manager from the list.";

  if (Object.keys(errors).length > 0 || !isWarehouseType(values.warehouse_type)) return { ok: false, errors };

  return {
    ok: true,
    value: {
      code: values.code,
      name: values.name,
      warehouse_type: values.warehouse_type,
      address_line: values.address_line || null,
      city: values.city,
      country: values.country,
      phone: values.phone || null,
      manager_id: values.manager_id || null,
    },
  };
}
