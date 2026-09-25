import { AlertTriangle, Boxes, History, Package, Pencil, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { MovementTable } from "@/components/movements/movement-table";
import { ActivationToggle } from "@/components/ui/activation-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { LinkButton } from "@/components/ui/link-button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { setWarehouseActive } from "@/lib/actions/warehouses";
import { canManageWarehouses } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getLowStockLines } from "@/lib/data/inventory";
import { getRecentMovements } from "@/lib/data/movements";
import { getWarehouse, getWarehouseSummary } from "@/lib/data/warehouses";
import { formatCurrency, formatNumber, formatWarehouseType } from "@/lib/format";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Warehouse" };

export default async function WarehouseDetailPage({ params }: PageProps<"/warehouses/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [warehouse, summary, lowStock, movements, user] = await Promise.all([
    getWarehouse(id),
    getWarehouseSummary(id),
    getLowStockLines(id),
    getRecentMovements({ warehouseId: id }, 15),
    getActiveUser(),
  ]);
  if (!warehouse || !summary) notFound();

  const alertCount = summary.lowStockCount + summary.outOfStockCount;
  const canEdit = user !== null && canManageWarehouses(user.role);

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Warehouse created", description: warehouse.code, variant: "success" },
          updated: { title: "Warehouse saved", description: warehouse.code, variant: "success" },
        }}
      />
      <PageHeader
        title={warehouse.name}
        description={`${warehouse.code} · ${formatWarehouseType(warehouse.warehouse_type)} · ${warehouse.city}`}
        actions={
          <>
            <LinkButton href={`/inventory?warehouse=${warehouse.id}`} variant="secondary">
              View inventory
            </LinkButton>
            {canEdit && (
              <>
                <ActivationToggle
                  isActive={warehouse.is_active}
                  onChange={setWarehouseActive.bind(null, warehouse.id)}
                  entityLabel="Warehouse"
                  deactivateWarning={
                    summary.totalQuantity > 0
                      ? `${formatNumber(summary.totalQuantity)} units are still here. They can be shipped or written off, but nothing new can be received.`
                      : "The warehouse will no longer receive stock. History is kept."
                  }
                />
                <LinkButton href={`/warehouses/${warehouse.id}/edit`} variant="secondary">
                  <Pencil aria-hidden className="size-4" />
                  Edit
                </LinkButton>
              </>
            )}
          </>
        }
      />
      {!warehouse.is_active && (
        <div className="mb-6">
          <Badge>Inactive: cannot receive stock</Badge>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Products in stock" value={formatNumber(summary.productCount)} icon={Package} hint="Distinct SKUs with quantity > 0" />
        <KpiCard label="Total quantity" value={formatNumber(summary.totalQuantity)} icon={Boxes} hint="Units on hand" />
        <KpiCard label="Inventory value" value={formatCurrency(summary.inventoryValue)} icon={Wallet} hint="At current cost prices" />
        <KpiCard
          label="Low-stock items"
          value={formatNumber(alertCount)}
          icon={AlertTriangle}
          hint={`${formatNumber(summary.lowStockCount)} low · ${formatNumber(summary.outOfStockCount)} out of stock`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Low-stock items" description="Active products at or below their minimum stock level" />
          {lowStock.length === 0 ? (
            <EmptyState icon={Boxes} title="No low-stock items" description="Every active product here is above its minimum." />
          ) : (
            <Table caption="Low-stock items">
              <THead>
                <Th>Product</Th>
                <Th align="right">On hand</Th>
                <Th align="right">Minimum</Th>
                <Th align="right">Shortfall</Th>
                <Th>Status</Th>
              </THead>
              <TBody>
                {lowStock.map((line) => (
                  <Tr key={line.inventoryId}>
                    <Td className="max-w-80">
                      <Link href={`/products/${line.productId}`} className="block truncate hover:underline">
                        <span className="font-mono text-xs text-slate-500">{line.sku}</span> {line.productName}
                      </Link>
                    </Td>
                    <Td align="right" className="font-medium tabular-nums">{formatNumber(line.quantity)}</Td>
                    <Td align="right" className="tabular-nums">{formatNumber(line.minStockLevel)}</Td>
                    <Td align="right" className="text-red-700 tabular-nums">
                      {formatNumber(Math.max(line.minStockLevel - line.quantity, 0))}
                    </Td>
                    <Td>
                      <StockStatusBadge status={line.stockStatus} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Code", value: <span className="font-mono">{warehouse.code}</span> },
                { label: "Type", value: formatWarehouseType(warehouse.warehouse_type) },
                { label: "Manager", value: summary.managerName },
                { label: "Phone", value: warehouse.phone },
                { label: "Address", value: [warehouse.address_line, warehouse.city, warehouse.country].filter(Boolean).join(", ") },
                { label: "Status", value: warehouse.is_active ? "Active" : "Inactive" },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent movements"
          description="Latest 15 ledger entries in this warehouse"
          action={
            <LinkButton href={`/movements?warehouse=${warehouse.id}`} variant="ghost" size="sm">
              View all
            </LinkButton>
          }
        />
        {movements.length === 0 ? (
          <EmptyState icon={History} title="No movements yet" />
        ) : (
          <MovementTable movements={movements} hide={["warehouse"]} />
        )}
      </Card>
    </>
  );
}
