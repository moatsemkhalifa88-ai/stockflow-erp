import { Badge } from "@/components/ui/badge";
import { PO_STATUS_LABELS, PO_STATUS_TONES, type PurchaseOrderStatus } from "@/lib/purchasing";

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={PO_STATUS_TONES[status]}>{PO_STATUS_LABELS[status]}</Badge>;
}
