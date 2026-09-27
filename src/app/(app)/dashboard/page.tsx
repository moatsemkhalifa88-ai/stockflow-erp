import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  CircleX,
  ClipboardList,
  History,
  Package,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import { AlertRow, ALERT_TYPE_LABELS } from "@/components/alerts/alert-parts";
import { DateRangeFilter } from "@/components/analytics/date-range-filter";
import { LowStockBullets } from "@/components/analytics/low-stock-bullets";
import { BarChart } from "@/components/charts/bar-chart";
import { ChartCard, ChartTable } from "@/components/charts/chart-card";
import { formatBucket } from "@/components/charts/chart-format";
import { PurchasesSalesChart } from "@/components/charts/purchases-sales-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { getActiveUser } from "@/lib/auth/session";
import {
  ALERT_TYPES,
  countByType,
  getAlerts,
  getDashboardKpis,
  getMovementsByType,
  getPurchasesVsSales,
  getTopProductsByMovement,
} from "@/lib/data/analytics";
import { getLowStockReport } from "@/lib/data/reports";
import { listWarehouseSummaries } from "@/lib/data/warehouses";
import { bucketFor, readDateRange } from "@/lib/date-range";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { MOVEMENT_TYPE_LABELS } from "@/lib/inventory";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const range = readDateRange(params, "90d");
  const bucket = bucketFor(range);

  const [user, kpis, warehouses, lowStock, alerts, trend, byType, topProducts] = await Promise.all([
    getActiveUser(),
    getDashboardKpis(),
    listWarehouseSummaries(),
    getLowStockReport({}),
    getAlerts(),
    getPurchasesVsSales(range, bucket),
    getMovementsByType(range),
    getTopProductsByMovement(range, 10),
  ]);

  const firstName = user?.fullName.split(" ")[0] ?? "";
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${kpis.monthStart}T00:00:00Z`));
  const warehouseValues = warehouses
    .filter((w) => w.isActive || w.inventoryValue > 0)
    .sort((a, b) => b.inventoryValue - a.inventoryValue);
  const alertCounts = countByType(alerts);
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const periodPurchases = trend.reduce((s, p) => s + p.purchases, 0);
  const periodSales = trend.reduce((s, p) => s + p.sales, 0);
  const periodLabel = `${formatDate(range.from)} – ${formatDate(range.to)}`;

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description={`Inventory and order status as of ${formatDate(kpis.today)}.`}
      />

      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">
          Key figures
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Inventory value" value={formatCurrency(kpis.inventoryValue)} icon={Wallet} hint="At current cost prices" href="/reports/inventory-valuation" />
          <KpiCard label="Active products" value={formatNumber(kpis.totalProducts)} icon={Package} hint="In the catalogue" href="/products" />
          <KpiCard label="Low-stock items" value={formatNumber(kpis.lowStockItems)} icon={AlertTriangle} hint="Product × warehouse at or below minimum" href="/reports/low-stock?status=LOW_STOCK" />
          <KpiCard label="Out-of-stock items" value={formatNumber(kpis.outOfStockItems)} icon={CircleX} hint="Product × warehouse at zero" href="/reports/low-stock?status=OUT_OF_STOCK" />
          <KpiCard label="Movements today" value={formatNumber(kpis.movementsToday)} icon={History} hint="Ledger entries dated today" href="/reports/stock-movements?range=7d" />
          <KpiCard label="Pending purchase orders" value={formatNumber(kpis.pendingPurchaseOrders)} icon={ClipboardList} hint="Submitted, approved or partly received" href="/purchase-orders?status=OPEN" />
          <KpiCard label="Pending sales orders" value={formatNumber(kpis.pendingSalesOrders)} icon={ShoppingCart} hint="Confirmed or processing" href="/sales-orders?status=OPEN" />
          <KpiCard label={`Purchases in ${monthLabel}`} value={formatCurrency(kpis.purchasesMonth)} icon={ArrowDownToLine} hint="Goods received, month to date" />
          <KpiCard label={`Sales in ${monthLabel}`} value={formatCurrency(kpis.salesMonth)} icon={ArrowUpFromLine} hint="Shipped, net of discounts, month to date" />
          <KpiCard
            label="Open alerts"
            value={formatNumber(alerts.length)}
            icon={Bell}
            hint={critical > 0 ? `${formatNumber(critical)} critical` : "None critical"}
            href="/alerts"
          />
        </div>
      </section>

      <section aria-labelledby="now-heading" className="mt-8">
        <h2 id="now-heading" className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Right now
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Inventory value by warehouse"
            description={`${formatCurrency(kpis.inventoryValue)} in total`}
            table={
              <ChartTable
                headers={[{ label: "Warehouse" }, { label: "Units", numeric: true }, { label: "Value", numeric: true }]}
                rows={warehouseValues.map((w) => [`${w.code} · ${w.name}`, formatNumber(w.totalQuantity), formatCurrency(w.inventoryValue)])}
              />
            }
          >
            <BarChart
              seriesLabel="Inventory value"
              format="currency"
              data={warehouseValues.map((w) => ({
                key: w.id,
                label: w.code,
                value: w.inventoryValue,
                details: [
                  { label: "Warehouse", value: w.name },
                  { label: "Units", value: formatNumber(w.totalQuantity) },
                ],
              }))}
            />
          </ChartCard>

          <Card>
            <CardHeader
              title="Low-stock products"
              description="Most urgent first: on hand against the minimum (tick)"
              action={
                <LinkButton href="/reports/low-stock" variant="ghost" size="sm">
                  Full report
                </LinkButton>
              }
            />
            {lowStock.length === 0 ? (
              <EmptyState icon={Package} title="Nothing below minimum" />
            ) : (
              <LowStockBullets lines={lowStock.slice(0, 8)} />
            )}
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader
            title="Alerts"
            description={ALERT_TYPES.filter((t) => alertCounts[t] > 0)
              .map((t) => `${formatNumber(alertCounts[t])} ${ALERT_TYPE_LABELS[t].toLowerCase()}`)
              .join(" · ") || "No open alerts"}
            action={
              <LinkButton href="/alerts" variant="ghost" size="sm">
                Alerts center
              </LinkButton>
            }
          />
          {alerts.length === 0 ? (
            <EmptyState icon={Bell} title="All clear" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.slice(0, 5).map((a) => (
                <AlertRow key={`${a.type}-${a.entityId}-${a.warehouseId}`} alert={a} />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-labelledby="activity-heading" className="mt-8 space-y-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="activity-heading" className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Activity
          </h2>
        </div>
        <DateRangeFilter action="/dashboard" params={params} range={range} />

        <ChartCard
          title="Purchases vs sales"
          description={`${periodLabel} · purchases ${formatCurrency(periodPurchases)} · sales ${formatCurrency(periodSales)} · per ${bucket}`}
          table={
            <ChartTable
              headers={[{ label: bucket === "week" ? "Week of" : bucket === "month" ? "Month" : "Day" }, { label: "Purchases", numeric: true }, { label: "Sales", numeric: true }]}
              rows={trend.map((p) => [formatBucket(p.bucketStart, bucket), formatCurrency(p.purchases), formatCurrency(p.sales)])}
            />
          }
        >
          <PurchasesSalesChart data={trend} bucket={bucket} />
        </ChartCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Movements by type"
            description={`${formatNumber(byType.reduce((s, t) => s + t.movementCount, 0))} ledger entries · ${periodLabel}`}
            table={
              <ChartTable
                headers={[{ label: "Type" }, { label: "Movements", numeric: true }, { label: "Units", numeric: true }, { label: "Value", numeric: true }]}
                rows={byType.map((t) => [MOVEMENT_TYPE_LABELS[t.movementType], formatNumber(t.movementCount), formatNumber(t.units), formatCurrency(t.value)])}
              />
            }
          >
            {byType.length === 0 ? (
              <EmptyState icon={History} title="No movements in this period" />
            ) : (
              <BarChart
                orientation="horizontal"
                seriesLabel="Movements"
                format="number"
                data={byType.map((t) => ({
                  key: t.movementType,
                  label: MOVEMENT_TYPE_LABELS[t.movementType],
                  value: t.movementCount,
                  details: [
                    { label: "Units", value: formatNumber(t.units) },
                    { label: "Value", value: formatCurrency(t.value) },
                  ],
                }))}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Top 10 products by movement"
            description={`Units in + out · ${periodLabel}`}
            table={
              <ChartTable
                headers={[{ label: "Product" }, { label: "In", numeric: true }, { label: "Out", numeric: true }, { label: "Total", numeric: true }]}
                rows={topProducts.map((p) => [`${p.sku} · ${p.productName}`, formatNumber(p.unitsIn), formatNumber(p.unitsOut), formatNumber(p.unitsMoved)])}
              />
            }
          >
            {topProducts.length === 0 ? (
              <EmptyState icon={Package} title="No movements in this period" />
            ) : (
              <BarChart
                orientation="horizontal"
                seriesLabel="Units moved"
                format="number"
                data={topProducts.map((p) => ({
                  key: p.productId,
                  label: p.productName,
                  value: p.unitsMoved,
                  details: [
                    { label: "SKU", value: p.sku },
                    { label: "In", value: formatNumber(p.unitsIn) },
                    { label: "Out", value: formatNumber(p.unitsOut) },
                  ],
                }))}
              />
            )}
          </ChartCard>
        </div>
      </section>
    </>
  );
}
