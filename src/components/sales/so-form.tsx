"use client";

import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField } from "@/components/ui/select-field";
import { TextareaField } from "@/components/ui/textarea-field";
import type { SalesOrderFormState } from "@/lib/actions/sales-orders";
import { formatCurrency } from "@/lib/format";
import {
  lineAmounts,
  type SalesOrderFieldErrors,
  type SalesOrderFormValues,
  type SalesOrderLineValues,
} from "@/lib/validation/sales-order";

export interface CustomerChoice {
  id: string;
  label: string;
}

export interface SaleProductChoice {
  id: string;
  label: string;
  salePrice: number;
}

export interface WarehouseChoice {
  id: string;
  label: string;
}

/**
 * Draft sales order form with price and discount per line. Totals here are a
 * preview computed the same way as the database; the saved order's totals come
 * from the database.
 */
export function SalesOrderForm({
  action,
  initialValues,
  customers,
  warehouses,
  products,
  cancelHref,
}: {
  action: (state: SalesOrderFormState, formData: FormData) => Promise<SalesOrderFormState>;
  initialValues: SalesOrderFormValues;
  customers: CustomerChoice[];
  warehouses: WarehouseChoice[];
  products: SaleProductChoice[];
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
      <FormBody
        key={JSON.stringify(values)}
        values={values}
        errors={state.fieldErrors ?? {}}
        customers={customers}
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
        <Button type="submit" name="intent" value="confirm" loading={pending}>
          Save and confirm
        </Button>
      </div>
    </form>
  );
}

interface LineState extends SalesOrderLineValues {
  key: number;
}

const EMPTY_LINE: SalesOrderLineValues = { product_id: "", quantity: "", unit_price: "", discount_percent: "0" };

function FormBody({
  values,
  errors,
  customers,
  warehouses,
  products,
}: {
  values: SalesOrderFormValues;
  errors: SalesOrderFieldErrors;
  customers: CustomerChoice[];
  warehouses: WarehouseChoice[];
  products: SaleProductChoice[];
}) {
  const [orderDate, setOrderDate] = useState(values.order_date);
  const [lines, setLines] = useState<LineState[]>(() =>
    (values.lines.length > 0 ? values.lines : [EMPTY_LINE]).map((l, i) => ({ ...l, key: i })),
  );
  const [nextKey, setNextKey] = useState(lines.length);
  const priceOf = new Map(products.map((p) => [p.id, p.salePrice]));

  function updateLine(key: number, patch: Partial<SalesOrderLineValues>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // Default to the list price when a product is picked.
        if (patch.product_id !== undefined && patch.product_id !== line.product_id) {
          const price = priceOf.get(patch.product_id);
          if (price !== undefined) next.unit_price = price.toFixed(2);
        }
        return next;
      }),
    );
  }

  function addLine() {
    setLines((current) => [...current, { ...EMPTY_LINE, key: nextKey }]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== key) : current));
  }

  const amounts = (l: SalesOrderLineValues) => {
    const q = Number(l.quantity);
    const p = Number(l.unit_price);
    const d = Number(l.discount_percent || 0);
    return Number.isFinite(q) && Number.isFinite(p) && Number.isFinite(d) ? lineAmounts(q, p, d) : { gross: 0, discount: 0, total: 0 };
  };
  const totals = lines.reduce(
    (acc, l) => {
      const a = amounts(l);
      return { gross: acc.gross + a.gross, discount: acc.discount + a.discount, total: acc.total + a.total };
    },
    { gross: 0, discount: 0, total: 0 },
  );
  const usedProducts = new Set(lines.map((l) => l.product_id).filter(Boolean));

  return (
    <>
      <Card>
        <CardHeader title="Order" description="Customer, shipping warehouse and dates" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <SelectField
            id="customer_id"
            name="customer_id"
            label="Customer"
            placeholder="Choose a customer"
            options={customers.map((c) => ({ value: c.id, label: c.label }))}
            defaultValue={values.customer_id}
            error={errors.customer_id}
            required
          />
          <SelectField
            id="warehouse_id"
            name="warehouse_id"
            label="Ship from warehouse"
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
            id="requested_delivery_date"
            name="requested_delivery_date"
            type="date"
            label="Requested delivery (optional)"
            min={orderDate || undefined}
            defaultValue={values.requested_delivery_date}
            error={errors.requested_delivery_date}
          />
          <div className="sm:col-span-2">
            <TextareaField id="notes" name="notes" label="Notes (optional)" rows={2} defaultValue={values.notes} error={errors.notes} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lines"
          description="Unit price defaults to the list price. Discounts are a percentage per line."
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
            const a = amounts(line);
            return (
              <fieldset key={line.key} className="grid gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-12 sm:items-start">
                <legend className="sr-only">Line {index + 1}</legend>
                <div className="sm:col-span-5">
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
                    id={`line-${line.key}-price`}
                    name="line_unit_price"
                    label="Unit price"
                    inputMode="decimal"
                    value={line.unit_price}
                    onChange={(ev) => updateLine(line.key, { unit_price: ev.target.value })}
                    error={e.unit_price}
                  />
                </div>
                <div className="sm:col-span-1">
                  <FormField
                    id={`line-${line.key}-discount`}
                    name="line_discount_percent"
                    label="Disc. %"
                    inputMode="decimal"
                    value={line.discount_percent}
                    onChange={(ev) => updateLine(line.key, { discount_percent: ev.target.value })}
                    error={e.discount_percent}
                  />
                </div>
                <div className="flex items-end justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
                  <p className="text-right text-sm tabular-nums sm:pt-7">
                    <span className="block font-medium text-slate-900">{formatCurrency(a.total)}</span>
                    {a.discount > 0 && <span className="block text-xs text-slate-500">−{formatCurrency(a.discount)}</span>}
                  </p>
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
          <dl className="ml-auto w-full max-w-xs space-y-1 border-t border-slate-200 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular-nums">{formatCurrency(totals.gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Discounts</dt>
              <dd className="tabular-nums">−{formatCurrency(totals.discount)}</dd>
            </div>
            <div className="flex justify-between font-semibold text-slate-900">
              <dt>Total (preview)</dt>
              <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
