import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { isOverdue, type PurchaseOrderSummary } from "@/lib/data/purchase-orders";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { PoStatusBadge } from "./po-status-badge";

/** Purchase order list, used on the purchase orders page and the supplier detail page. */
export function PurchaseOrderTable({
  orders,
  today,
  hideSupplier = false,
}: {
  orders: PurchaseOrderSummary[];
  today: string;
  hideSupplier?: boolean;
}) {
  return (
    <Table caption="Purchase orders">
      <THead>
        <Th>PO</Th>
        <Th>Status</Th>
        {!hideSupplier && <Th>Supplier</Th>}
        <Th>Warehouse</Th>
        <Th>Ordered</Th>
        <Th>Expected</Th>
        <Th align="right">Received</Th>
        <Th align="right">Total</Th>
      </THead>
      <TBody>
        {orders.map((po) => (
          <Tr key={po.id}>
            <Td>
              <Link href={`/purchase-orders/${po.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                {po.poNumber}
              </Link>
            </Td>
            <Td>
              <span className="inline-flex flex-wrap gap-1">
                <PoStatusBadge status={po.status} />
                {isOverdue(po, today) && <Badge tone="danger">Overdue</Badge>}
              </span>
            </Td>
            {!hideSupplier && (
              <Td className="max-w-60">
                <Link href={`/suppliers/${po.supplierId}`} className="block truncate hover:underline">
                  {po.supplierName}
                </Link>
              </Td>
            )}
            <Td className="font-mono text-xs">{po.warehouseCode}</Td>
            <Td className="text-slate-500">{formatDate(po.orderDate)}</Td>
            <Td className="text-slate-500">{po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—"}</Td>
            <Td align="right" className="text-slate-500 tabular-nums">
              {formatNumber(po.quantityReceived)} / {formatNumber(po.quantityOrdered)}
            </Td>
            <Td align="right" className="font-medium tabular-nums">{formatCurrency(po.totalAmount)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
