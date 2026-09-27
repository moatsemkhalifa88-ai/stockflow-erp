import { AlertTriangle, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { TransferStatusBadge } from "@/components/sales/so-status-badge";
import { TransferWorkflowActions } from "@/components/transfers/transfer-workflow-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FlashToast } from "@/components/ui/flash-toast";
import { LinkButton } from "@/components/ui/link-button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getActiveUser } from "@/lib/auth/session";
import { getTransfer, getTransferLines } from "@/lib/data/transfers";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { allowedTransferActions } from "@/lib/sales";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Transfer" };

export default async function TransferDetailPage({ params }: PageProps<"/transfers/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, transfer] = await Promise.all([getActiveUser(), getTransfer(id)]);
  if (!transfer) notFound();
  const lines = await getTransferLines(id, transfer.sourceId);

  const actions = user ? allowedTransferActions(user.role, transfer.status) : [];
  const pending = transfer.status === "REQUESTED" || transfer.status === "APPROVED";
  const shortLines = pending ? lines.filter((l) => l.quantity > l.availableAtSource).length : 0;

  const timeline: { label: string; at: string | null; by: string | null }[] = [
    { label: "Requested", at: transfer.requestedAt, by: transfer.requestedByName },
    { label: "Approved", at: transfer.approvedAt, by: transfer.approvedByName },
    { label: "Executed", at: transfer.executedAt, by: transfer.executedByName },
    { label: "Rejected", at: transfer.rejectedAt, by: transfer.rejectedByName },
    { label: "Cancelled", at: transfer.cancelledAt, by: transfer.cancelledByName },
  ];
  const closingReason = transfer.rejectionReason ?? transfer.cancelReason;

  return (
    <>
      <FlashToast
        messages={{
          requested: { title: "Transfer requested", description: transfer.transferNumber, variant: "success" },
          rejected: { title: "Transfer rejected", description: transfer.transferNumber, variant: "success" },
          cancelled: { title: "Transfer cancelled", description: transfer.transferNumber, variant: "success" },
        }}
      />
      <PageHeader title={transfer.transferNumber} description={`${transfer.sourceName} → ${transfer.destinationName}`} />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <TransferStatusBadge status={transfer.status} />
          <span className="inline-flex items-center gap-1.5 font-mono text-sm">
            <Link href={`/warehouses/${transfer.sourceId}`} className="hover:underline">
              {transfer.sourceCode}
            </Link>
            <ArrowRight aria-label="to" className="size-4 text-slate-400" />
            <Link href={`/warehouses/${transfer.destinationId}`} className="hover:underline">
              {transfer.destinationCode}
            </Link>
          </span>
        </div>
        <TransferWorkflowActions transferId={transfer.id} transferNumber={transfer.transferNumber} actions={actions} />
      </div>

      {shortLines > 0 && (
        <p role="note" className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {shortLines} line{shortLines === 1 ? " is" : "s are"} short at {transfer.sourceCode} right now. Execution will be refused, and
          nothing moves, until every line is available.
        </p>
      )}
      {closingReason && (
        <p role="note" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {transfer.status === "REJECTED" ? "Rejected" : "Cancelled"}: {closingReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Products"
            description={`${formatNumber(transfer.totalQuantity)} units · ${formatCurrency(transfer.totalValue)} at cost`}
            action={
              transfer.status === "COMPLETED" ? (
                <LinkButton href={`/movements?q=${encodeURIComponent(transfer.transferNumber)}`} variant="ghost" size="sm">
                  Stock movements
                </LinkButton>
              ) : null
            }
          />
          <Table caption="Transfer lines">
            <THead>
              <Th>Product</Th>
              <Th align="right">Quantity</Th>
              {pending && <Th align="right">Available at {transfer.sourceCode}</Th>}
            </THead>
            <TBody>
              {lines.map((l) => {
                const short = pending && l.quantity > l.availableAtSource;
                return (
                  <Tr key={l.id}>
                    <Td className="max-w-80">
                      <Link href={`/products/${l.productId}`} className="block truncate hover:underline">
                        <span className="font-mono text-xs text-slate-500">{l.sku}</span> {l.productName}
                      </Link>
                    </Td>
                    <Td align="right" className="font-medium tabular-nums">
                      {formatNumber(l.quantity)} <span className="text-xs font-normal text-slate-400">{l.unitOfMeasure}</span>
                    </Td>
                    {pending && (
                      <Td align="right" className={cn("tabular-nums", short ? "font-medium text-red-700" : "text-slate-500")}>
                        {formatNumber(l.availableAtSource)}
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="History" />
          <CardBody>
            <ol className="space-y-2 text-sm">
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
            {transfer.notes && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{transfer.notes}</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
