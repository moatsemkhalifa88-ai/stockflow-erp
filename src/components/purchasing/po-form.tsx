"use client";

import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField } from "@/components/ui/select-field";
import { TextareaField } from "@/components/ui/textarea-field";
import type { PurchaseOrderFormState } from "@/lib/actions/purchase-orders";
import { addDays, formatCurrency } from "@/lib/format";
import type {
  PurchaseOrderFieldErrors,
  PurchaseOrderFormValues,
  PurchaseOrderLineValues,
} from "@/lib/validation/purchase-order";

export interface SupplierChoice {
  id: string;
  label: string;
  leadTimeDays: number;
}

export interface ProductChoice {
  id: string;
  label: string;
  costPrice: number;
}

export interface WarehouseChoice {
  id: string;
  label: string;
}

/**
 * Draft purchase order form. Lines are plain repeated inputs, so the form also
 * posts without JavaScript state tricks. Totals shown here are a preview; the
 * database derives the real total from the saved lines.
 */
export function PurchaseOrderForm({
  action,
  initialValues,
  suppliers,
  warehouses,
  products,
  cancelHref,
}: {
  action: (state: PurchaseOrderFormState, formData: FormData) => Promise<PurchaseOrderFormState>;
  initialValues: PurchaseOrderFormValues;
  suppliers: SupplierChoice[];
  warehouses: WarehouseChoice[];
  products: ProductChoice[];
  cancelHref: string;
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
      {/* Remount when the server echoes values back, so every field shows what was submitted. */}
      <FormBody
        key={JSON.stringify(values)}
        values={values}
        errors={state.fieldErrors ?? {}}
        suppliers={suppliers}
        warehouses={warehouses}
        products={products}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" name="intent" value="draft" variant="secondary" loading={pending}>
          Save draft
        </Button>
        <Button type="submit" name="intent" value="submit" loading={pending}>
          Save and submit for approval
        </Button>
      </div>
    </form>
  );
}

interface LineState extends PurchaseOrderLineValues {
  key: number;
}

function FormBody({
  values,
  errors,
  suppliers,
  warehouses,
  products,
}: {
  values: PurchaseOrderFormValues;
  errors: PurchaseOrderFieldErrors;
  suppliers: SupplierChoice[];
  warehouses: WarehouseChoice[];
  products: ProductChoice[];
}) {
  const [orderDate, setOrderDate] = useState(values.order_date);
  const [expected, setExpected] = useState(values.expected_delivery_date);
  const [lines, setLines] = useState<LineState[]>(() =>
    (values.lines.length > 0 ? values.lines : [{ product_id: "", quantity: "", unit_cost: "" }]).map((l, i) => ({
      ...l,
      key: i,
    })),
  );
  const [nextKey, setNextKey] = useState(lines.length);
  const costOf = new Map(products.map((p) => [p.id, p.costPrice]));

  function onSupplierChange(supplierId: string) {
    const supplier = suppliers.find((s) => s.id === supplierId);
    // Suggest a delivery date from the supplier's lead time when none is set yet.
    if (supplier && expected === "" && orderDate) setExpected(addDays(orderDate, supplier.leadTimeDays));
  }

  function updateLine(key: number, patch: Partial<PurchaseOrderLineValues>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // Default the price to the product's cost price when a product is picked.
        if (patch.product_id !== undefined && patch.product_id !== line.product_id) {
          const cost = costOf.get(patch.product_id);
          if (cost !== undefined) next.unit_cost = cost.toFixed(2);
        }
        return next;
      }),
    );
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey, product_id: "", quantity: "", unit_cost: "" }]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== key) : current));
  }

  const lineTotal = (l: PurchaseOrderLineValues) => {
    const q = Number(l.quantity);
    const c = Number(l.unit_cost);
    return Number.isFinite(q) && Number.isFinite(c) ? q * c : 0;
  };
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const usedProducts = new Set(lines.map((l) => l.product_id).filter(Boolean));

  return (
    <>
      <Card>
        <CardHeader title="Order" description="Supplier, destination warehouse and dates" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <SelectField
            id="supplier_id"
            name="supplier_id"
            label="Supplier"
            placeholder="Choose a supplier"
            options={suppliers.map((s) => ({ value: s.id, label: s.label }))}
            defaultValue={values.supplier_id}
            onChange={(e) => onSupplierChange(e.target.value)}
            error={errors.supplier_id}
            required
          />
          <SelectField
            id="warehouse_id"
            name="warehouse_id"
            label="Deliver to warehouse"
            placeholder="Choose a warehouse"
            options={warehouses.map((w) => ({ value: w.id, label: w.label }))}
            defaultValue={values.warehouse_id}
            error={errors.warehouse_id}
            required
          />
          <FormField
            id="order_date"
            name="order_date"
            type="date"
            label="Order date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            error={errors.order_date}
            required
          />
          <FormField
            id="expected_delivery_date"
            name="expected_delivery_date"
            type="date"
            label="Expected delivery (optional)"
            value={expected}
            min={orderDate || undefined}
            onChange={(e) => setExpected(e.target.value)}
            error={errors.expected_delivery_date}
            hint="Suggested from the supplier's lead time."
          />
          <div className="sm:col-span-2">
            <TextareaField id="notes" name="notes" label="Notes (optional)" rows={2} defaultValue={values.notes} error={errors.notes} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lines"
          description="Unit cost defaults to the product's cost price and can be negotiated per order."
          action={
            <Button size="sm" variant="secondary" onClick={addLine}>
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
              <fieldset key={line.key} className="grid gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-12 sm:items-start">
                <legend className="sr-only">Line {index + 1}</legend>
                <div className="sm:col-span-6">
                  <SelectField
                    id={`line-${line.key}-product`}
                    name="line_product_id"
                    label={`Line ${index + 1} product`}
                    placeholder="Choose a product"
                    options={products.map((p) => ({
                      value: p.id,
                      label: p.label,
                      disabled: usedProducts.has(p.id) && p.id !== line.product_id,
                    }))}
                    value={line.product_id}
                    onChange={(ev) => updateLine(line.key, { product_id: ev.target.value })}
                    error={e.product_id}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FormField
                    id={`line-${line.key}-quantity`}
                    name="line_quantity"
                    label="Quantity"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(ev) => updateLine(line.key, { quantity: ev.target.value })}
                    error={e.quantity}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FormField
                    id={`line-${line.key}-cost`}
                    name="line_unit_cost"
                    label="Unit cost"
                    inputMode="decimal"
                    value={line.unit_cost}
                    onChange={(ev) => updateLine(line.key, { unit_cost: ev.target.value })}
                    error={e.unit_cost}
                  />
                </div>
                <div className="flex items-end justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
                  <p className="text-sm font-medium text-slate-900 tabular-nums sm:pt-8">{formatCurrency(lineTotal(line))}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </fieldset>
            );
          })}
          <div className="flex justify-end border-t border-slate-200 pt-4 text-sm">
            <span className="mr-4 text-slate-500">Order total (preview)</span>
            <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(total)}</span>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
