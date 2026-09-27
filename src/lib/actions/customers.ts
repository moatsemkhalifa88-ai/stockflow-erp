"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageCustomers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError, type DbError } from "@/lib/db-errors";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readCustomerForm,
  validateCustomer,
  type CustomerFieldErrors,
  type CustomerFormValues,
} from "@/lib/validation/customer";
import type { ActionResult } from "./types";

/* Customer changes are master-data writes checked by RLS and audited by the customers_audit trigger. */

export interface CustomerFormState {
  error?: string;
  fieldErrors?: CustomerFieldErrors;
  values?: CustomerFormValues;
}

const NO_PERMISSION = "You do not have permission to manage customers.";

function fieldErrorsFor(error: DbError, message: string): CustomerFieldErrors | undefined {
  const text = `${error.message} ${error.details ?? ""}`;
  if (text.includes("customers_code")) return { code: message };
  if (text.includes("customers_name")) return { name: message };
  if (text.includes("customers_tax_id")) return { tax_id: message };
  if (text.includes("customers_email")) return { email: message };
  if (text.includes("customers_credit_limit")) return { credit_limit: message };
  return undefined;
}

export async function createCustomer(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const user = await getActiveUser();
  if (!user || !canManageCustomers(user.role)) return { error: NO_PERMISSION };

  const values = readCustomerForm(formData);
  const validation = validateCustomer(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").insert(validation.value).select("id").single();
  if (error) {
    const message = describeDbError(error, "The customer could not be created.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }

  revalidatePath("/customers");
  redirect(`/customers/${data.id}?saved=created`);
}

export async function updateCustomer(
  customerId: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await getActiveUser();
  if (!user || !canManageCustomers(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(customerId)) return { error: "Unknown customer." };

  const values = readCustomerForm(formData);
  const validation = validateCustomer(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update(validation.value).eq("id", customerId).select("id");
  if (error) {
    const message = describeDbError(error, "The customer could not be saved.");
    return { error: message, fieldErrors: fieldErrorsFor(error, message), values };
  }
  if (data.length === 0) return { error: NO_PERMISSION, values };

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?saved=updated`);
}

/** Deactivate / reactivate. Customers are never deleted; inactive customers get no new orders. */
export async function setCustomerActive(customerId: string, active: boolean): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user || !canManageCustomers(user.role)) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(customerId)) return { ok: false, error: "Unknown customer." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update({ is_active: active }).eq("id", customerId).select("id");
  if (error) return { ok: false, error: describeDbError(error) };
  if (data.length === 0) return { ok: false, error: NO_PERMISSION };

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
