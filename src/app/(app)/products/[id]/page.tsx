import { Boxes, History, Pencil, Wallet, Warehouse } from "lucide-react";
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
import { setProductActive } from "@/lib/actions/products";
import { canManageProducts, canMoveStock } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getStockByWarehouse } from "@/lib/data/inventory";
import { getRecentMovements } from "@/lib/data/movements";
import { getProduct, getProductSummary } from "@/lib/data/products";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { UNIT_LABELS, UNITS_OF_MEASURE } from "@/lib/inventory";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Product" };

function unitLabel(uom: string): string {
  const unit = UNITS_OF_MEASURE.find((u) => u === uom);
  return unit ? `${unit} · ${UNIT_LABELS[unit]}` : uom;
}

export default async function ProductDetailPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [product, summary, stock, movements, user] = await Promise.all([
    getProduct(id),
    getProductSummary(id),
    getStockByWarehouse(id),
    getRecentMovements({ productId: id }, 15),
    getActiveUser(),
  ]);
  if (!product || !summary) notFound();

  const canEdit = user !== null && canManageProducts(user.role);
  const canAdjust = user !== null && canMoveStock(user.role);
  const margin = product.sale_price > 0 ? ((product.sale_price - product.cost_price) / product.sale_price) * 100 : null;

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Product created", description: product.sku, variant: "success" },
          updated: { title: "Product saved", description: product.sku, variant: "success" },
        }}
      />
      <PageHeader
        title={product.name}
        description={`${product.sku} · ${product.category?.name ?? "Uncategorised"}`}
        actions={
          canEdit ? (
            <>
              <ActivationToggle
                isActive={product.is_active}
                onChange={setProductActive.bind(null, product.id)}
                entityLabel="Product"
                deactivateWarning={
                  summary.totalQuantity > 0
                    ? `${formatNumber(summary.totalQuantity)} units are still in stock. They can be shipped or written off, but no new stock can be received.`
                    : "The product will be hidden from active lists. History is kept."
                }
              />
              <LinkButton href={`/products/${product.id}/edit`} variant="secondary">
                <Pencil aria-hidden className="size-4" />
                Edit
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StockStatusBadge status={summary.stockStatus} />
        <Badge tone={product.is_active ? "info" : "neutral"}>{product.is_active ? "Active" : "Inactive"}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="On hand"
          value={formatNumber(summary.totalQuantity)}
          icon={Boxes}
          hint={`${product.unit_of_measure} across all warehouses`}
        />
        <KpiCard label="Inventory value" value={formatCurrency(summary.inventoryValue)} icon={Wallet} hint="At current cost price" />
        <KpiCard label="Warehouses" value={formatNumber(summary.warehouseCount)} icon={Warehouse} hint="Holding stock" />
        <KpiCard
          label="Minimum stock"
          value={formatNumber(product.min_stock_level)}
          icon={History}
          hint={`Reorder ${formatNumber(product.reorder_quantity)} ${product.unit_of_measure}`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Stock by warehouse"
            description="Status uses the product's minimum stock level per location."
            action={
              canAdjust && product.is_active ? (
                <LinkButton href={`/movements/new?product=${product.id}`} variant="secondary" size="sm">
                  Adjust stock
                </LinkButton>
              ) : null
            }
          />
          {stock.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title="No stock recorded"
              description="Stock appears here after the first receipt or adjustment."
            />
          ) : (
            <Table caption="Stock by warehouse">
              <THead>
                <Th>Warehouse</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Value</Th>
                <Th>Status</Th>
                <Th>Last movement</Th>
              </THead>
              <TBody>
                {stock.map((line) => (
                  <Tr key={line.inventoryId}>
                    <Td>
                      <Link href={`/warehouses/${line.warehouseId}`} className="hover:underline">
                        <span className="font-mono text-xs text-slate-500">{line.warehouseCode}</span> {line.warehouseName}
                      </Link>
                    </Td>
                    <Td align="right" className="font-medium tabular-nums">{formatNumber(line.quantity)}</Td>
                    <Td align="right" className="tabular-nums">{formatCurrency(line.inventoryValue)}</Td>
                    <Td>
                      <StockStatusBadge status={line.stockStatus} />
                    </Td>
                    <Td className="text-slate-500">{line.lastMovementAt ? formatDateTime(line.lastMovementAt) : "—"}</Td>
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
                { label: "SKU", value: <span className="font-mono">{product.sku}</span> },
                { label: "Barcode", value: product.barcode && <span className="font-mono">{product.barcode}</span> },
                { label: "Unit", value: unitLabel(product.unit_of_measure) },
                { label: "Category", value: product.category?.name },
                { label: "Cost price", value: formatCurrency(product.cost_price) },
                { label: "Sale price", value: formatCurrency(product.sale_price) },
                { label: "Gross margin", value: margin === null ? null : `${margin.toFixed(1)}%` },
                { label: "Created", value: `${formatDateTime(product.created_at)}${product.creator ? ` by ${product.creator.full_name}` : ""}` },
              ]}
            />
            {product.description && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{product.description}</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent movements"
          description="Latest 15 ledger entries for this product"
          action={
            <LinkButton href={`/movements?product=${product.id}`} variant="ghost" size="sm">
              View all
            </LinkButton>
          }
        />
        {movements.length === 0 ? (
          <EmptyState icon={History} title="No movements yet" />
        ) : (
          <MovementTable movements={movements} hide={["product"]} />
        )}
      </Card>
    </>
  );
}
