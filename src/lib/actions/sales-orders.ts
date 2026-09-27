"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageSalesOrders } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { describeDbError } from "@/lib/db-errors";
import { businessToday } from "@/lib/format";
import { isUuid } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import {
  readSalesOrderForm,
  validateSalesOrder,
  type SalesOrderFieldErrors,
  type SalesOrderFormValues,
} from "@/lib/validation/sales-order";
import { readReason, type ActionResult, type ReasonFormState } from "./types";

/*
 * Every sales order change goes through a PostgreSQL function (migration 12);
 * client writes to these tables are revoked. The functions check roles and
 * status transitions, post stock through the inventory engine and audit.
 */

export interface SalesOrderFormState {
  error?: string;
  fieldErrors?: SalesOrderFieldErrors;
  values?: SalesOrderFormValues;
}

const NO_PERMISSION = "You do not have permission to do this.";

function revalidateSales(soId?: string, customerId?: string): void {
  revalidatePath("/sales-orders");
  revalidatePath("/customers");
  if (soId) revalidatePath(`/sales-orders/${soId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

function revalidateStock(): void {
  for (const path of ["/movements", "/inventory", "/products", "/warehouses", "/dashboard"]) revalidatePath(path);
}

export async function createSalesOrder(_prev: SalesOrderFormState, formData: FormData): Promise<SalesOrderFormState> {
  const user = await getActiveUser();
  if (!user || !canManageSalesOrders(user.role)) return { error: NO_PERMISSION };

  const values = readSalesOrderForm(formData);
  const validation = validateSalesOrder(values, businessToday());
  if (!validation.ok) return { fieldErrors: validation.errors, values };
  const input = validation.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sales_order", {
    p_customer_id: input.customer_id,
    p_warehouse_id: input.warehouse_id,
    p_items: input.items.map((i) => ({ ...i })),
    p_order_date: input.order_date,
    p_requested_delivery_date: input.requested_delivery_date ?? undefined,
    p_notes: input.notes ?? undefined,
  });
  if (error) return { error: describeDbError(error, "The sales order could not be created."), values };

  let saved = "created";
  if (formData.get("intent") === "confirm") {
    const confirmed = await supabase.rpc("confirm_sales_order", { p_so_id: data.id });
    saved = confirmed.error ? "created-not-confirmed" : "confirmed";
  }

  revalidateSales(data.id, data.customer_id);
  redirect(`/sales-orders/${data.id}?saved=${saved}`);
}

export async function updateSalesOrder(
  soId: string,
  _prev: SalesOrderFormState,
  formData: FormData,
): Promise<SalesOrderFormState> {
  const user = await getActiveUser();
  if (!user || !canManageSalesOrders(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(soId)) return { error: "Unknown sales order." };

  const values = readSalesOrderForm(formData);
  const validation = validateSalesOrder(values, businessToday());
  if (!validation.ok) return { fieldErrors: validation.errors, values };
  const input = validation.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_sales_order", {
    p_so_id: soId,
    p_customer_id: input.customer_id,
    p_warehouse_id: input.warehouse_id,
    p_items: input.items.map((i) => ({ ...i })),
    p_order_date: input.order_date,
    p_requested_delivery_date: input.requested_delivery_date ?? undefined,
    p_notes: input.notes ?? undefined,
  });
  if (error) return { error: describeDbError(error, "The sales order could not be saved."), values };

  let saved = "updated";
  if (formData.get("intent") === "confirm") {
    const confirmed = await supabase.rpc("confirm_sales_order", { p_so_id: soId });
    saved = confirmed.error ? "updated-not-confirmed" : "confirmed";
  }

  revalidateSales(soId, data.customer_id);
  redirect(`/sales-orders/${soId}?saved=${saved}`);
}

type Step = "confirm_sales_order" | "start_processing_sales_order" | "ship_sales_order" | "complete_sales_order";

async function runStep(soId: string, fn: Step): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(soId)) return { ok: false, error: "Unknown sales order." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { p_so_id: soId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateSales(soId, data.customer_id);
  if (fn === "ship_sales_order") revalidateStock();
  return { ok: true };
}

export async function confirmSalesOrder(soId: string): Promise<ActionResult> {
  return runStep(soId, "confirm_sales_order");
}

export async function startProcessingSalesOrder(soId: string): Promise<ActionResult> {
  return runStep(soId, "start_processing_sales_order");
}

/** All-or-nothing: refused with a message naming every short product if stock is insufficient. */
export async function shipSalesOrder(soId: string): Promise<ActionResult> {
  return runStep(soId, "ship_sales_order");
}

export async function completeSalesOrder(soId: string): Promise<ActionResult> {
  return runStep(soId, "complete_sales_order");
}

/** Only while unshipped; never touches inventory. */
export async function cancelSalesOrder(soId: string, _prev: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const user = await getActiveUser();
  if (!user || !canManageSalesOrders(user.role)) return { error: NO_PERMISSION };
  if (!isUuid(soId)) return { error: "Unknown sales order." };
  const { reason, error: reasonError } = readReason(formData);
  if (reasonError) return { error: reasonError, reason };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_sales_order", { p_so_id: soId, p_reason: reason });
  if (error) return { error: describeDbError(error, "The sales order could not be cancelled."), reason };

  revalidateSales(soId, data.customer_id);
  redirect(`/sales-orders/${soId}?saved=cancelled`);
}

/** Puts the stock back through reverse_stock_movement and returns the order to Confirmed. */
export async function reverseSalesOrderShipment(
  soId: string,
  _prev: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const user = await getActiveUser();
  if (!user) return { error: NO_PERMISSION };
  if (!isUuid(soId)) return { error: "Unknown sales order." };
  const { reason, error: reasonError } = readReason(formData);
  if (reasonError) return { error: reasonError, reason };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_sales_order_shipment", { p_so_id: soId, p_reason: reason });
  if (error) return { error: describeDbError(error, "The shipment could not be reversed."), reason };

  revalidateSales(soId, data.customer_id);
  revalidateStock();
  redirect(`/sales-orders/${soId}?saved=reversed`);
}
