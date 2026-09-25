import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STOCK_STATUS_LABELS, STOCK_STATUS_TONES, type StockStatus } from "@/lib/inventory";

const ICONS = { IN_STOCK: CheckCircle2, LOW_STOCK: CircleAlert, OUT_OF_STOCK: CircleX } as const;

/** Colour plus icon plus text, so the status never depends on colour alone. */
export function StockStatusBadge({ status }: { status: StockStatus }) {
  const Icon = ICONS[status];
  return (
    <Badge tone={STOCK_STATUS_TONES[status]}>
      <Icon aria-hidden className="size-3.5" />
      {STOCK_STATUS_LABELS[status]}
    </Badge>
  );
}
