"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setProductActive } from "@/lib/actions/products";
import { formatNumber } from "@/lib/format";

/**
 * Deactivate / reactivate with an inline confirmation step.
 * Deactivated products keep their history and stock but cannot receive new stock.
 */
export function ProductStatusActions({
  productId,
  isActive,
  quantityOnHand,
}: {
  productId: string;
  isActive: boolean;
  quantityOnHand: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function apply(active: boolean) {
    startTransition(async () => {
      const result = await setProductActive(productId, active);
      setConfirming(false);
      if (result.ok) toast({ title: active ? "Product reactivated" : "Product deactivated", variant: "success" });
      else toast({ title: "Could not update the product", description: result.error, variant: "error" });
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
    <div role="group" aria-label="Confirm deactivation" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-sm text-amber-900">
        {quantityOnHand > 0
          ? `${formatNumber(quantityOnHand)} units are still in stock. They can be shipped or written off, but no new stock can be received.`
          : "The product will be hidden from active lists. History is kept."}
      </p>
      <Button size="sm" variant="danger" loading={pending} onClick={() => apply(false)}>
        Deactivate
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
