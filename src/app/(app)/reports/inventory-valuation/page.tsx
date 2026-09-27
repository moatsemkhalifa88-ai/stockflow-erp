import { Boxes, Layers, Wallet, Warehouse } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getCategoryOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { getValuationReport } from "@/lib/data/reports";
import { businessToday, formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportHref, readValuationFilters } from "@/lib/report-filters";

export const metadata: Metadata = { title: "Inventory Valuation" };

const MAX_ROWS_ON_SCREEN = 500;

export default async function InventoryValuationReportPage({ searchParams }: PageProps<"/reports/inventory-valuation">) {
  const params = await searchParams;
  const today = businessToday();
  const filters = readValuationFilters(params, today);
  const [warehouses, categories, lines] = await Promise.all([getWarehouseOptions(), getCategoryOptions(), getValuationReport(filters)]);

  const totalValue = lines.reduce((s, l) => s + l.inventoryValue, 0);
  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const byWarehouse = [...lines.reduce((m, l) => {
    const w = m.get(l.warehouseId) ?? { code: l.warehouseCode, name: l.warehouseName, units: 0, value: 0, lines: 0 };
    w.units += l.quantity;
    w.value += l.inventoryValue;
    w.lines += 1;
    return m.set(l.warehouseId, w);
  }, new Map<string, { code: string; name: string; units: number; value: number; lines: number }>()).values()].sort((a, b) => b.value - a.value);
  const isToday = filters.asOf === today;

  return (
    <>
      <PageHeader
        title="Inventory Valuation"
        description={`Stock as recorded in the ledger at the end of ${formatDate(filters.asOf)}, valued at current cost prices.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Inventory value" value={formatCurrency(totalValue)} icon={Wallet} hint={isToday ? "Matches the dashboard" : `As of ${formatDate(filters.asOf)}`} />
        <KpiCard label="Units" value={formatNumber(totalUnits)} icon={Boxes} />
        <KpiCard label="Stock lines" value={formatNumber(lines.length)} icon={Layers} hint="Product × warehouse with stock" />
        <KpiCard label="Warehouses" value={formatNumber(byWarehouse.length)} icon={Warehouse} />
      </div>

      <Card>
        <ReportFilterBar
          action="/reports/inventory-valuation"
          exportUrl={exportHref("/reports/inventory-valuation/export", params)}
          warehouses={warehouses}
          categories={categories}
          warehouseId={filters.warehouseId}
          categoryId={filters.categoryId}
          isFiltered={Boolean(filters.warehouseId || filters.categoryId || !isToday)}
        >
          <FormField id="report-as-of" name="as_of" type="date" label="As of" defaultValue={filters.asOf} max={today} />
        </ReportFilterBar>

        {byWarehouse.length > 1 && (
          <div className="border-b border-slate-100">
            <CardHeader title="By warehouse" />
            <Table caption="Inventory value by warehouse">
              <THead>
                <Th>Warehouse</Th>
                <Th align="right">Lines</Th>
                <Th align="right">Units</Th>
                <Th align="right">Value</Th>
                <Th align="right">Share</Th>
              </THead>
              <TBody>
                {byWarehouse.map((w) => (
                  <Tr key={w.code}>
                    <Td>
                      <span className="font-mono text-xs">{w.code}</span> · {w.name}
                    </Td>
                    <Td align="right" className="tabular-nums">{formatNumber(w.lines)}</Td>
                    <Td align="right" className="tabular-nums">{formatNumber(w.units)}</Td>
                    <Td align="right" className="font-medium tabular-nums">{formatCurrency(w.value)}</Td>
                    <Td align="right" className="text-slate-500 tabular-nums">
                      {totalValue > 0 ? `${((w.value / totalValue) * 100).toFixed(1)}%` : "—"}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}

        {lines.length === 0 ? (
          <EmptyState icon={Wallet} title="No stock recorded for these filters on this date" />
        ) : (
          <>
            <Table caption="Inventory valuation lines">
              <THead>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>Warehouse</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Cost price</Th>
                <Th align="right">Value</Th>
              </THead>
              <TBody>
                {lines.slice(0, MAX_ROWS_ON_SCREEN).map((l) => (
                  <Tr key={`${l.productId}-${l.warehouseId}`}>
                    <Td className="font-mono text-xs">
                      <Link href={`/products/${l.productId}`} className="text-brand-700 hover:underline">
                        {l.sku}
                      </Link>
                    </Td>
                    <Td className="max-w-72 truncate">{l.productName}</Td>
                    <Td className="text-slate-500">{l.categoryName}</Td>
                    <Td className="font-mono text-xs">{l.warehouseCode}</Td>
                    <Td align="right" className="tabular-nums">{formatNumber(l.quantity)}</Td>
                    <Td align="right" className="tabular-nums">{formatCurrency(l.costPrice)}</Td>
                    <Td align="right" className="font-medium tabular-nums">{formatCurrency(l.inventoryValue)}</Td>
                  </Tr>
                ))}
              </TBody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
                <tr>
                  <td className="px-4 py-3" colSpan={4}>
                    Total ({formatNumber(lines.length)} lines)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totalUnits)}</td>
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(totalValue)}</td>
                </tr>
              </tfoot>
            </Table>
            {lines.length > MAX_ROWS_ON_SCREEN && (
              <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
                Showing the first {MAX_ROWS_ON_SCREEN} of {formatNumber(lines.length)} lines; totals and the CSV include all of them.
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
