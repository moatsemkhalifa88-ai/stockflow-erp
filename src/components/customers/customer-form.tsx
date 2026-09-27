"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField } from "@/components/ui/select-field";
import { TextareaField } from "@/components/ui/textarea-field";
import type { CustomerFormState } from "@/lib/actions/customers";
import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES } from "@/lib/sales";
import type { CustomerFormValues } from "@/lib/validation/customer";

/** Create / edit form. Status changes use the Deactivate / Reactivate control. */
export function CustomerForm({
  action,
  initialValues,
  cancelHref,
  submitLabel,
}: {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initialValues: CustomerFormValues;
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
        <CardHeader title="Customer" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="code"
            name="code"
            label="Code"
            defaultValue={values.code}
            error={errors.code}
            hint="e.g. CUS-031"
            className="font-mono uppercase"
            autoComplete="off"
            required
          />
          <SelectField
            id="customer_type"
            name="customer_type"
            label="Type"
            options={CUSTOMER_TYPES.map((t) => ({ value: t, label: CUSTOMER_TYPE_LABELS[t] }))}
            defaultValue={values.customer_type}
            error={errors.customer_type}
            required
          />
          <div className="sm:col-span-2">
            <FormField id="name" name="name" label="Name" defaultValue={values.name} error={errors.name} required />
          </div>
          <FormField
            id="credit_limit"
            name="credit_limit"
            label="Credit limit (ILS)"
            inputMode="decimal"
            defaultValue={values.credit_limit}
            error={errors.credit_limit}
            required
          />
          <FormField
            id="payment_terms_days"
            name="payment_terms_days"
            label="Payment terms (days)"
            inputMode="numeric"
            defaultValue={values.payment_terms_days}
            error={errors.payment_terms_days}
            required
          />
          <FormField id="tax_id" name="tax_id" label="Tax id (optional)" defaultValue={values.tax_id} error={errors.tax_id} />
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
          <FormField id="email" name="email" type="email" label="Email (optional)" defaultValue={values.email} error={errors.email} autoComplete="off" />
          <FormField id="phone" name="phone" type="tel" label="Phone (optional)" defaultValue={values.phone} error={errors.phone} />
          <FormField id="address_line" name="address_line" label="Address (optional)" defaultValue={values.address_line} error={errors.address_line} />
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
