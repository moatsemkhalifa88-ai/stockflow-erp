"use client";

import { CheckCircle2, PlayCircle, XCircle } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ReasonActionForm } from "@/components/ui/reason-action-form";
import { useToast } from "@/components/ui/toast";
import { approveTransfer, cancelTransfer, executeTransfer, rejectTransfer } from "@/lib/actions/transfers";
import type { ActionResult } from "@/lib/actions/types";
import type { TransferAction } from "@/lib/sales";

export function TransferWorkflowActions({
  transferId,
  transferNumber,
  actions,
}: {
  transferId: string;
  transferNumber: string;
  actions: TransferAction[];
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const can = (a: TransferAction) => actions.includes(a);

  function run(step: (id: string) => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await step(transferId);
      if (result.ok) toast({ title: success, description: transferNumber, variant: "success" });
      else toast({ title: "Action failed", description: result.error, variant: "error" });
    });
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {can("approve") && (
        <Button loading={pending} onClick={() => run(approveTransfer, "Transfer approved")}>
          <CheckCircle2 aria-hidden className="size-4" />
          Approve
        </Button>
      )}
      {can("execute") && (
        <Button loading={pending} onClick={() => run(executeTransfer, "Transfer executed")}>
          <PlayCircle aria-hidden className="size-4" />
          Execute transfer
        </Button>
      )}
      {can("reject") && (
        <ReasonActionForm
          action={rejectTransfer.bind(null, transferId)}
          idPrefix="reject-transfer"
          triggerLabel="Reject"
          triggerIcon={XCircle}
          reasonLabel="Reason for rejecting"
          placeholder="e.g. Destination has enough stock"
          submitLabel="Reject transfer"
          explanation={<p>The request is closed without moving any stock.</p>}
        />
      )}
      {can("cancel") && (
        <ReasonActionForm
          action={cancelTransfer.bind(null, transferId)}
          idPrefix="cancel-transfer"
          triggerLabel="Cancel"
          triggerIcon={XCircle}
          reasonLabel="Reason for cancelling"
          placeholder="e.g. Truck not available"
          submitLabel="Cancel transfer"
          explanation={<p>The transfer has not been executed, so no stock changes.</p>}
        />
      )}
    </div>
  );
}
