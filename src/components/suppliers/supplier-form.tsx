"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { TextareaField } from "@/components/ui/textarea-field";
import type { SupplierFormState } from "@/lib/actions/suppliers";
import type { SupplierFormValues } from "@/lib/validation/supplier";

/** Create / edit form. Status changes use the Deactivate / Reactivate control. */
export function SupplierForm({
  action,
  initialValues,
  cancelHref,
  submitLabel,
}: {
  action: (state: SupplierFormState, formData: FormData) => Promise<SupplierFormState>;
  initialValues: SupplierFormValues;
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
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
        <CardHeader title="Supplier" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="code"
            name="code"
            label="Code"
            defaultValue={values.code}
            error={errors.code}
            hint="e.g. SUP-011"
            className="font-mono uppercase"
            autoComplete="off"
            required
          />
          <FormField id="tax_id" name="tax_id" label="Tax id (optional)" defaultValue={values.tax_id} error={errors.tax_id} />
          <div className="sm:col-span-2">
            <FormField id="name" name="name" label="Company name" defaultValue={values.name} error={errors.name} required />
          </div>
          <FormField
            id="payment_terms_days"
            name="payment_terms_days"
            label="Payment terms (days)"
            inputMode="numeric"
            defaultValue={values.payment_terms_days}
            error={errors.payment_terms_days}
            required
          />
          <FormField
            id="lead_time_days"
            name="lead_time_days"
            label="Lead time (days)"
            inputMode="numeric"
            defaultValue={values.lead_time_days}
            error={errors.lead_time_days}
            hint="Used to suggest the expected delivery date on new orders."
            required
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact and address" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="contact_name"
            name="contact_name"
            label="Contact person (optional)"
            defaultValue={values.contact_name}
            error={errors.contact_name}
          />
          <FormField
            id="email"
            name="email"
            type="email"
            label="Email (optional)"
            defaultValue={values.email}
            error={errors.email}
            autoComplete="off"
          />
          <FormField id="phone" name="phone" type="tel" label="Phone (optional)" defaultValue={values.phone} error={errors.phone} />
          <FormField
            id="address_line"
            name="address_line"
            label="Address (optional)"
            defaultValue={values.address_line}
            error={errors.address_line}
          />
          <FormField id="city" name="city" label="City (optional)" defaultValue={values.city} error={errors.city} />
          <FormField id="country" name="country" label="Country" defaultValue={values.country} error={errors.country} required />
          <div className="sm:col-span-2">
            <TextareaField id="notes" name="notes" label="Notes (optional)" rows={2} defaultValue={values.notes} error={errors.notes} />
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
