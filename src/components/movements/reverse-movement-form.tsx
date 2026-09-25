"use client";

import { RotateCcw } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { reverseMovement, type ReverseFormState } from "@/lib/actions/movements";
import { formatNumber } from "@/lib/format";

/** Two-step reversal: explain what will happen, then require a reason. */
export function ReverseMovementForm({
  movementId,
  movementNumber,
  quantityChange,
}: {
  movementId: string;
  movementNumber: string;
  quantityChange: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ReverseFormState, FormData>(
    reverseMovement.bind(null, movementId),
    {},
  );

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden className="size-4" />
        Reverse movement
      </Button>
    );
  }

  const opposite = -quantityChange;
  return (
    <form action={formAction} noValidate className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">
        This posts a new movement of{" "}
        <strong className="tabular-nums">
          {opposite > 0 ? "+" : ""}
          {formatNumber(opposite)}
        </strong>{" "}
        that cancels {movementNumber}. The original stays in the ledger unchanged.
      </p>
      <FormField
        id="reverse-reason"
        name="reason"
        label="Reason for reversal"
        defaultValue={state.reason}
        error={state.error}
        placeholder="e.g. Posted to the wrong warehouse"
        required
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={pending}>
          Reverse
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
