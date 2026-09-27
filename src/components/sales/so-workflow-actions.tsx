"use client";

import { CheckCircle2, ClipboardCheck, Pencil, PlayCircle, RotateCcw, Truck, XCircle } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { ReasonActionForm } from "@/components/ui/reason-action-form";
import { useToast } from "@/components/ui/toast";
import {
  cancelSalesOrder,
  completeSalesOrder,
  confirmSalesOrder,
  reverseSalesOrderShipment,
  shipSalesOrder,
  startProcessingSalesOrder,
} from "@/lib/actions/sales-orders";
import type { ActionResult } from "@/lib/actions/types";
import type { SalesOrderAction } from "@/lib/sales";

/** Next steps this user may take (decided on the server; the RPCs enforce them again). */
export function SoWorkflowActions({
  soId,
  soNumber,
  actions,
  shortLines,
}: {
  soId: string;
  soNumber: string;
  actions: SalesOrderAction[];
  /** Lines without enough stock right now; shipping will be refused while this is > 0. */
  shortLines: number;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const can = (a: SalesOrderAction) => actions.includes(a);

  function run(step: (id: string) => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await step(soId);
      if (result.ok) toast({ title: success, description: soNumber, variant: "success" });
      else toast({ title: "Action failed", description: result.error, variant: "error" });
    });
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {can("edit") && (
        <LinkButton href={`/sales-orders/${soId}/edit`} variant="secondary">
          <Pencil aria-hidden className="size-4" />
          Edit
        </LinkButton>
      )}
      {can("confirm") && (
        <Button loading={pending} onClick={() => run(confirmSalesOrder, "Order confirmed")}>
          <ClipboardCheck aria-hidden className="size-4" />
          Confirm order
        </Button>
      )}
      {can("process") && (
        <Button loading={pending} onClick={() => run(startProcessingSalesOrder, "Picking started")}>
          <PlayCircle aria-hidden className="size-4" />
          Start processing
        </Button>
      )}
      {can("ship") && (
        <Button
          loading={pending}
          onClick={() => run(shipSalesOrder, "Order shipped")}
          title={shortLines > 0 ? `${shortLines} line(s) are short on stock; shipping will be refused` : undefined}
        >
          <Truck aria-hidden className="size-4" />
          Ship order
        </Button>
      )}
      {can("complete") && (
        <Button loading={pending} onClick={() => run(completeSalesOrder, "Order completed")}>
          <CheckCircle2 aria-hidden className="size-4" />
          Mark completed
        </Button>
      )}
      {can("reverse") && (
        <ReasonActionForm
          action={reverseSalesOrderShipment.bind(null, soId)}
          idPrefix="reverse-shipment"
          triggerLabel="Reverse shipment"
          triggerIcon={RotateCcw}
          reasonLabel="Reason for reversal"
          placeholder="e.g. Customer refused the delivery"
          submitLabel="Reverse shipment"
          explanation={
            <p>
              Every shipped line is put back into stock with an opposite movement, and the order returns to Confirmed.
              It can then be shipped again or cancelled. The original movements stay in the ledger.
            </p>
          }
        />
      )}
      {can("cancel") && (
        <ReasonActionForm
          action={cancelSalesOrder.bind(null, soId)}
          idPrefix="cancel-so"
          triggerLabel="Cancel order"
          triggerIcon={XCircle}
          reasonLabel="Reason for cancelling"
          placeholder="e.g. Customer withdrew the order"
          submitLabel="Cancel order"
          explanation={<p>Nothing has shipped, so cancelling does not change any stock. This cannot be undone.</p>}
        />
      )}
    </div>
  );
}
