"use client";

import { RotateCcw, XCircle } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";
import type { ReasonFormState } from "@/lib/actions/types";
import { Button, type ButtonVariant } from "./button";
import { FormField } from "./form-field";

/**
 * Icons are chosen by name, not passed as components: this is a Client
 * Component, and Server Components can only pass it serializable props.
 */
const ICONS = { reverse: RotateCcw, cancel: XCircle } as const;
export type ReasonActionIcon = keyof typeof ICONS;

/**
 * Two-step destructive action (cancel, reverse): a button that opens an inline
 * form explaining the consequence and asking for a mandatory reason.
 * `action` is a Server Action bound to the record id.
 */
export function ReasonActionForm({
  action,
  triggerLabel,
  triggerIcon,
  triggerVariant = "secondary",
  explanation,
  reasonLabel,
  placeholder,
  submitLabel,
  idPrefix,
}: {
  action: (state: ReasonFormState, formData: FormData) => Promise<ReasonFormState>;
  triggerLabel: string;
  triggerIcon?: ReasonActionIcon;
  triggerVariant?: ButtonVariant;
  explanation: ReactNode;
  reasonLabel: string;
  placeholder?: string;
  submitLabel: string;
  /** Unique per page, for the input id. */
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const Icon = triggerIcon ? ICONS[triggerIcon] : null;

  if (!open) {
    return (
      <Button variant={triggerVariant} onClick={() => setOpen(true)}>
        {Icon && <Icon aria-hidden className="size-4" />}
        {triggerLabel}
      </Button>
    );
  }

  return (
    <form action={formAction} noValidate className="w-full space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm text-amber-900">{explanation}</div>
      <FormField
        id={`${idPrefix}-reason`}
        name="reason"
        label={reasonLabel}
        defaultValue={state.reason}
        error={state.error}
        placeholder={placeholder}
        required
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={pending}>
          {submitLabel}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}
