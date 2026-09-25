"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import type { WarehouseFormState } from "@/lib/actions/warehouses";
import type { WarehouseFormValues } from "@/lib/validation/warehouse";

/** Create / edit form. Status is changed with the Deactivate / Reactivate control, not here. */
export function WarehouseForm({
  action,
  initialValues,
  typeOptions,
  managerOptions,
  cancelHref,
  submitLabel,
  codeLocked = false,
}: {
  action: (state: WarehouseFormState, formData: FormData) => Promise<WarehouseFormState>;
  initialValues: WarehouseFormValues;
  typeOptions: SelectOption[];
  managerOptions: SelectOption[];
  cancelHref: string;
  submitLabel: string;
  /** The code cannot change once stock has moved (enforced by a database trigger). */
  codeLocked?: boolean;
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
        <CardHeader title="General" description="Identification and responsibility" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="code"
            name="code"
            label="Code"
            defaultValue={values.code}
            error={errors.code}
            hint={codeLocked ? "Locked: stock has already moved in this warehouse." : "e.g. WH-NTN"}
            readOnly={codeLocked}
            className={codeLocked ? "bg-slate-50 font-mono text-slate-500" : "font-mono uppercase"}
            autoComplete="off"
            required
          />
          <SelectField
            id="warehouse_type"
            name="warehouse_type"
            label="Type"
            options={typeOptions}
            defaultValue={values.warehouse_type}
            error={errors.warehouse_type}
            required
          />
          <div className="sm:col-span-2">
            <FormField id="name" name="name" label="Name" defaultValue={values.name} error={errors.name} required />
          </div>
          <div className="sm:col-span-2">
            <SelectField
              id="manager_id"
              name="manager_id"
              label="Manager (optional)"
              placeholder="No manager assigned"
              options={managerOptions}
              defaultValue={values.manager_id}
              error={errors.manager_id}
              hint="Active administrators and warehouse managers."
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Location" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField
              id="address_line"
              name="address_line"
              label="Address (optional)"
              defaultValue={values.address_line}
              error={errors.address_line}
              autoComplete="street-address"
            />
          </div>
          <FormField id="city" name="city" label="City" defaultValue={values.city} error={errors.city} required />
          <FormField id="country" name="country" label="Country" defaultValue={values.country} error={errors.country} required />
          <FormField
            id="phone"
            name="phone"
            label="Phone (optional)"
            type="tel"
            defaultValue={values.phone}
            error={errors.phone}
            autoComplete="tel"
          />
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
