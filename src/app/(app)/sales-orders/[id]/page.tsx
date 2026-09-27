import { AlertTriangle, CalendarClock, Package, Percent, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { SoStatusBadge } from "@/components/sales/so-status-badge";
import { SoWorkflowActions } from "@/components/sales/so-workflow-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { FlashToast } from "@/components/ui/flash-toast";
import { LinkButton } from "@/components/ui/link-button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getActiveUser } from "@/lib/auth/session";
import { getSalesOrderLines, getSalesOrderSummary, isLate } from "@/lib/data/sales-orders";
import { cn } from "@/lib/cn";
import { businessToday, formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { allowedSalesActions, customerTypeLabel } from "@/lib/sales";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sales order" };

export default async function SalesOrderDetailPage({ params }: PageProps<"/sales-orders/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, so] = await Promise.all([getActiveUser(), getSalesOrderSummary(id)]);
  if (!so) notFound();
  const lines = await getSalesOrderLines(id, so.warehouseId);

  const actions = user ? allowedSalesActions(user.role, so.status) : [];
  const awaitingShipment = so.status === "CONFIRMED" || so.status === "PROCESSING";
  const shortLines = awaitingShipment ? lines.filter((l) => l.quantity > l.available).length : 0;
  const late = isLate(so, businessToday());

  const timeline: { label: string; at: string | null; by?: string | null }[] = [
    { label: "Created", at: so.createdAt, by: so.createdByName },
    { label: "Confirmed", at: so.confirmedAt },
    { label: "Processing started", at: so.processingStartedAt },
    { label: "Shipped", at: so.shippedAt, by: so.shippedByName },
    { label: "Completed", at: so.completedAt },
    { label: "Shipment reversed", at: so.shipmentReversedAt },
    { label: "Cancelled", at: so.cancelledAt },
  ];

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Draft saved", description: so.soNumber, variant: "success" },
          updated: { title: "Draft saved", description: so.soNumber, variant: "success" },
          confirmed: { title: "Order confirmed", description: so.soNumber, variant: "success" },
          "created-not-confirmed": { title: "Draft saved but not confirmed", description: "Check the order and confirm it again.", variant: "warning" },
          "updated-not-confirmed": { title: "Draft saved but not confirmed", description: "Check the order and confirm it again.", variant: "warning" },
          cancelled: { title: "Sales order cancelled", description: so.soNumber, variant: "success" },
          reversed: { title: "Shipment reversed", description: `${so.soNumber} is back to Confirmed`, variant: "success" },
        }}
      />
      <PageHeader title={so.soNumber} description={`${so.customerName} · ship from ${so.warehouseCode} · ${so.warehouseName}`} />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SoStatusBadge status={so.status} />
          {late && <Badge tone="danger">Late</Badge>}
        </div>
        <SoWorkflowActions soId={so.id} soNumber={so.soNumber} actions={actions} shortLines={shortLines} />
      </div>

      {shortLines > 0 && (
        <p role="note" className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {shortLines} line{shortLines === 1 ? " is" : "s are"} short on stock at {so.warehouseCode}. The order can only ship when every
          line is available. Nothing is shipped partially.
        </p>
      )}
      {so.status === "CANCELLED" && so.cancelReason && (
        <p role="note" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Cancelled: {so.cancelReason}
        </p>
      )}
      {so.shipmentReversalReason && so.status !== "CANCELLED" && (
        <p role="note" className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Last shipment reversed: {so.shipmentReversalReason}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Order total" value={formatCurrency(so.totalAmount)} icon={Wallet} hint={`${formatNumber(so.lineCount)} lines`} />
        <KpiCard
          label="Discounts"
          value={formatCurrency(so.discountAmount)}
          icon={Percent}
          hint={so.subtotal > 0 ? `${((so.discountAmount / so.subtotal) * 100).toFixed(1)}% of ${formatCurrency(so.subtotal)}` : undefined}
        />
        <KpiCard label="Units" value={`${formatNumber(so.quantityShipped)} / ${formatNumber(so.quantity)}`} icon={Package} hint="Shipped / ordered" />
        <KpiCard
          label="Requested delivery"
          value={so.requestedDeliveryDate ? formatDate(so.requestedDeliveryDate) : "—"}
          icon={CalendarClock}
          hint={late ? "Past due" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Lines"
            description={awaitingShipment ? `Available is the current stock at ${so.warehouseCode}.` : undefined}
            action={
              so.status === "SHIPPED" || so.status === "COMPLETED" ? (
                <LinkButton href={`/movements?q=${encodeURIComponent(so.soNumber)}`} variant="ghost" size="sm">
                  Stock movements
                </LinkButton>
              ) : null
            }
          />
          <Table caption="Sales order lines">
            <THead>
              <Th>#</Th>
              <Th>Product</Th>
              <Th align="right">Qty</Th>
              {awaitingShipment && <Th align="right">Available</Th>}
              <Th align="right">Unit price</Th>
              <Th align="right">Discount</Th>
              <Th align="right">Line total</Th>
            </THead>
            <TBody>
              {lines.map((l) => {
                const short = awaitingShipment && l.quantity > l.available;
                return (
                  <Tr key={l.id}>
                    <Td className="text-slate-500">{l.lineNumber}</Td>
                    <Td className="max-w-72">
                      <Link href={`/products/${l.productId}`} className="block truncate hover:underline">
                        <span className="font-mono text-xs text-slate-500">{l.sku}</span> {l.productName}
                      </Link>
                    </Td>
                    <Td align="right" className="tabular-nums">{formatNumber(l.quantity)}</Td>
                    {awaitingShipment && (
                      <Td align="right" className={cn("tabular-nums", short ? "font-medium text-red-700" : "text-slate-500")}>
                        {formatNumber(l.available)}
                        {short && <span className="sr-only"> (short by {l.quantity - l.available})</span>}
                      </Td>
                    )}
                    <Td align="right" className="tabular-nums">{formatCurrency(l.unitPrice)}</Td>
                    <Td align="right" className="text-slate-500 tabular-nums">
                      {l.discountPercent > 0 ? `${l.discountPercent}% (−${formatCurrency(l.discountAmount)})` : "—"}
                    </Td>
                    <Td align="right" className="font-medium tabular-nums">{formatCurrency(l.lineTotal)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <CardBody>
            <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="tabular-nums">{formatCurrency(so.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Discounts</dt>
                <dd className="tabular-nums">−{formatCurrency(so.discountAmount)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatCurrency(so.totalAmount)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: "Customer",
                  value: (
                    <Link href={`/customers/${so.customerId}`} className="text-brand-700 hover:underline">
                      {so.customerName}
                    </Link>
                  ),
                },
                { label: "Customer type", value: customerTypeLabel(so.customerType) },
                {
                  label: "Warehouse",
                  value: (
                    <Link href={`/warehouses/${so.warehouseId}`} className="text-brand-700 hover:underline">
                      {so.warehouseCode} · {so.warehouseName}
                    </Link>
                  ),
                },
                { label: "Order date", value: formatDate(so.orderDate) },
              ]}
            />
            <ol className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm">
              {timeline
                .filter((t) => t.at)
                .map((t) => (
                  <li key={t.label} className="flex justify-between gap-3">
                    <span className="text-slate-500">{t.label}</span>
                    <span className="text-right text-slate-900">
                      {formatDateTime(t.at ?? "")}
                      {t.by && <span className="block text-xs text-slate-500">{t.by}</span>}
                    </span>
                  </li>
                ))}
            </ol>
            {so.notes && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{so.notes}</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
