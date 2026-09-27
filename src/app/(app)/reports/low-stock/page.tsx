import { AlertTriangle, CircleX, PackagePlus, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectField } from "@/components/ui/select-field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getCategoryOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { getLowStockReport } from "@/lib/data/reports";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { exportHref, readLowStockFilters } from "@/lib/report-filters";

export const metadata: Metadata = { title: "Low Stock Report" };

export default async function LowStockReportPage({ searchParams }: PageProps<"/reports/low-stock">) {
  const params = await searchParams;
  const filters = readLowStockFilters(params);
  const [warehouses, categories, lines] = await Promise.all([getWarehouseOptions(), getCategoryOptions(), getLowStockReport(filters)]);

  const low = lines.filter((l) => l.stockStatus === "LOW_STOCK").length;
  const out = lines.filter((l) => l.stockStatus === "OUT_OF_STOCK").length;
  const orderValue = lines.reduce((s, l) => s + l.suggestedOrderValue, 0);
  const shortfall = lines.reduce((s, l) => s + l.shortfall, 0);

  return (
    <>
      <PageHeader
        title="Low Stock Report"
        description="Current stock of active products at active warehouses that is at or below the minimum level. A snapshot, so there is no date filter."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Low stock" value={formatNumber(low)} icon={AlertTriangle} hint="At or below minimum" />
        <KpiCard label="Out of stock" value={formatNumber(out)} icon={CircleX} hint="Zero on hand" />
        <KpiCard label="Units short" value={formatNumber(shortfall)} icon={PackagePlus} hint="To reach every minimum" />
        <KpiCard label="Suggested reorder" value={formatCurrency(orderValue)} icon={ShoppingBag} hint="At current cost prices" />
      </div>

      <Card>
        <ReportFilterBar
          action="/reports/low-stock"
          exportUrl={exportHref("/reports/low-stock/export", params)}
          warehouses={warehouses}
          categories={categories}
          warehouseId={filters.warehouseId}
          categoryId={filters.categoryId}
          isFiltered={Boolean(filters.warehouseId || filters.categoryId || filters.status)}
        >
          <SelectField
            id="report-status"
            name="status"
            label="Status"
            placeholder="Low and out of stock"
            defaultValue={filters.status ?? ""}
            options={[
              { value: "LOW_STOCK", label: "Low stock only" },
              { value: "OUT_OF_STOCK", label: "Out of stock only" },
            ]}
          />
        </ReportFilterBar>

        {lines.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nothing is below its minimum for these filters" />
        ) : (
          <Table caption="Low stock">
            <THead>
              <Th>Status</Th>
              <Th>Product</Th>
              <Th>Warehouse</Th>
              <Th align="right">On hand</Th>
              <Th align="right">Minimum</Th>
              <Th align="right">Shortfall</Th>
              <Th align="right">Suggested order</Th>
              <Th align="right">Order value</Th>
              <Th>Last movement</Th>
            </THead>
            <TBody>
              {lines.map((l) => (
                <Tr key={`${l.productId}-${l.warehouseId}`}>
                  <Td>
                    <StockStatusBadge status={l.stockStatus} />
                  </Td>
                  <Td className="max-w-72">
                    <Link href={`/products/${l.productId}`} className="block truncate hover:underline">
                      <span className="font-mono text-xs text-slate-500">{l.sku}</span> {l.productName}
                    </Link>
                    <p className="truncate text-xs text-slate-500">{l.categoryName}</p>
                  </Td>
                  <Td className="font-mono text-xs">{l.warehouseCode}</Td>
                  <Td align="right" className="font-medium tabular-nums">{formatNumber(l.quantity)}</Td>
                  <Td align="right" className="tabular-nums">{formatNumber(l.minStockLevel)}</Td>
                  <Td align="right" className="text-red-700 tabular-nums">{formatNumber(l.shortfall)}</Td>
                  <Td align="right" className="tabular-nums">
                    {formatNumber(l.suggestedOrderQuantity)} <span className="text-xs text-slate-400">{l.unitOfMeasure}</span>
                  </Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(l.suggestedOrderValue)}</Td>
                  <Td className="text-slate-500">{l.lastMovementAt ? formatDateTime(l.lastMovementAt) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Suggested order = the larger of the product&apos;s reorder quantity and the shortfall to its minimum.
        </p>
      </Card>
    </>
  );
}
