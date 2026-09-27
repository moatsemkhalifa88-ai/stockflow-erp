import type { BadgeTone } from "@/components/ui/badge";
import type { AppRole } from "@/lib/auth/roles";
import { Constants, type Enums } from "@/types/database";

/**
 * Sales order and stock transfer vocabulary, and which workflow actions the UI
 * offers per role and status. The database functions enforce the same rules.
 */

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------
export type SalesOrderStatus = Enums<"sales_order_status">;
export const SALES_ORDER_STATUSES: readonly SalesOrderStatus[] = Constants.public.Enums.sales_order_status;

export const SO_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SO_STATUS_TONES: Record<SalesOrderStatus, BadgeTone> = {
  DRAFT: "neutral",
  CONFIRMED: "info",
  PROCESSING: "warning",
  SHIPPED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export type SalesOrderAction = "edit" | "confirm" | "process" | "ship" | "complete" | "reverse" | "cancel";

const SO_ACTION_ROLES: Record<SalesOrderAction, readonly AppRole[]> = {
  edit: ["admin", "sales"],
  confirm: ["admin", "sales"],
  process: ["admin", "warehouse_manager"],
  ship: ["admin", "warehouse_manager"],
  complete: ["admin", "sales", "warehouse_manager"],
  reverse: ["admin", "warehouse_manager"],
  cancel: ["admin", "sales"],
};

const SO_ACTION_STATUSES: Record<SalesOrderAction, readonly SalesOrderStatus[]> = {
  edit: ["DRAFT"],
  confirm: ["DRAFT"],
  process: ["CONFIRMED"],
  ship: ["PROCESSING"],
  complete: ["SHIPPED"],
  reverse: ["SHIPPED"],
  cancel: ["DRAFT", "CONFIRMED", "PROCESSING"],
};

/** Mirrors the role and status checks in the sales order RPCs (migration 12). */
export function canPerformSalesAction(action: SalesOrderAction, role: AppRole, status: SalesOrderStatus): boolean {
  return SO_ACTION_ROLES[action].includes(role) && SO_ACTION_STATUSES[action].includes(status);
}

export function allowedSalesActions(role: AppRole, status: SalesOrderStatus): SalesOrderAction[] {
  return (Object.keys(SO_ACTION_ROLES) as SalesOrderAction[]).filter((a) => canPerformSalesAction(a, role, status));
}

// ---------------------------------------------------------------------------
// Stock transfers
// ---------------------------------------------------------------------------
export type TransferStatus = Enums<"transfer_status">;
export const TRANSFER_STATUSES: readonly TransferStatus[] = Constants.public.Enums.transfer_status;

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const TRANSFER_STATUS_TONES: Record<TransferStatus, BadgeTone> = {
  REQUESTED: "neutral",
  APPROVED: "info",
  COMPLETED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
};

export type TransferAction = "approve" | "reject" | "execute" | "cancel";

const TRANSFER_ACTION_ROLES: Record<TransferAction, readonly AppRole[]> = {
  approve: ["admin"],
  reject: ["admin"],
  execute: ["admin", "warehouse_manager"],
  cancel: ["admin", "warehouse_manager"],
};

const TRANSFER_ACTION_STATUSES: Record<TransferAction, readonly TransferStatus[]> = {
  approve: ["REQUESTED"],
  reject: ["REQUESTED"],
  execute: ["APPROVED"],
  cancel: ["REQUESTED", "APPROVED"],
};

/** Mirrors the role and status checks in the transfer RPCs (migration 13). */
export function allowedTransferActions(role: AppRole, status: TransferStatus): TransferAction[] {
  return (Object.keys(TRANSFER_ACTION_ROLES) as TransferAction[]).filter(
    (a) => TRANSFER_ACTION_ROLES[a].includes(role) && TRANSFER_ACTION_STATUSES[a].includes(status),
  );
}

export const CUSTOMER_TYPES = ["RETAIL", "WHOLESALE", "CORPORATE", "GOVERNMENT"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  RETAIL: "Retail",
  WHOLESALE: "Wholesale",
  CORPORATE: "Corporate",
  GOVERNMENT: "Government",
};

export function isCustomerType(value: string): value is CustomerType {
  return (CUSTOMER_TYPES as readonly string[]).includes(value);
}

export function customerTypeLabel(value: string): string {
  return isCustomerType(value) ? CUSTOMER_TYPE_LABELS[value] : value;
}
