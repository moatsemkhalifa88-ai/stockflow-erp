import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { AlertRow, ALERT_TYPE_LABELS, SeverityBadge } from "@/components/alerts/alert-parts";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { SelectField } from "@/components/ui/select-field";
import { StatusChip } from "@/components/ui/status-chip";
import { ALERT_SEVERITIES, ALERT_TYPES, countByType, getAlerts } from "@/lib/data/analytics";
import { getWarehouseOptions } from "@/lib/data/lookups";
import { buildHref, getEnumParam, getSearchParam, getUuidParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "Alerts" };

const RULES: { label: string; rule: string }[] = [
  { label: "Out of stock", rule: "An active product at an active warehouse has 0 on hand (critical)." },
  { label: "Low stock", rule: "On hand is at or below the product's minimum stock level (warning)." },
  { label: "Delayed purchase order", rule: "Approved or partly received and past its expected delivery (critical after 7 days)." },
  { label: "Unprocessed sales order", rule: "Confirmed or processing for over 2 days, or past the requested delivery (critical)." },
  { label: "PO waiting for approval", rule: "Submitted, not yet approved by an administrator." },
  { label: "Pending transfer", rule: "Requested or approved, not yet executed." },
];

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const params = await searchParams;
  const type = getEnumParam(params, "type", ALERT_TYPES);
  const severity = getEnumParam(params, "severity", ALERT_SEVERITIES);
  const warehouseId = getUuidParam(params, "warehouse");
  const q = getSearchParam(params).toLowerCase();

  const [all, warehouses] = await Promise.all([getAlerts(), getWarehouseOptions()]);
  const counts = countByType(all);
  const shown = all.filter(
    (a) =>
      (!type || a.type === type) &&
      (!severity || a.severity === severity) &&
      (!warehouseId || a.warehouseId === warehouseId) &&
      (!q || `${a.reference} ${a.title} ${a.detail}`.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Computed live from the data - nothing to acknowledge. An alert disappears once its cause is fixed."
      />

      <nav aria-label="Filter by alert type" className="mb-4 flex flex-wrap gap-2">
        <StatusChip href={buildHref("/alerts", params, { type: undefined })} active={!type} label="All" count={all.length} />
        {ALERT_TYPES.map((t) => (
          <StatusChip key={t} href={buildHref("/alerts", params, { type: t })} active={type === t} label={ALERT_TYPE_LABELS[t]} count={counts[t]} />
        ))}
      </nav>

      <Card>
        <FilterBar
          action="/alerts"
          searchLabel="Search alerts"
          searchPlaceholder="SKU, order number, supplier or customer"
          searchValue={getSearchParam(params)}
          hidden={{ type }}
          isFiltered={Boolean(type || severity || warehouseId || q)}
        >
          <SelectField
            id="filter-severity"
            name="severity"
            label="Severity"
            placeholder="Any severity"
            defaultValue={severity ?? ""}
            options={ALERT_SEVERITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
          />
          <SelectField
            id="filter-warehouse"
            name="warehouse"
            label="Warehouse"
            placeholder="All warehouses"
            defaultValue={warehouseId ?? ""}
            options={warehouses.map((w) => ({ value: w.id, label: w.code }))}
          />
        </FilterBar>

        {shown.length === 0 ? (
          <EmptyState icon={Bell} title={all.length === 0 ? "All clear" : "No alerts match these filters"} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((a) => (
              <AlertRow key={`${a.type}-${a.entityId}-${a.warehouseId}`} alert={a} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="How alerts are raised" description="Each rule is a query in the v_alerts view; there is no alerts table to go stale." />
        <dl className="divide-y divide-slate-100 text-sm">
          {RULES.map((r) => (
            <div key={r.label} className="flex flex-col gap-1 px-5 py-2.5 sm:flex-row sm:gap-4">
              <dt className="w-56 shrink-0 font-medium text-slate-900">{r.label}</dt>
              <dd className="text-slate-600">{r.rule}</dd>
            </div>
          ))}
        </dl>
        <p className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Severity: <SeverityBadge severity="critical" /> <SeverityBadge severity="warning" /> <SeverityBadge severity="info" />
        </p>
      </Card>
    </>
  );
}
