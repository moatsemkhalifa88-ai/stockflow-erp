"use client";

import { AlertCircle, ArrowRight, Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField } from "@/components/ui/select-field";
import { TextareaField } from "@/components/ui/textarea-field";
import type { TransferFormState } from "@/lib/actions/transfers";
import type { TransferFieldErrors, TransferFormValues, TransferLineValues } from "@/lib/validation/transfer";

export interface TransferWarehouseChoice {
  id: string;
  label: string;
}

export interface TransferProductChoice {
  id: string;
  label: string;
}

/** Transfer request. Stock only moves when an approved transfer is executed. */
export function TransferForm({
  action,
  initialValues,
  warehouses,
  products,
}: {
  action: (state: TransferFormState, formData: FormData) => Promise<TransferFormState>;
  initialValues: TransferFormValues;
  warehouses: TransferWarehouseChoice[];
  products: TransferProductChoice[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initialValues;

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}
      <Body key={JSON.stringify(values)} values={values} errors={state.fieldErrors ?? {}} warehouses={warehouses} products={products} />
      <div className="flex justify-end gap-2">
        <LinkButton href="/transfers" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={pending}>
          Request transfer
        </Button>
      </div>
    </form>
  );
}

interface LineState extends TransferLineValues {
  key: number;
}

function Body({
  values,
  errors,
  warehouses,
  products,
}: {
  values: TransferFormValues;
  errors: TransferFieldErrors;
  warehouses: TransferWarehouseChoice[];
  products: TransferProductChoice[];
}) {
  const [lines, setLines] = useState<LineState[]>(() =>
    (values.lines.length > 0 ? values.lines : [{ product_id: "", quantity: "" }]).map((l, i) => ({ ...l, key: i })),
  );
  const [nextKey, setNextKey] = useState(lines.length);
  const used = new Set(lines.map((l) => l.product_id).filter(Boolean));
  const options = warehouses.map((w) => ({ value: w.id, label: w.label }));

  const update = (key: number, patch: Partial<TransferLineValues>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <>
      <Card>
        <CardHeader title="Route" description="Stock leaves the source and arrives at the destination in the same transaction." />
        <CardBody className="grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
          <SelectField
            id="source_warehouse_id"
            name="source_warehouse_id"
            label="From"
            placeholder="Source warehouse"
            options={options}
            defaultValue={values.source_warehouse_id}
            error={errors.source_warehouse_id}
            required
          />
          <ArrowRight aria-hidden className="hidden size-5 text-slate-400 sm:mt-9 sm:block" />
          <SelectField
            id="destination_warehouse_id"
            name="destination_warehouse_id"
            label="To"
            placeholder="Destination warehouse"
            options={options}
            defaultValue={values.destination_warehouse_id}
            error={errors.destination_warehouse_id}
            required
          />
          <div className="sm:col-span-3">
            <TextareaField id="notes" name="notes" label="Notes (optional)" rows={2} defaultValue={values.notes} error={errors.notes} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Products"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLines((current) => [...current, { key: nextKey, product_id: "", quantity: "" }]);
                setNextKey((k) => k + 1);
              }}
            >
              <Plus aria-hidden className="size-4" />
              Add line
            </Button>
          }
        />
        {errors.lines && (
          <p role="alert" className="px-5 pt-4 text-sm text-red-600">
            {errors.lines}
          </p>
        )}
        <CardBody className="space-y-4">
          {lines.map((line, index) => {
            const e = errors.lineErrors?.[index] ?? {};
            return (
              <fieldset key={line.key} className="grid gap-3 sm:grid-cols-12 sm:items-start">
                <legend className="sr-only">Line {index + 1}</legend>
                <div className="sm:col-span-8">
                  <SelectField
                    id={`line-${line.key}-product`}
                    name="line_product_id"
                    label={`Line ${index + 1} product`}
                    placeholder="Choose a product"
                    options={products.map((p) => ({ value: p.id, label: p.label, disabled: used.has(p.id) && p.id !== line.product_id }))}
                    value={line.product_id}
                    onChange={(ev) => update(line.key, { product_id: ev.target.value })}
                    error={e.product_id}
                  />
                </div>
                <div className="sm:col-span-3">
                  <FormField
                    id={`line-${line.key}-quantity`}
                    name="line_quantity"
                    label="Quantity"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(ev) => update(line.key, { quantity: ev.target.value })}
                    error={e.quantity}
                  />
                </div>
                <div className="flex sm:col-span-1 sm:justify-end sm:pt-7">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== line.key) : current))}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </fieldset>
            );
          })}
        </CardBody>
      </Card>
    </>
  );
}
