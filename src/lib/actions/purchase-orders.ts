"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManagePurchaseOrders, canReceiveGoods } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError } from "@/lib/db-errors";
import { businessToday } from "@/lib/format";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readPurchaseOrderForm,
  validatePurchaseOrder,
  validateReceipt,
  type PurchaseOrderFieldErrors,
  type PurchaseOrderFormValues,
} from "@/lib/validation/purchase-order";
import { readReason, type ActionResult, type ReasonFormState } from "./types";

/*
 * Every purchase order and goods receipt change goes through a PostgreSQL
 * function (migration 10); client writes to these tables are revoked. The
 * functions check roles and status transitions and write the audit log.
 */

export interface PurchaseOrderFormState {
  error?: string;
  fieldErrors?: PurchaseOrderFieldErrors;
  values?: PurchaseOrderFormValues;
}

export interface ReceiptFormState {
  error?: string;
  lineErrors?: Record<string, string>;
  /** Echo of the quantities typed, keyed by line id. */
  quantities?: Record<string, string>;
  notes?: string;
}

const NO_PERMISSION = "You do not have permission to do this.";

function revalidatePurchasing(poId?: string, supplierId?: string): void {
  revalidatePath("/purchase-orders");
  revalidatePath("/suppliers");
  if (poId) revalidatePath(`/purchase-orders/${poId}`);
  if (supplierId) revalidatePath(`/suppliers/${supplierId}`);
}

function revalidateStock(): void {
  for (const path of ["/goods-receipts", "/movements", "/inventory", "/products", "/warehouses", "/dashboard"]) {
    revalidatePath(path);
  }
}

/** Draft, then optionally submit in the same request ("Save and submit"). */
export async function createPurchaseOrder(
  _prev: PurchaseOrderFormState,
  formData: FormData,
): Promise<PurchaseOrderFormState> {
  const user = await getActiveUser();
  if (!user || !canManagePurchaseOrders(user.role)) return { error: NO_PERMISSION };

  const values = readPurchaseOrderForm(formData);
  const validation = validatePurchaseOrder(values, businessToday());
  if (!validation.ok) return { fieldErrors: validation.errors, values };
  const input = validation.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: input.supplier_id,
    p_warehouse_id: input.warehouse_id,
    p_items: input.items,
    p_order_date: input.order_date,
    p_expected_delivery_date: input.expected_delivery_date ?? undefined,
    p_notes: input.notes ?? undefined,
  });
  if (error) return { error: describeDbError(error, "The purchase order could not be created."), values };

  let saved = "created";
  if (formData.get("intent") === "submit") {
    const submitted = await supabase.rpc("submit_purchase_order", { p_po_id: data.id });
    saved = submitted.error ? "created-not-submitted" : "submitted";
  }

  revalidatePurchasing(data.id, data.supplier_id);
  redirect(`/purchase-orders/${data.id}?saved=${saved}`);
}

export async function updatePurchaseOrder(
  poId: string,
  _prev: PurchaseOrderFormState,
  formData: FormData,
): Promise<PurchaseOrderFormState> {
  const user = await getActiveUser();
  if (!user || !canManagePurchaseOrders(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(poId)) return { error: "Unknown purchase order." };

  const values = readPurchaseOrderForm(formData);
  const validation = validatePurchaseOrder(values, businessToday());
  if (!validation.ok) return { fieldErrors: validation.errors, values };
  const input = validation.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_purchase_order", {
    p_po_id: poId,
    p_supplier_id: input.supplier_id,
    p_warehouse_id: input.warehouse_id,
    p_items: input.items,
    p_order_date: input.order_date,
    p_expected_delivery_date: input.expected_delivery_date ?? undefined,
    p_notes: input.notes ?? undefined,
  });
  if (error) return { error: describeDbError(error, "The purchase order could not be saved."), values };

  let saved = "updated";
  if (formData.get("intent") === "submit") {
    const submitted = await supabase.rpc("submit_purchase_order", { p_po_id: poId });
    saved = submitted.error ? "updated-not-submitted" : "submitted";
  }

  revalidatePurchasing(poId, data.supplier_id);
  redirect(`/purchase-orders/${poId}?saved=${saved}`);
}

