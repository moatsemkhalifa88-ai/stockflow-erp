"use client";

import { AlertCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { createAdjustment, type AdjustmentFormState } from "@/lib/actions/movements";
import { cn } from "@/lib/cn";
import type { AdjustmentFormValues } from "@/lib/validation/movement";

const COMMON_REASONS = [
  "Cycle count correction",
  "Found during stock take",
  "Damaged in warehouse",
  "Expired",
  "Theft or loss",
  "Internal use",
  "Opening balance",
];

const TYPE_CHOICES = [
  { value: "ADJUSTMENT_IN", label: "Stock in", description: "Increase stock (found, count correction)", icon: ArrowDownLeft },
  { value: "ADJUSTMENT_OUT", label: "Stock out", description: "Decrease stock (damage, loss, write-off)", icon: ArrowUpRight },
] as const;

export function AdjustmentForm({
  products,
  warehouses,
  initialValues,
}: {
  products: SelectOption[];
  warehouses: SelectOption[];
  initialValues: AdjustmentFormValues;
}) {
  const [state, formAction, pending] = useActionState<AdjustmentFormState, FormData>(createAdjustment, {});
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="space-y-6" key={JSON.stringify(values)}>
      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <Card>
        <CardHeader
          title="Adjustment"
          description="Posted through the inventory engine: stock can never go below zero and every adjustment is audited."
        />
        <CardBody className="space-y-5">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Direction</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {TYPE_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/30",
                    errors.movement_type ? "border-red-400" : "border-slate-300",
                  )}
                >
                  <input
                    type="radio"
                    name="movement_type"
                    value={choice.value}
                    defaultChecked={values.movement_type === choice.value}
                    className="mt-1 accent-brand-600"
                    required
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                      <choice.icon aria-hidden className="size-4" />
                      {choice.label}
                    </span>
                    <span className="block text-xs text-slate-500">{choice.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.movement_type && <p className="mt-1.5 text-sm text-red-600">{errors.movement_type}</p>}
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id="product_id"
              name="product_id"
              label="Product"
              placeholder="Choose a product"
              options={products}
              defaultValue={values.product_id}
              error={errors.product_id}
              required
            />
            <SelectField
              id="warehouse_id"
              name="warehouse_id"
              label="Warehouse"
              placeholder="Choose a warehouse"
              options={warehouses}
              defaultValue={values.warehouse_id}
              error={errors.warehouse_id}
              required
            />
            <FormField
              id="quantity"
              name="quantity"
              label="Quantity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              defaultValue={values.quantity}
              error={errors.quantity}
              required
            />
            <FormField
              id="reference_number"
              name="reference_number"
              label="Reference (optional)"
              placeholder="e.g. count sheet CS-2026-041"
              defaultValue={values.reference_number}
              error={errors.reference_number}
            />
          </div>

          <div>
            <FormField
              id="reason"
              name="reason"
              label="Reason"
              list="adjustment-reasons"
              placeholder="Why is stock being adjusted?"
              defaultValue={values.reason}
              error={errors.reason}
              hint="Required. Shown in the ledger and the audit log."
              required
            />
            <datalist id="adjustment-reasons">
              {COMMON_REASONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>

          <TextareaField id="notes" name="notes" label="Notes (optional)" defaultValue={values.notes} error={errors.notes} />
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <LinkButton href="/movements" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={pending}>
          Post adjustment
        </Button>
      </div>
    </form>
  );
}
