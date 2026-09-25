"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { TextareaField } from "@/components/ui/textarea-field";
import type { ProductFormState } from "@/lib/actions/products";
import { UNIT_LABELS, UNITS_OF_MEASURE } from "@/lib/inventory";
import type { ProductFormValues } from "@/lib/validation/product";

const UNIT_OPTIONS: SelectOption[] = UNITS_OF_MEASURE.map((u) => ({ value: u, label: `${u} · ${UNIT_LABELS[u]}` }));

/** Create / edit form. The server action validates again and the database has the final say. */
export function ProductForm({
  action,
  initialValues,
  categories,
  cancelHref,
  submitLabel,
  skuLocked = false,
}: {
  action: (state: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  initialValues: ProductFormValues;
  categories: SelectOption[];
  cancelHref: string;
  submitLabel: string;
  /** SKU cannot change once stock has moved (enforced by a database trigger). */
  skuLocked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};
  // Remount the inputs when the server echoes values back, so defaultValue applies.
  const formKey = JSON.stringify(values);

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <Card key={`general-${formKey}`}>
        <CardHeader title="General" description="Identification and classification" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="sku"
            name="sku"
            label="SKU"
            defaultValue={values.sku}
            error={errors.sku}
            hint={skuLocked ? "Locked: stock has already moved for this product." : "Capital letters, digits and dashes, e.g. CMP-2100."}
            readOnly={skuLocked}
            className={skuLocked ? "bg-slate-50 font-mono text-slate-500" : "font-mono uppercase"}
            autoComplete="off"
            required
          />
          <FormField
            id="barcode"
            name="barcode"
            label="Barcode (optional)"
            inputMode="numeric"
            defaultValue={values.barcode}
            error={errors.barcode}
            hint="EAN / UPC, 8 to 14 digits."
            autoComplete="off"
          />
          <div className="sm:col-span-2">
            <FormField id="name" name="name" label="Name" defaultValue={values.name} error={errors.name} required />
          </div>
          <SelectField
            id="category_id"
            name="category_id"
            label="Category"
            placeholder="Choose a category"
            options={categories}
            defaultValue={values.category_id}
            error={errors.category_id}
            required
          />
          <SelectField
            id="unit_of_measure"
            name="unit_of_measure"
            label="Unit of measure"
            options={UNIT_OPTIONS}
            defaultValue={values.unit_of_measure}
            error={errors.unit_of_measure}
            required
          />
          <div className="sm:col-span-2">
            <TextareaField
              id="description"
              name="description"
              label="Description (optional)"
              defaultValue={values.description}
              error={errors.description}
            />
          </div>
        </CardBody>
      </Card>

      <Card key={`pricing-${formKey}`}>
        <CardHeader
          title="Pricing and replenishment"
          description="Cost price values the inventory. Stock at or below the minimum is flagged as low."
        />
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField
            id="cost_price"
            name="cost_price"
            label="Cost price (ILS)"
            inputMode="decimal"
            defaultValue={values.cost_price}
            error={errors.cost_price}
            required
          />
          <FormField
            id="sale_price"
            name="sale_price"
            label="Sale price (ILS)"
            inputMode="decimal"
            defaultValue={values.sale_price}
            error={errors.sale_price}
            required
          />
          <FormField
            id="min_stock_level"
            name="min_stock_level"
            label="Minimum stock"
            inputMode="numeric"
            defaultValue={values.min_stock_level}
            error={errors.min_stock_level}
            required
          />
          <FormField
            id="reorder_quantity"
            name="reorder_quantity"
            label="Reorder quantity"
            inputMode="numeric"
            defaultValue={values.reorder_quantity}
            error={errors.reorder_quantity}
            required
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
