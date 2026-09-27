import { Plus, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SalesOrderTable } from "@/components/sales/so-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { SortLinks } from "@/components/ui/sort-links";
import { StatusChip } from "@/components/ui/status-chip";
import { canManageSalesOrders } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getCustomerOptions, getWarehouseOptions } from "@/lib/data/lookups";
import {
  getSalesOrderStatusCounts,
  listSalesOrders,
  SO_SORT_COLUMNS,
  type SalesOrderFilters,
  type SalesOrderSortColumn,
} from "@/lib/data/sales-orders";
import { businessToday } from "@/lib/format";
import { SALES_ORDER_STATUSES, SO_STATUS_LABELS } from "@/lib/sales";
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

export const metadata: Metadata = { title: "Sales Orders" };

const SORT_LABELS: Record<SalesOrderSortColumn, string> = {
  so_number: "SO number",
  order_date: "Order date",
  requested_delivery_date: "Requested delivery",
  customer_name: "Customer",
  total_amount: "Total",
};

export default async function SalesOrdersPage({ searchParams }: PageProps<"/sales-orders">) {
  const params = await searchParams;
  const filters: SalesOrderFilters = {
    q: getSearchParam(params),
    status: getEnumParam(params, "status", SALES_ORDER_STATUSES),
    openOnly: getParam(params, "status") === "OPEN",
    customerId: getUuidParam(params, "customer"),
    warehouseId: getUuidParam(params, "warehouse"),
    from: getDateParam(params, "from"),
    to: getDateParam(params, "to"),
    sort: getSortParam(params, SO_SORT_COLUMNS, { column: "order_date", ascending: false }),
    page: getPageParam(params),
  };

  const [user, customers, warehouses, counts, orders] = await Promise.all([
    getActiveUser(),
    getCustomerOptions(),
    getWarehouseOptions(),
    getSalesOrderStatusCounts(),
    listSalesOrders(filters),
  ]);
  const isFiltered = Boolean(
    filters.q || filters.status || filters.openOnly || filters.customerId || filters.warehouseId || filters.from || filters.to,
  );
  const sortValue = `${filters.sort.ascending ? "" : "-"}${filters.sort.column}`;
  const currentStatus = getParam(params, "status");

  return (
    <>
      <PageHeader
        title="Sales Orders"
        description="Draft, confirm, pick and ship customer orders."
        actions={
          user && canManageSalesOrders(user.role) ? (
            <LinkButton href="/sales-orders/new">
              <Plus aria-hidden className="size-4" />
              New sales order
            </LinkButton>
          ) : null
        }
      />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        <StatusChip href={buildHref("/sales-orders", params, { status: undefined, page: undefined })} active={!currentStatus} label="All" />
        <StatusChip
          href={buildHref("/sales-orders", params, { status: "OPEN", page: undefined })}
          active={currentStatus === "OPEN"}
          label="Open"
          count={counts.CONFIRMED + counts.PROCESSING}
        />
        {SALES_ORDER_STATUSES.map((s) => (
          <StatusChip
            key={s}
            href={buildHref("/sales-orders", params, { status: s, page: undefined })}
            active={currentStatus === s}
            label={SO_STATUS_LABELS[s]}
            count={counts[s]}
          />
        ))}
      </nav>

      <Card>
        <FilterBar
          action="/sales-orders"
          searchLabel="Search sales orders"
          searchPlaceholder="SO number or customer"
          searchValue={filters.q}
          hidden={{ sort: sortValue, status: currentStatus || undefined }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-customer"
            name="customer"
            label="Customer"
            placeholder="All customers"
            defaultValue={filters.customerId ?? ""}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
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
          options={SO_SORT_COLUMNS.map((key) => ({
            key,
            label: SORT_LABELS[key],
            href: buildHref("/sales-orders", params, {
              sort: filters.sort.column === key && !filters.sort.ascending ? key : `-${key}`,
              page: undefined,
            }),
          }))}
        />

        {orders.rows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={isFiltered ? "No sales orders match these filters" : "No sales orders yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Create the first sales order."}
          />
        ) : (
          <SalesOrderTable orders={orders.rows} today={businessToday()} />
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={orders.total}
          hrefForPage={(page) => buildHref("/sales-orders", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
