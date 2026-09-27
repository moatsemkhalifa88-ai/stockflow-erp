"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TextareaField } from "@/components/ui/textarea-field";
import type { ReceiptFormState } from "@/lib/actions/purchase-orders";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export interface ReceivableLine {
  id: string;
  lineNumber: number;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  quantityReceived: number;
  outstanding: number;
}

/**
 * Receive against an approved order. Quantities default to what is still
 * outstanding; enter less for a partial delivery or 0 to skip a line.
 */
export function ReceiveForm({
  action,
  lines,
  cancelHref,
  warehouseLabel,
}: {
  action: (state: ReceiptFormState, formData: FormData) => Promise<ReceiptFormState>;
  lines: ReceivableLine[];
  cancelHref: string;
  warehouseLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const open = lines.filter((l) => l.outstanding > 0);

  return (
    <form action={formAction} noValidate className="space-y-6" key={JSON.stringify(state.quantities ?? {})}>
      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <Card>
        <CardHeader
          title="Quantities received"
          description={`Stock is added to ${warehouseLabel}. Receiving more than is outstanding is refused.`}
        />
        <Table caption="Lines to receive">
          <THead>
            <Th>Line</Th>
            <Th>Product</Th>
            <Th align="right">Ordered</Th>
            <Th align="right">Received so far</Th>
            <Th align="right">Outstanding</Th>
            <Th align="right">Receive now</Th>
          </THead>
          <TBody>
            {open.map((line) => {
              const error = state.lineErrors?.[line.id];
              const inputId = `receive-${line.id}`;
              return (
                <Tr key={line.id}>
                  <Td className="text-slate-500">{line.lineNumber}</Td>
                  <Td className="max-w-72">
                    <p className="truncate font-medium text-slate-900">{line.productName}</p>
                    <p className="font-mono text-xs text-slate-500">{line.sku}</p>
                  </Td>
                  <Td align="right" className="tabular-nums">{formatNumber(line.quantityOrdered)}</Td>
                  <Td align="right" className="tabular-nums">{formatNumber(line.quantityReceived)}</Td>
                  <Td align="right" className="font-medium tabular-nums">{formatNumber(line.outstanding)}</Td>
                  <Td align="right">
                    <input type="hidden" name="line_id" value={line.id} />
                    <label htmlFor={inputId} className="sr-only">
                      Receive now for line {line.lineNumber}
                    </label>
                    <input
                      id={inputId}
                      name="line_quantity"
                      type="number"
                      min={0}
                      max={line.outstanding}
                      step={1}
                      inputMode="numeric"
                      defaultValue={state.quantities?.[line.id] ?? String(line.outstanding)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${inputId}-error` : undefined}
                      className={cn(
                        "h-9 w-24 rounded-lg border bg-white px-2 text-right text-sm tabular-nums shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none",
                        error ? "border-red-400" : "border-slate-300",
                      )}
                    />
                    <span className="ml-1 text-xs text-slate-400">{line.unitOfMeasure}</span>
                    {error && (
                      <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600">
                        {error}
                      </p>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
        <CardBody>
          <TextareaField
            id="notes"
            name="notes"
            label="Notes (optional)"
            rows={2}
            placeholder="e.g. Delivery note DN-4471, one carton damaged"
            defaultValue={state.notes}
          />
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={pending}>
          Post goods receipt
        </Button>
      </div>
    </form>
  );
}
