import { ArrowDownToLine, ArrowUpFromLine, History, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DateRangeFilter } from "@/components/analytics/date-range-filter";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { MovementTypeBadge } from "@/components/movements/movement-type-badge";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getCategoryOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { getMovementReportPage, getMovementReportTotals } from "@/lib/data/reports";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatNumber, formatSignedNumber } from "@/lib/format";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES } from "@/lib/inventory";
import { exportHref, readMovementFilters } from "@/lib/report-filters";
import { buildHref, getPageParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "Stock Movement Report" };

const PAGE_SIZE = 50;

export default async function StockMovementReportPage({ searchParams }: PageProps<"/reports/stock-movements">) {
  const params = await searchParams;
  const filters = readMovementFilters(params);
  const page = getPageParam(params);
  const [warehouses, categories, totals, lines] = await Promise.all([
    getWarehouseOptions(),
    getCategoryOptions(),
    getMovementReportTotals(filters),
    getMovementReportPage(filters, page, PAGE_SIZE),
  ]);
  const netValue = totals.valueIn - totals.valueOut;
  const rangeHidden = filters.range.preset === "custom" ? { from: filters.from, to: filters.to } : { range: filters.range.preset };

  return (
    <>
      <PageHeader
        title="Stock Movement Report"
        description={`Every ledger entry dated ${formatDate(filters.from)} – ${formatDate(filters.to)}. Values at the unit cost each movement was posted at.`}
      />

      <div className="mb-4">
        <DateRangeFilter action="/reports/stock-movements" params={params} range={filters.range} label="Movement date" />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Movements" value={formatNumber(totals.movementCount)} icon={History} />
        <KpiCard label="Units in" value={formatNumber(totals.unitsIn)} icon={ArrowDownToLine} hint={formatCurrency(totals.valueIn)} />
        <KpiCard label="Units out" value={formatNumber(totals.unitsOut)} icon={ArrowUpFromLine} hint={formatCurrency(totals.valueOut)} />
        <KpiCard label="Net change" value={formatSignedNumber(totals.unitsIn - totals.unitsOut)} icon={Scale} hint={`${netValue >= 0 ? "+" : ""}${formatCurrency(netValue)}`} />
      </div>

      <Card>
        <ReportFilterBar
          action="/reports/stock-movements"
          exportUrl={exportHref("/reports/stock-movements/export", params)}
          warehouses={warehouses}
          categories={categories}
          warehouseId={filters.warehouseId}
          categoryId={filters.categoryId}
          hidden={rangeHidden}
          isFiltered={Boolean(filters.warehouseId || filters.categoryId || filters.movementType)}
        >
          <SelectField
            id="report-type"
            name="type"
            label="Type"
            placeholder="All types"
            defaultValue={filters.movementType ?? ""}
            options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
          />
        </ReportFilterBar>

        {lines.rows.length === 0 ? (
          <EmptyState icon={History} title="No movements for these filters" />
        ) : (
          <Table caption="Stock movements">
            <THead>
              <Th>Movement</Th>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Product</Th>
              <Th>Warehouse</Th>
              <Th align="right">Change</Th>
              <Th align="right">Value</Th>
              <Th>Reference / reason</Th>
            </THead>
            <TBody>
              {lines.rows.map((m) => (
                <Tr key={m.movementId}>
                  <Td>
                    <Link href={`/movements/${m.movementId}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                      {m.movementNumber}
                    </Link>
                  </Td>
                  <Td className="text-slate-500">{formatDate(m.businessDate)}</Td>
                  <Td>
                    <MovementTypeBadge type={m.movementType} direction={m.quantityChange} isReversal={m.isReversal} />
                  </Td>
                  <Td className="max-w-64">
                    <p className="truncate">
                      <span className="font-mono text-xs text-slate-500">{m.sku}</span> {m.productName}
                    </p>
                    <p className="truncate text-xs text-slate-500">{m.categoryName}</p>
                  </Td>
                  <Td className="font-mono text-xs">{m.warehouseCode}</Td>
                  <Td align="right" className={cn("font-medium tabular-nums", m.quantityChange > 0 ? "text-emerald-700" : "text-red-700")}>
                    {formatSignedNumber(m.quantityChange)}
                  </Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(m.valueChange)}</Td>
                  <Td className="max-w-60">
                    <p className="truncate">{m.referenceNumber ?? "—"}</p>
                    {m.reason && <p className="truncate text-xs text-slate-500">{m.reason}</p>}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={lines.total}
          hrefForPage={(p) => buildHref("/reports/stock-movements", params, { page: p > 1 ? p : undefined })}
        />
      </Card>
    </>
  );
}
