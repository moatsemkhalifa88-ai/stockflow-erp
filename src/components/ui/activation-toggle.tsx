"use client";

import { useState, useTransition } from "react";
import { Button } from "./button";
import { useToast } from "./toast";

export interface ActivationResult {
  ok: boolean;
  error?: string;
}

/**
 * Deactivate / reactivate a master-data record with an inline confirmation step.
 * Records are never deleted; `onChange` is a Server Action bound to the record id.
 */
export function ActivationToggle({
  isActive,
  onChange,
  entityLabel,
  deactivateWarning,
}: {
  isActive: boolean;
  onChange: (active: boolean) => Promise<ActivationResult>;
  /** e.g. "Product", used in messages. */
  entityLabel: string;
  /** Explains the consequences before the user confirms. */
  deactivateWarning: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function apply(active: boolean) {
    startTransition(async () => {
      const result = await onChange(active);
      setConfirming(false);
      if (result.ok) toast({ title: `${entityLabel} ${active ? "reactivated" : "deactivated"}`, variant: "success" });
      else toast({ title: `Could not update the ${entityLabel.toLowerCase()}`, description: result.error, variant: "error" });
    });
  }

  if (!isActive) {
    return (
      <Button variant="secondary" loading={pending} onClick={() => apply(true)}>
        Reactivate
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Deactivate
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Confirm deactivation"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
    >
      <p className="text-sm text-amber-900">{deactivateWarning}</p>
      <Button size="sm" variant="danger" loading={pending} onClick={() => apply(false)}>
        Deactivate
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
