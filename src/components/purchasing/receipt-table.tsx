import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { GoodsReceiptSummary } from "@/lib/data/goods-receipts";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

/** Goods receipts list, used on the goods receipts page and the purchase order detail page. */
export function ReceiptTable({ receipts, hidePo = false }: { receipts: GoodsReceiptSummary[]; hidePo?: boolean }) {
  return (
    <Table caption="Goods receipts">
      <THead>
        <Th>Receipt</Th>
        <Th>Received</Th>
        {!hidePo && <Th>PO</Th>}
        {!hidePo && <Th>Supplier</Th>}
        <Th>Warehouse</Th>
        <Th align="right">Units</Th>
        <Th align="right">Value</Th>
        <Th>By</Th>
      </THead>
      <TBody>
        {receipts.map((r) => (
          <Tr key={r.id} className={r.reversedAt ? "text-slate-400" : undefined}>
            <Td>
              <Link href={`/goods-receipts/${r.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                {r.receiptNumber}
              </Link>
              {r.reversedAt && (
                <Badge tone="neutral" className="ml-2">
                  Reversed
                </Badge>
              )}
            </Td>
            <Td className="text-slate-500">{formatDateTime(r.receivedAt)}</Td>
            {!hidePo && (
              <Td>
                <Link href={`/purchase-orders/${r.purchaseOrderId}`} className="font-mono text-xs hover:underline">
                  {r.poNumber}
                </Link>
              </Td>
            )}
            {!hidePo && <Td className="max-w-60 truncate">{r.supplierName}</Td>}
            <Td className="font-mono text-xs">{r.warehouseCode}</Td>
            <Td align="right" className="tabular-nums">{formatNumber(r.totalQuantity)}</Td>
            <Td align="right" className="tabular-nums">{formatCurrency(r.totalValue)}</Td>
            <Td className="text-slate-500">{r.receivedByName ?? "—"}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
