import { Plus, Warehouse } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { canManageWarehouses } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { listWarehouseSummaries, totalsOf } from "@/lib/data/warehouses";
import { formatCurrency, formatNumber, formatWarehouseType } from "@/lib/format";

export const metadata: Metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const [warehouses, user] = await Promise.all([listWarehouseSummaries(), getActiveUser()]);
  const totals = totalsOf(warehouses);

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Stock, value and alerts per location."
        actions={
          user && canManageWarehouses(user.role) ? (
            <LinkButton href="/warehouses/new">
              <Plus aria-hidden className="size-4" />
              New warehouse
            </LinkButton>
          ) : null
        }
      />

      <Card>
        {warehouses.length === 0 ? (
          <EmptyState icon={Warehouse} title="No warehouses" description="Run the seed script to load demo data." />
        ) : (
          <Table caption="Warehouses">
            <THead>
              <Th>Warehouse</Th>
              <Th>Type</Th>
              <Th>Manager</Th>
              <Th align="right">Products</Th>
              <Th align="right">Units</Th>
              <Th align="right">Inventory value</Th>
              <Th align="right">Low / out</Th>
              <Th>Status</Th>
            </THead>
            <TBody>
              {warehouses.map((w) => (
                <Tr key={w.id}>
                  <Td>
                    <Link href={`/warehouses/${w.id}`} className="font-medium text-slate-900 hover:underline">
                      {w.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{w.code}</span> · {w.city}
                    </p>
                  </Td>
                  <Td>{formatWarehouseType(w.warehouseType)}</Td>
                  <Td>{w.managerName ?? <span className="text-slate-400">Unassigned</span>}</Td>
                  <Td align="right" className="tabular-nums">{formatNumber(w.productCount)}</Td>
                  <Td align="right" className="tabular-nums">{formatNumber(w.totalQuantity)}</Td>
                  <Td align="right" className="font-medium tabular-nums">{formatCurrency(w.inventoryValue)}</Td>
                  <Td align="right">
                    <span className="inline-flex gap-1">
                      <Badge tone={w.lowStockCount > 0 ? "warning" : "neutral"}>{formatNumber(w.lowStockCount)}</Badge>
                      <Badge tone={w.outOfStockCount > 0 ? "danger" : "neutral"}>{formatNumber(w.outOfStockCount)}</Badge>
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={w.isActive ? "success" : "neutral"}>{w.isActive ? "Active" : "Inactive"}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
              <tr>
                <td className="px-4 py-3" colSpan={4}>
                  Total ({formatNumber(warehouses.length)} warehouses)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.totalQuantity)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(totals.inventoryValue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatNumber(totals.lowStockCount)} / {formatNumber(totals.outOfStockCount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
