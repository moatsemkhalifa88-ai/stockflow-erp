import { RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { FlashToast } from "@/components/ui/flash-toast";
import { ReasonActionForm } from "@/components/ui/reason-action-form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { reverseGoodsReceipt } from "@/lib/actions/purchase-orders";
import { canReceiveGoods } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getGoodsReceipt, getGoodsReceiptLines } from "@/lib/data/goods-receipts";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Goods receipt" };

export default async function GoodsReceiptDetailPage({ params }: PageProps<"/goods-receipts/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, receipt, lines] = await Promise.all([getActiveUser(), getGoodsReceipt(id), getGoodsReceiptLines(id)]);
  if (!receipt) notFound();

  const canReverse = receipt.reversedAt === null && user !== null && canReceiveGoods(user.role);

  return (
    <>
      <FlashToast
        messages={{
          received: { title: "Goods received", description: `${receipt.receiptNumber} posted to the stock ledger`, variant: "success" },
          reversed: { title: "Goods receipt reversed", description: receipt.receiptNumber, variant: "success" },
        }}
      />
      <PageHeader
        title={receipt.receiptNumber}
        description={`${formatDateTime(receipt.receivedAt)} · ${receipt.receivedByName ?? "System"}`}
      />

      {receipt.reversedAt && (
        <p role="note" className="mb-6 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <Badge className="mr-2">Reversed</Badge>
          {formatDateTime(receipt.reversedAt)} by {receipt.reversedByName ?? "System"}: {receipt.reversalReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Received lines" description="Each line was posted as a purchase-receipt movement through the inventory engine." />
          <Table caption="Received lines">
            <THead>
              <Th>PO line</Th>
              <Th>Product</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">Unit cost</Th>
              <Th align="right">Value</Th>
              <Th>Stock movement</Th>
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
                  <Td align="right" className="font-medium tabular-nums">{formatNumber(l.quantity)}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(l.unitCost)}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(l.quantity * l.unitCost)}</Td>
                  <Td>
                    {l.movementId ? (
                      <Link href={`/movements/${l.movementId}`} className="font-mono text-xs text-brand-700 hover:underline">
                        {l.movementNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-5">
            <DescriptionList
              items={[
                {
                  label: "Purchase order",
                  value: (
                    <Link href={`/purchase-orders/${receipt.purchaseOrderId}`} className="font-mono text-brand-700 hover:underline">
                      {receipt.poNumber}
                    </Link>
                  ),
                },
                {
                  label: "Supplier",
                  value: (
                    <Link href={`/suppliers/${receipt.supplierId}`} className="text-brand-700 hover:underline">
                      {receipt.supplierName}
                    </Link>
                  ),
                },
                {
                  label: "Warehouse",
                  value: (
                    <Link href={`/warehouses/${receipt.warehouseId}`} className="text-brand-700 hover:underline">
                      {receipt.warehouseCode} · {receipt.warehouseName}
                    </Link>
                  ),
                },
                { label: "Units", value: formatNumber(receipt.totalQuantity) },
                { label: "Value", value: formatCurrency(receipt.totalValue) },
                { label: "Notes", value: receipt.notes },
              ]}
            />
            {canReverse && (
              <ReasonActionForm
                action={reverseGoodsReceipt.bind(null, receipt.id)}
                idPrefix="reverse-receipt"
                triggerLabel="Reverse receipt"
                triggerIcon={RotateCcw}
                reasonLabel="Reason for reversal"
                placeholder="e.g. Delivery returned to supplier"
                submitLabel="Reverse receipt"
                explanation={
                  <p>
                    Every line is taken back out of stock with an opposite movement, and the purchase order goes back to
                    waiting for these goods. The receipt and its movements stay in the history. This is refused if the
                    stock has already been used.
                  </p>
                }
              />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
