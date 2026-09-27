"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canRequestTransfers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError } from "@/lib/db-errors";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readTransferForm,
  validateTransfer,
  type TransferFieldErrors,
  type TransferFormValues,
} from "@/lib/validation/transfer";
import { readReason, type ActionResult, type ReasonFormState } from "./types";

/* Transfers change only through the PostgreSQL functions of migration 13. */

export interface TransferFormState {
  error?: string;
  fieldErrors?: TransferFieldErrors;
  values?: TransferFormValues;
}

const NO_PERMISSION = "You do not have permission to do this.";

function revalidateTransfers(id?: string): void {
  revalidatePath("/transfers");
  if (id) revalidatePath(`/transfers/${id}`);
}

export async function requestTransfer(_prev: TransferFormState, formData: FormData): Promise<TransferFormState> {
  const user = await getActiveUser();
  if (!user || !canRequestTransfers(user.role)) return { error: NO_PERMISSION };

  const values = readTransferForm(formData);
  const validation = validateTransfer(values);
  if (!validation.ok) return { fieldErrors: validation.errors, values };
  const input = validation.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_stock_transfer", {
    p_source_warehouse_id: input.source_warehouse_id,
    p_destination_warehouse_id: input.destination_warehouse_id,
    p_items: input.items.map((i) => ({ ...i })),
    p_notes: input.notes ?? undefined,
  });
  if (error) return { error: describeDbError(error, "The transfer could not be requested."), values };

  revalidateTransfers(data.id);
  redirect(`/transfers/${data.id}?saved=requested`);
}

async function runStep(id: string, fn: "approve_stock_transfer" | "execute_stock_transfer"): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(id)) return { ok: false, error: "Unknown transfer." };

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_transfer_id: id });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateTransfers(id);
  if (fn === "execute_stock_transfer") {
    for (const path of ["/movements", "/inventory", "/products", "/warehouses", "/dashboard"]) revalidatePath(path);
  }
  return { ok: true };
}

/** Admin only - enforced by approve_stock_transfer. */
export async function approveTransfer(id: string): Promise<ActionResult> {
  return runStep(id, "approve_stock_transfer");
}

/** All-or-nothing: if the source is short on any line, nothing changes. */
export async function executeTransfer(id: string): Promise<ActionResult> {
  return runStep(id, "execute_stock_transfer");
}

async function withReason(
  id: string,
  fn: "reject_stock_transfer" | "cancel_stock_transfer",
  formData: FormData,
  saved: string,
): Promise<ReasonFormState> {
  const user = await getActiveUser();
  if (!user) return { error: NO_PERMISSION };
  if (!isUuid(id)) return { error: "Unknown transfer." };
  const { reason, error: reasonError } = readReason(formData);
  if (reasonError) return { error: reasonError, reason };

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_transfer_id: id, p_reason: reason });
  if (error) return { error: describeDbError(error), reason };

  revalidateTransfers(id);
  redirect(`/transfers/${id}?saved=${saved}`);
}

export async function rejectTransfer(id: string, _prev: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  return withReason(id, "reject_stock_transfer", formData, "rejected");
}

export async function cancelTransfer(id: string, _prev: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  return withReason(id, "cancel_stock_transfer", formData, "cancelled");
}
