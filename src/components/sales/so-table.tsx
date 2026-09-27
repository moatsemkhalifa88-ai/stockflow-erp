import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { isLate, type SalesOrderSummary } from "@/lib/data/sales-orders";
import { formatCurrency, formatDate } from "@/lib/format";
import { SoStatusBadge } from "./so-status-badge";

/** Sales order list, used on the sales orders page and the customer detail page. */
export function SalesOrderTable({
  orders,
  today,
  hideCustomer = false,
}: {
  orders: SalesOrderSummary[];
  today: string;
  hideCustomer?: boolean;
}) {
  return (
    <Table caption="Sales orders">
      <THead>
        <Th>SO</Th>
        <Th>Status</Th>
        {!hideCustomer && <Th>Customer</Th>}
        <Th>Warehouse</Th>
        <Th>Ordered</Th>
        <Th>Requested</Th>
        <Th align="right">Discount</Th>
        <Th align="right">Total</Th>
      </THead>
      <TBody>
        {orders.map((so) => (
          <Tr key={so.id}>
            <Td>
              <Link href={`/sales-orders/${so.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                {so.soNumber}
              </Link>
            </Td>
            <Td>
              <span className="inline-flex flex-wrap gap-1">
                <SoStatusBadge status={so.status} />
                {isLate(so, today) && <Badge tone="danger">Late</Badge>}
              </span>
            </Td>
            {!hideCustomer && (
              <Td className="max-w-60">
                <Link href={`/customers/${so.customerId}`} className="block truncate hover:underline">
                  {so.customerName}
                </Link>
              </Td>
            )}
            <Td className="font-mono text-xs">{so.warehouseCode}</Td>
            <Td className="text-slate-500">{formatDate(so.orderDate)}</Td>
            <Td className="text-slate-500">{so.requestedDeliveryDate ? formatDate(so.requestedDeliveryDate) : "—"}</Td>
            <Td align="right" className="text-slate-500 tabular-nums">
              {so.discountAmount > 0 ? `−${formatCurrency(so.discountAmount)}` : "—"}
            </Td>
            <Td align="right" className="font-medium tabular-nums">{formatCurrency(so.totalAmount)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
