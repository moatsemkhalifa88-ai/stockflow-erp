import { ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderTable } from "@/components/purchasing/po-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { SortLinks } from "@/components/ui/sort-links";
import { canManagePurchaseOrders } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { getSupplierOptions, getWarehouseOptions } from "@/lib/data/lookups";
import {
  getPurchaseOrderStatusCounts,
  listPurchaseOrders,
  PO_SORT_COLUMNS,
  type PurchaseOrderFilters,
  type PurchaseOrderSortColumn,
} from "@/lib/data/purchase-orders";
import { businessToday, formatNumber } from "@/lib/format";
import { PO_STATUS_LABELS, PURCHASE_ORDER_STATUSES } from "@/lib/purchasing";
import {
  buildHref,
  getDateParam,
  getEnumParam,
  getPageParam,
  getParam,
  getSearchParam,
  getSortParam,
  getUuidParam,
  PAGE_SIZE,
} from "@/lib/search-params";

export const metadata: Metadata = { title: "Purchase Orders" };

const SORT_LABELS: Record<PurchaseOrderSortColumn, string> = {
  po_number: "PO number",
  order_date: "Order date",
  expected_delivery_date: "Expected delivery",
  supplier_name: "Supplier",
  total_amount: "Total",
};

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/purchase-orders">) {
  const params = await searchParams;
  const filters: PurchaseOrderFilters = {
    q: getSearchParam(params),
    status: getEnumParam(params, "status", PURCHASE_ORDER_STATUSES),
    openOnly: getParam(params, "status") === "OPEN",
    supplierId: getUuidParam(params, "supplier"),
    warehouseId: getUuidParam(params, "warehouse"),
    from: getDateParam(params, "from"),
    to: getDateParam(params, "to"),
    sort: getSortParam(params, PO_SORT_COLUMNS, { column: "order_date", ascending: false }),
    page: getPageParam(params),
  };

  const [user, suppliers, warehouses, counts, orders] = await Promise.all([
    getActiveUser(),
    getSupplierOptions(),
    getWarehouseOptions(),
    getPurchaseOrderStatusCounts(),
    listPurchaseOrders(filters),
  ]);
  const isFiltered = Boolean(
    filters.q || filters.status || filters.openOnly || filters.supplierId || filters.warehouseId || filters.from || filters.to,
  );
  const sortValue = `${filters.sort.ascending ? "" : "-"}${filters.sort.column}`;
  const currentStatus = getParam(params, "status");
  const openCount = counts.SUBMITTED + counts.APPROVED + counts.PARTIALLY_RECEIVED;

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description="Draft, submit, approve and receive orders from suppliers."
        actions={
          user && canManagePurchaseOrders(user.role) ? (
            <LinkButton href="/purchase-orders/new">
              <Plus aria-hidden className="size-4" />
              New purchase order
            </LinkButton>
          ) : null
        }
      />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        <StatusChip href={buildHref("/purchase-orders", params, { status: undefined, page: undefined })} active={!currentStatus} label="All" />
        <StatusChip
          href={buildHref("/purchase-orders", params, { status: "OPEN", page: undefined })}
          active={currentStatus === "OPEN"}
          label="Open"
          count={openCount}
        />
        {PURCHASE_ORDER_STATUSES.map((s) => (
          <StatusChip
            key={s}
            href={buildHref("/purchase-orders", params, { status: s, page: undefined })}
            active={currentStatus === s}
            label={PO_STATUS_LABELS[s]}
            count={counts[s]}
          />
        ))}
      </nav>

      <Card>
        <FilterBar
          action="/purchase-orders"
          searchLabel="Search purchase orders"
          searchPlaceholder="PO number or supplier"
          searchValue={filters.q}
          hidden={{ sort: sortValue, status: currentStatus || undefined }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-supplier"
            name="supplier"
            label="Supplier"
            placeholder="All suppliers"
            defaultValue={filters.supplierId ?? ""}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          <SelectField
            id="filter-warehouse"
            name="warehouse"
            label="Warehouse"
            placeholder="All warehouses"
            defaultValue={filters.warehouseId ?? ""}
            options={warehouses.map((w) => ({ value: w.id, label: w.code }))}
          />
          <FormField id="filter-from" name="from" type="date" label="Ordered from" defaultValue={filters.from} />
          <FormField id="filter-to" name="to" type="date" label="Ordered to" defaultValue={filters.to} />
        </FilterBar>

        <SortLinks
          active={filters.sort.column}
          ascending={filters.sort.ascending}
          options={PO_SORT_COLUMNS.map((key) => ({
            key,
            label: SORT_LABELS[key],
            href: buildHref("/purchase-orders", params, {
              // First click sorts descending (newest / largest first), the next click flips it.
              sort: filters.sort.column === key && !filters.sort.ascending ? key : `-${key}`,
              page: undefined,
            }),
          }))}
        />

        {orders.rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={isFiltered ? "No purchase orders match these filters" : "No purchase orders yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Create the first purchase order to start buying stock."}
          />
        ) : (
          <PurchaseOrderTable orders={orders.rows} today={businessToday()} />
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={orders.total}
          hrefForPage={(page) => buildHref("/purchase-orders", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}

function StatusChip({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
        active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {label}
      {count !== undefined && <span className={cn("tabular-nums", active ? "text-white/80" : "text-slate-400")}>{formatNumber(count)}</span>}
    </Link>
  );
}
