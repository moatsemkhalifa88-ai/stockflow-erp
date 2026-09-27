/** Shapes shared by Server Actions and the client components that call them. */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** State of a "confirm with a reason" form (cancel, reverse). */
export interface ReasonFormState {
  error?: string;
  reason?: string;
}

export function readReason(formData: FormData): { reason: string; error?: string } {
  const raw = formData.get("reason");
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length === 0) return { reason, error: "A reason is required." };
  if (reason.length > 500) return { reason, error: "Reason must be 500 characters or fewer." };
  return { reason };
}
