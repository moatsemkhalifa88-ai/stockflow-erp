import { PackageCheck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { isOverdue, type PurchaseOrderSummary } from "@/lib/data/purchase-orders";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { PoStatusBadge } from "./po-status-badge";

/**
 * Approved / partially received orders, i.e. what the warehouse can receive
 * against. Users who may receive get a "Receive" button per order; everyone
 * else sees who does the receiving.
 */
export function AwaitingDelivery({
  orders,
  canReceive,
  today,
}: {
  orders: PurchaseOrderSummary[];
  canReceive: boolean;
  today: string;
}) {
  return (
    <Card className="mb-6">
      <CardHeader
        title="Awaiting delivery"
        description={
          canReceive
            ? "Approved purchase orders with goods still to come. Choose Receive when a delivery arrives."
            : "Approved purchase orders with goods still to come. Goods are received by a warehouse manager or an administrator."
        }
      />
      {orders.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Nothing is waiting for delivery" description="Approved purchase orders appear here until they are fully received." />
      ) : (
        <Table caption="Purchase orders awaiting delivery">
          <THead>
            <Th>PO</Th>
            <Th>Status</Th>
            <Th>Supplier</Th>
            <Th>Deliver to</Th>
            <Th>Expected</Th>
            <Th align="right">Received</Th>
            <Th align="right">Still to come</Th>
            <Th>
              <span className="sr-only">Action</span>
            </Th>
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
                  <PoStatusBadge status={po.status} />
                </Td>
                <Td className="max-w-56 truncate">{po.supplierName}</Td>
                <Td className="font-mono text-xs">{po.warehouseCode}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    {po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—"}
                    {isOverdue(po, today) && <Badge tone="danger">Overdue</Badge>}
                  </span>
                </Td>
                <Td align="right" className="text-slate-500 tabular-nums">
                  {formatNumber(po.quantityReceived)} / {formatNumber(po.quantityOrdered)}
                </Td>
                <Td align="right" className="font-medium tabular-nums">{formatCurrency(po.outstandingValue)}</Td>
                <Td align="right">
                  {canReceive ? (
                    <LinkButton href={`/purchase-orders/${po.id}/receive`} size="sm">
                      <PackageCheck aria-hidden className="size-4" />
                      Receive
                    </LinkButton>
                  ) : (
                    <LinkButton href={`/purchase-orders/${po.id}`} size="sm" variant="ghost">
                      View
                    </LinkButton>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
