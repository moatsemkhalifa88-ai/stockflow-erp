import { Badge } from "@/components/ui/badge";
import {
  SO_STATUS_LABELS,
  SO_STATUS_TONES,
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_TONES,
  type SalesOrderStatus,
  type TransferStatus,
} from "@/lib/sales";

export function SoStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <Badge tone={SO_STATUS_TONES[status]}>{SO_STATUS_LABELS[status]}</Badge>;
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <Badge tone={TRANSFER_STATUS_TONES[status]}>{TRANSFER_STATUS_LABELS[status]}</Badge>;
}
