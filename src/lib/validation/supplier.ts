/** Mirrors the CHECK constraints on public.suppliers so users get field-level errors first. */

export const SUPPLIER_FIELDS = [
  "code",
  "name",
  "contact_name",
  "email",
  "phone",
  "address_line",
  "city",
  "country",
  "tax_id",
  "payment_terms_days",
  "lead_time_days",
  "notes",
] as const;

export type SupplierField = (typeof SUPPLIER_FIELDS)[number];
export type SupplierFieldErrors = Partial<Record<SupplierField, string>>;
export type SupplierFormValues = Record<SupplierField, string>;

export interface SupplierInput {
  code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  country: string;
  tax_id: string | null;
  payment_terms_days: number;
  lead_time_days: number;
  notes: string | null;
}

export type SupplierValidation = { ok: true; value: SupplierInput } | { ok: false; errors: SupplierFieldErrors };

export const EMPTY_SUPPLIER: SupplierFormValues = {
  code: "",
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  address_line: "",
  city: "",
  country: "Israel",
  tax_id: "",
  payment_terms_days: "30",
  lead_time_days: "7",
  notes: "",
};

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^[0-9+()\-\s]{6,30}$/;
const DAYS_PATTERN = /^\d{1,3}$/;

export function readSupplierForm(formData: FormData): SupplierFormValues {
  const values = {} as SupplierFormValues;
  for (const field of SUPPLIER_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim() : "";
  }
  values.code = values.code.toUpperCase();
  values.email = values.email.toLowerCase();
  return values;
}

function maxLength(errors: SupplierFieldErrors, values: SupplierFormValues, field: SupplierField, max: number, label: string) {
  if (values[field].length > max) errors[field] = `${label} must be ${max} characters or fewer.`;
}

export function validateSupplier(values: SupplierFormValues): SupplierValidation {
  const errors: SupplierFieldErrors = {};

  if (!CODE_PATTERN.test(values.code)) errors.code = "2-20 characters: capital letters, digits and dashes, e.g. SUP-011.";
  if (values.name.length === 0) errors.name = "Name is required.";
  maxLength(errors, values, "name", 200, "Name");
  maxLength(errors, values, "contact_name", 150, "Contact name");
  if (values.email !== "" && !EMAIL_PATTERN.test(values.email)) errors.email = "Enter a valid email address.";
  if (values.phone !== "" && !PHONE_PATTERN.test(values.phone)) errors.phone = "Enter a valid phone number.";
  maxLength(errors, values, "address_line", 200, "Address");
  maxLength(errors, values, "city", 100, "City");
  if (values.country.length === 0) errors.country = "Country is required.";
  maxLength(errors, values, "country", 100, "Country");
  maxLength(errors, values, "tax_id", 30, "Tax id");
  maxLength(errors, values, "notes", 2000, "Notes");
  for (const [field, label] of [
    ["payment_terms_days", "Payment terms"],
    ["lead_time_days", "Lead time"],
  ] as const) {
    if (!DAYS_PATTERN.test(values[field]) || Number(values[field]) > 365) errors[field] = `${label} must be 0 to 365 days.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const orNull = (v: string) => (v === "" ? null : v);
  return {
    ok: true,
    value: {
      code: values.code,
      name: values.name,
      contact_name: orNull(values.contact_name),
      email: orNull(values.email),
      phone: orNull(values.phone),
      address_line: orNull(values.address_line),
      city: orNull(values.city),
      country: values.country,
      tax_id: orNull(values.tax_id),
      payment_terms_days: Number(values.payment_terms_days),
      lead_time_days: Number(values.lead_time_days),
      notes: orNull(values.notes),
    },
  };
}
