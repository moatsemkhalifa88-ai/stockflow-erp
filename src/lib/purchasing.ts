import type { BadgeTone } from "@/components/ui/badge";
import type { AppRole } from "@/lib/auth/roles";
import { Constants, type Enums } from "@/types/database";

/** Purchase order vocabulary and the workflow actions the UI offers. The database enforces the rules. */

export type PurchaseOrderStatus = Enums<"purchase_order_status">;
export const PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = Constants.public.Enums.purchase_order_status;

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const PO_STATUS_TONES: Record<PurchaseOrderStatus, BadgeTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "danger",
};

/** Open orders: waiting for approval or for goods. */
export const OUTSTANDING_STATUSES: readonly PurchaseOrderStatus[] = ["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"];

export type PurchaseOrderAction = "edit" | "submit" | "approve" | "receive" | "cancel";

const ACTION_ROLES: Record<PurchaseOrderAction, readonly AppRole[]> = {
  edit: ["admin", "purchasing"],
  submit: ["admin", "purchasing"],
  approve: ["admin"],
  receive: ["admin", "warehouse_manager"],
  cancel: ["admin", "purchasing"],
};

const ACTION_STATUSES: Record<PurchaseOrderAction, readonly PurchaseOrderStatus[]> = {
  edit: ["DRAFT"],
  submit: ["DRAFT"],
  approve: ["SUBMITTED"],
  receive: ["APPROVED", "PARTIALLY_RECEIVED"],
  // Only while nothing is received; APPROVED with received goods is impossible (status would be PARTIALLY_RECEIVED).
  cancel: ["DRAFT", "SUBMITTED", "APPROVED"],
};

/** Mirrors the role and status checks in the purchasing RPCs (migration 10). */
export function canPerform(action: PurchaseOrderAction, role: AppRole, status: PurchaseOrderStatus): boolean {
  return ACTION_ROLES[action].includes(role) && ACTION_STATUSES[action].includes(status);
}

export function allowedActions(role: AppRole, status: PurchaseOrderStatus): PurchaseOrderAction[] {
  return (Object.keys(ACTION_ROLES) as PurchaseOrderAction[]).filter((a) => canPerform(a, role, status));
}

export function isPurchaseOrderStatus(value: string): value is PurchaseOrderStatus {
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value);
}
