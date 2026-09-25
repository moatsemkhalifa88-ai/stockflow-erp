import { ArrowDownLeft, ArrowUpRight, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MOVEMENT_TYPE_LABELS, type MovementType } from "@/lib/inventory";

/** Movement type with an in / out arrow. Reversals are marked separately. */
export function MovementTypeBadge({
  type,
  direction,
  isReversal = false,
}: {
  type: MovementType;
  direction: number;
  isReversal?: boolean;
}) {
  const Icon = isReversal ? RotateCcw : direction > 0 ? ArrowDownLeft : ArrowUpRight;
  return (
    <Badge tone={isReversal ? "neutral" : direction > 0 ? "success" : "info"}>
      <Icon aria-hidden className="size-3.5" />
      {isReversal ? `Reversal · ${MOVEMENT_TYPE_LABELS[type]}` : MOVEMENT_TYPE_LABELS[type]}
    </Badge>
  );
}
