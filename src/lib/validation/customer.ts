import { isCustomerType, type CustomerType } from "@/lib/sales";

/** Mirrors the CHECK constraints on public.customers so users get field-level errors first. */

export const CUSTOMER_FIELDS = [
  "code",
  "name",
  "customer_type",
  "contact_name",
  "email",
  "phone",
  "address_line",
  "city",
  "country",
  "tax_id",
  "credit_limit",
  "payment_terms_days",
  "notes",
] as const;

export type CustomerField = (typeof CUSTOMER_FIELDS)[number];
export type CustomerFieldErrors = Partial<Record<CustomerField, string>>;
export type CustomerFormValues = Record<CustomerField, string>;

export interface CustomerInput {
  code: string;
  name: string;
  customer_type: CustomerType;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  country: string;
  tax_id: string | null;
  credit_limit: number;
  payment_terms_days: number;
  notes: string | null;
}

export type CustomerValidation = { ok: true; value: CustomerInput } | { ok: false; errors: CustomerFieldErrors };

export const EMPTY_CUSTOMER: CustomerFormValues = {
  code: "",
  name: "",
  customer_type: "CORPORATE",
  contact_name: "",
  email: "",
  phone: "",
  address_line: "",
  city: "",
  country: "Israel",
  tax_id: "",
  credit_limit: "0",
  payment_terms_days: "30",
  notes: "",
};

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^[0-9+()\-\s]{6,30}$/;
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const DAYS_PATTERN = /^\d{1,3}$/;

export function readCustomerForm(formData: FormData): CustomerFormValues {
  const values = {} as CustomerFormValues;
  for (const field of CUSTOMER_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim() : "";
  }
  values.code = values.code.toUpperCase();
  values.email = values.email.toLowerCase();
  return values;
}

export function validateCustomer(values: CustomerFormValues): CustomerValidation {
  const errors: CustomerFieldErrors = {};
  const tooLong = (field: CustomerField, max: number, label: string) => {
    if (values[field].length > max) errors[field] = `${label} must be ${max} characters or fewer.`;
  };

  if (!CODE_PATTERN.test(values.code)) errors.code = "2-20 characters: capital letters, digits and dashes, e.g. CUS-031.";
  if (values.name.length === 0) errors.name = "Name is required.";
  tooLong("name", 200, "Name");
  if (!isCustomerType(values.customer_type)) errors.customer_type = "Choose a customer type.";
  tooLong("contact_name", 150, "Contact name");
  if (values.email !== "" && !EMAIL_PATTERN.test(values.email)) errors.email = "Enter a valid email address.";
  if (values.phone !== "" && !PHONE_PATTERN.test(values.phone)) errors.phone = "Enter a valid phone number.";
  tooLong("address_line", 200, "Address");
  tooLong("city", 100, "City");
  if (values.country.length === 0) errors.country = "Country is required.";
  tooLong("country", 100, "Country");
  tooLong("tax_id", 30, "Tax id");
  tooLong("notes", 2000, "Notes");
  if (!MONEY_PATTERN.test(values.credit_limit)) errors.credit_limit = "Enter an amount of 0 or more with up to 2 decimals.";
  if (!DAYS_PATTERN.test(values.payment_terms_days) || Number(values.payment_terms_days) > 365) {
    errors.payment_terms_days = "Payment terms must be 0 to 365 days.";
  }

  if (Object.keys(errors).length > 0 || !isCustomerType(values.customer_type)) return { ok: false, errors };

  const orNull = (v: string) => (v === "" ? null : v);
  return {
    ok: true,
    value: {
      code: values.code,
      name: values.name,
      customer_type: values.customer_type,
      contact_name: orNull(values.contact_name),
      email: orNull(values.email),
      phone: orNull(values.phone),
      address_line: orNull(values.address_line),
      city: orNull(values.city),
      country: values.country,
      tax_id: orNull(values.tax_id),
      credit_limit: Number(values.credit_limit),
      payment_terms_days: Number(values.payment_terms_days),
      notes: orNull(values.notes),
    },
  };
}
