"use client";

import { RotateCcw } from "lucide-react";
import { ReasonActionForm } from "@/components/ui/reason-action-form";
import { reverseMovement } from "@/lib/actions/movements";
import { formatNumber } from "@/lib/format";

/** Explains what the reversal posts, then requires a reason. */
export function ReverseMovementForm({
  movementId,
  movementNumber,
  quantityChange,
}: {
  movementId: string;
  movementNumber: string;
  quantityChange: number;
}) {
  const opposite = -quantityChange;
  return (
    <ReasonActionForm
      action={reverseMovement.bind(null, movementId)}
      idPrefix="reverse-movement"
      triggerLabel="Reverse movement"
      triggerIcon={RotateCcw}
      reasonLabel="Reason for reversal"
      placeholder="e.g. Posted to the wrong warehouse"
      submitLabel="Reverse"
      explanation={
        <p>
          This posts a new movement of{" "}
          <strong className="tabular-nums">
            {opposite > 0 ? "+" : ""}
            {formatNumber(opposite)}
          </strong>{" "}
          that cancels {movementNumber}. The original stays in the ledger unchanged.
        </p>
      }
    />
  );
}