async function runStep(poId: string, fn: "submit_purchase_order" | "approve_purchase_order"): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(poId)) return { ok: false, error: "Unknown purchase order." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { p_po_id: poId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePurchasing(poId, data.supplier_id);
  return { ok: true };
}

export async function submitPurchaseOrder(poId: string): Promise<ActionResult> {
  return runStep(poId, "submit_purchase_order");
}

/** Admin only - enforced by approve_purchase_order. */
export async function approvePurchaseOrder(poId: string): Promise<ActionResult> {
  return runStep(poId, "approve_purchase_order");
}

/** Only while nothing has been received; never touches inventory. */
export async function cancelPurchaseOrder(poId: string, _prev: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const user = await getActiveUser();
  if (!user || !canManagePurchaseOrders(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(poId)) return { error: "Unknown purchase order." };
  const { reason, error: reasonError } = readReason(formData);
  if (reasonError) return { error: reasonError, reason };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_purchase_order", { p_po_id: poId, p_reason: reason });
  if (error) return { error: describeDbError(error, "The purchase order could not be cancelled."), reason };

  revalidatePurchasing(poId, data.supplier_id);
  redirect(`/purchase-orders/${poId}?saved=cancelled`);
}

/** Posts a goods receipt: one PURCHASE_RECEIPT movement per line, all in one transaction. */
export async function receiveGoods(poId: string, _prev: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  const user = await getActiveUser();
  if (!user || !canReceiveGoods(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(poId)) return { error: "Unknown purchase order." };

  const ids = formData.getAll("line_id").map(String);
  const typed = formData.getAll("line_quantity").map(String);
  const quantities = Object.fromEntries(ids.map((id, i) => [id, typed[i] ?? ""]));
  const rawNotes = formData.get("notes");
  const notes = typeof rawNotes === "string" ? rawNotes.trim() : "";
  if (notes.length > 2000) return { error: "Notes must be 2,000 characters or fewer.", quantities, notes };

  const supabase = await createClient();
  const lines = await supabase
    .from("purchase_order_items")
    .select("id, quantity_ordered, quantity_received")
    .eq("purchase_order_id", poId);
  if (lines.error) return { error: describeDbError(lines.error), quantities, notes };
  const outstanding = new Map(lines.data.map((l) => [l.id, l.quantity_ordered - l.quantity_received]));

  const validation = validateReceipt(formData, outstanding);
  if (!validation.ok) return { error: validation.error, lineErrors: validation.lineErrors, quantities, notes };

  const { data, error } = await supabase.rpc("receive_goods", {
    p_po_id: poId,
    p_items: validation.items.map((i) => ({ purchase_order_item_id: i.purchase_order_item_id, quantity: i.quantity })),
    p_notes: notes || undefined,
  });
  // Another receipt may have been posted since the form loaded; the database has the final say.
  if (error) return { error: describeDbError(error, "The goods receipt could not be posted."), quantities, notes };

  revalidatePurchasing(poId);
  revalidateStock();
  redirect(`/goods-receipts/${data.id}?saved=received`);
}

/** Undoes a whole receipt through reverse_stock_movement; rejected if the stock was already used. */
export async function reverseGoodsReceipt(
  receiptId: string,
  _prev: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const user = await getActiveUser();
  if (!user || !canReceiveGoods(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(receiptId)) return { error: "Unknown goods receipt." };
  const { reason, error: reasonError } = readReason(formData);
  if (reasonError) return { error: reasonError, reason };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_goods_receipt", { p_goods_receipt_id: receiptId, p_reason: reason });
  if (error) return { error: describeDbError(error, "The goods receipt could not be reversed."), reason };

  revalidatePurchasing(data.purchase_order_id);
  revalidateStock();
  revalidatePath(`/goods-receipts/${receiptId}`);
  redirect(`/goods-receipts/${receiptId}?saved=reversed`);
}
