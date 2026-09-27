import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Alert, AlertSeverity, AlertType } from "@/lib/data/analytics";

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  OUT_OF_STOCK: "Out of stock",
  LOW_STOCK: "Low stock",
  DELAYED_PO: "Delayed purchase order",
  UNPROCESSED_SO: "Unprocessed sales order",
  PENDING_PO_APPROVAL: "PO waiting for approval",
  PENDING_TRANSFER: "Pending transfer",
};

const SEVERITY: Record<AlertSeverity, { label: string; tone: BadgeTone; icon: typeof Info }> = {
  critical: { label: "Critical", tone: "danger", icon: AlertOctagon },
  warning: { label: "Warning", tone: "warning", icon: AlertTriangle },
  info: { label: "Info", tone: "info", icon: Info },
};

/** Icon + label + colour: severity never depends on colour alone. */
export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY[severity];
  return (
    <Badge tone={s.tone}>
      <s.icon aria-hidden className="size-3.5" />
      {s.label}
    </Badge>
  );
}

/** Where an alert is resolved. */
export function alertHref(alert: Alert): string {
  switch (alert.entityType) {
    case "inventory":
      return `/products/${alert.entityId}`;
    case "purchase_order":
      return `/purchase-orders/${alert.entityId}`;
    case "sales_order":
      return `/sales-orders/${alert.entityId}`;
    case "stock_transfer":
      return `/transfers/${alert.entityId}`;
    default:
      return "/alerts";
  }
}

export function AlertRow({ alert }: { alert: Alert }) {
  return (
    <li className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-28 shrink-0">
        <SeverityBadge severity={alert.severity} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <Link href={alertHref(alert)} className="font-medium text-slate-900 hover:underline">
            {ALERT_TYPE_LABELS[alert.type]}: <span className="font-mono text-xs">{alert.reference}</span>
          </Link>
          <span className="text-slate-500"> · {alert.title}</span>
        </p>
        <p className="truncate text-xs text-slate-500">{alert.detail}</p>
      </div>
      <p className="shrink-0 text-xs text-slate-500 tabular-nums">
        {alert.daysOpen > 0 ? `${alert.daysOpen} day${alert.daysOpen === 1 ? "" : "s"}` : "Today"}
      </p>
    </li>
  );
}
