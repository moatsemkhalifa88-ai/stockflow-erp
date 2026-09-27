"use client";

import { CheckCircle2, PackageCheck, Pencil, Send, XCircle } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { ReasonActionForm } from "@/components/ui/reason-action-form";
import { useToast } from "@/components/ui/toast";
import { approvePurchaseOrder, cancelPurchaseOrder, submitPurchaseOrder } from "@/lib/actions/purchase-orders";
import type { ActionResult } from "@/lib/actions/types";
import type { PurchaseOrderAction } from "@/lib/purchasing";

/**
 * The next steps this user may take on this order. Which buttons appear is
 * decided on the server (lib/purchasing canPerform); the RPCs enforce it again.
 */
export function PoWorkflowActions({
  poId,
  poNumber,
  actions,
}: {
  poId: string;
  poNumber: string;
  actions: PurchaseOrderAction[];
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const can = (a: PurchaseOrderAction) => actions.includes(a);

  function run(step: (id: string) => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await step(poId);
      if (result.ok) toast({ title: success, description: poNumber, variant: "success" });
      else toast({ title: "Action failed", description: result.error, variant: "error" });
    });
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {can("edit") && (
        <LinkButton href={`/purchase-orders/${poId}/edit`} variant="secondary">
          <Pencil aria-hidden className="size-4" />
          Edit
        </LinkButton>
      )}
      {can("submit") && (
        <Button loading={pending} onClick={() => run(submitPurchaseOrder, "Submitted for approval")}>
          <Send aria-hidden className="size-4" />
          Submit for approval
        </Button>
      )}
      {can("approve") && (
        <Button loading={pending} onClick={() => run(approvePurchaseOrder, "Purchase order approved")}>
          <CheckCircle2 aria-hidden className="size-4" />
          Approve
        </Button>
      )}
      {can("receive") && (
        <LinkButton href={`/purchase-orders/${poId}/receive`}>
          <PackageCheck aria-hidden className="size-4" />
          Receive goods
        </LinkButton>
      )}
      {can("cancel") && (
        <ReasonActionForm
          action={cancelPurchaseOrder.bind(null, poId)}
          idPrefix="cancel-po"
          triggerLabel="Cancel order"
          triggerIcon={XCircle}
          reasonLabel="Reason for cancelling"
          placeholder="e.g. Supplier cannot deliver on time"
          submitLabel="Cancel order"
          explanation={<p>Nothing has been received, so cancelling does not change any stock. This cannot be undone.</p>}
        />
      )}
    </div>
  );
}
