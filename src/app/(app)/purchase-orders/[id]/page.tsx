import { CalendarClock, PackageCheck, Truck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { PoStatusBadge } from "@/components/purchasing/po-status-badge";
import { PoWorkflowActions } from "@/components/purchasing/po-workflow-actions";
import { ReceiptTable } from "@/components/purchasing/receipt-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getActiveUser } from "@/lib/auth/session";
import { getReceiptsForPurchaseOrder } from "@/lib/data/goods-receipts";
import { getPurchaseOrderLines, getPurchaseOrderSummary, isOverdue } from "@/lib/data/purchase-orders";
import { businessToday, formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { allowedActions } from "@/lib/purchasing";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderDetailPage({ params }: PageProps<"/purchase-orders/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, po, lines, receipts] = await Promise.all([
    getActiveUser(),
    getPurchaseOrderSummary(id),
    getPurchaseOrderLines(id),
    getReceiptsForPurchaseOrder(id),
  ]);
  if (!po) notFound();

  const actions = user ? allowedActions(user.role, po.status) : [];
  const overdue = isOverdue(po, businessToday());

  const timeline: { label: string; at: string | null; by?: string | null }[] = [
    { label: "Created", at: po.createdAt, by: po.createdByName },
    { label: "Submitted", at: po.submittedAt },
    { label: "Approved", at: po.approvedAt, by: po.approvedByName },
    { label: "Last goods received", at: po.lastReceivedAt },
    { label: "Cancelled", at: po.cancelledAt },
  ];

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Draft saved", description: po.poNumber, variant: "success" },
          updated: { title: "Draft saved", description: po.poNumber, variant: "success" },
          submitted: { title: "Submitted for approval", description: po.poNumber, variant: "success" },
          "created-not-submitted": { title: "Draft saved but not submitted", description: "Check the order and submit it again.", variant: "warning" },
          "updated-not-submitted": { title: "Draft saved but not submitted", description: "Check the order and submit it again.", variant: "warning" },
          cancelled: { title: "Purchase order cancelled", description: po.poNumber, variant: "success" },
        }}
      />
      <PageHeader title={po.poNumber} description={`${po.supplierName} → ${po.warehouseCode} · ${po.warehouseName}`} />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <PoStatusBadge status={po.status} />
          {overdue && <Badge tone="danger">Overdue</Badge>}
        </div>
        <PoWorkflowActions poId={po.id} poNumber={po.poNumber} actions={actions} />
      </div>

      {po.status === "CANCELLED" && po.cancelReason && (
        <p role="note" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Cancelled: {po.cancelReason}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Order total" value={formatCurrency(po.totalAmount)} icon={Wallet} hint={`${formatNumber(po.lineCount)} lines · ${po.orderDate ? formatDate(po.orderDate) : ""}`} />
        <KpiCard
          label="Received"
          value={`${formatNumber(po.quantityReceived)} / ${formatNumber(po.quantityOrdered)}`}
          icon={PackageCheck}
          hint={formatCurrency(po.receivedValue)}
        />
        <KpiCard
          label="Outstanding"
          value={formatCurrency(po.outstandingValue)}
          icon={Truck}
          hint={po.status === "CANCELLED" ? "Cancelled" : "Still to be delivered"}
        />
        <KpiCard
          label="Expected delivery"
          value={po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—"}
          icon={CalendarClock}
          hint={overdue ? "Past due" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Lines" />
          <Table caption="Purchase order lines">
            <THead>
              <Th>#</Th>
              <Th>Product</Th>
              <Th align="right">Ordered</Th>
              <Th align="right">Received</Th>
              <Th align="right">Outstanding</Th>
              <Th align="right">Unit cost</Th>
              <Th align="right">Line total</Th>
            </THead>
            <TBody>
              {lines.map((l) => (
                <Tr key={l.id}>
                  <Td className="text-slate-500">{l.lineNumber}</Td>
                  <Td className="max-w-72">
                    <Link href={`/products/${l.productId}`} className="block truncate hover:underline">
                      <span className="font-mono text-xs text-slate-500">{l.sku}</span> {l.productName}
                    </Link>
                  </Td>
                  <Td align="right" className="tabular-nums">{formatNumber(l.quantityOrdered)}</Td>
                  <Td align="right" className="tabular-nums">{formatNumber(l.quantityReceived)}</Td>
                  <Td align="right" className={l.outstanding > 0 && po.status !== "CANCELLED" ? "font-medium tabular-nums" : "text-slate-400 tabular-nums"}>
                    {formatNumber(l.outstanding)}
                  </Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(l.unitCost)}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(l.lineTotal)}</Td>
                </Tr>
              ))}
            </TBody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
              <tr>
                <td className="px-4 py-3" colSpan={6}>
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(po.totalAmount)}</td>
              </tr>
            </tfoot>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: "Supplier",
                  value: (
                    <Link href={`/suppliers/${po.supplierId}`} className="text-brand-700 hover:underline">
                      {po.supplierName}
                    </Link>
                  ),
                },
                {
                  label: "Warehouse",
                  value: (
                    <Link href={`/warehouses/${po.warehouseId}`} className="text-brand-700 hover:underline">
                      {po.warehouseCode} · {po.warehouseName}
                    </Link>
                  ),
                },
                { label: "Order date", value: formatDate(po.orderDate) },
                { label: "Currency", value: "ILS" },
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
            {po.notes && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{po.notes}</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Goods receipts" description="Each receipt posts one purchase-receipt movement per line to the stock ledger." />
        {receipts.length === 0 ? (
          <EmptyState icon={PackageCheck} title="Nothing received yet" />
        ) : (
          <ReceiptTable receipts={receipts} hidePo />
        )}
      </Card>
    </>
  );
}
