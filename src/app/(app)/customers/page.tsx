import { Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { SortableTh, Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { canManageCustomers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import {
  CUSTOMER_ACTIVITY_FILTERS,
  CUSTOMER_SORT_COLUMNS,
  listCustomers,
  type CustomerFilters,
  type CustomerSortColumn,
} from "@/lib/data/customers";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES, customerTypeLabel } from "@/lib/sales";
import { buildHref, getEnumParam, getPageParam, getParam, getSearchParam, getSortParam, PAGE_SIZE } from "@/lib/search-params";

export const metadata: Metadata = { title: "Customers" };

const COLUMNS: { key: CustomerSortColumn; label: string; align?: "right" }[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Customer" },
  { key: "city", label: "City" },
  { key: "total_sales_value", label: "Sales value", align: "right" },
  { key: "open_count", label: "Open orders", align: "right" },
  { key: "last_order_date", label: "Last order" },
];

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const params = await searchParams;
  const filters: CustomerFilters = {
    q: getSearchParam(params),
    customerType: getEnumParam(params, "type", CUSTOMER_TYPES),
    activity: getEnumParam(params, "active", CUSTOMER_ACTIVITY_FILTERS) ?? "active",
    openOnly: getParam(params, "open") === "1",
    sort: getSortParam(params, CUSTOMER_SORT_COLUMNS, { column: "code", ascending: true }),
    page: getPageParam(params),
  };

  const [user, customers] = await Promise.all([getActiveUser(), listCustomers(filters)]);
  const isFiltered = Boolean(filters.q || filters.customerType || filters.openOnly || filters.activity !== "active");
  const sortValue = `${filters.sort.ascending ? "" : "-"}${filters.sort.column}`;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Accounts with their sales value and open orders."
        actions={
          user && canManageCustomers(user.role) ? (
            <LinkButton href="/customers/new">
              <Plus aria-hidden className="size-4" />
              New customer
            </LinkButton>
          ) : null
        }
      />

      <Card>
        <FilterBar
          action="/customers"
          searchLabel="Search customers"
          searchPlaceholder="Code, name, contact, email or city"
          searchValue={filters.q}
          hidden={{ sort: sortValue }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-type"
            name="type"
            label="Type"
            placeholder="All types"
            defaultValue={filters.customerType ?? ""}
            options={CUSTOMER_TYPES.map((t) => ({ value: t, label: CUSTOMER_TYPE_LABELS[t] }))}
          />
          <SelectField
            id="filter-open"
            name="open"
            label="Orders"
            defaultValue={filters.openOnly ? "1" : ""}
            options={[
              { value: "", label: "All customers" },
              { value: "1", label: "With open orders" },
            ]}
          />
          <SelectField
            id="filter-active"
            name="active"
            label="Status"
            defaultValue={filters.activity}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All customers" },
            ]}
          />
        </FilterBar>

        {customers.rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={isFiltered ? "No customers match these filters" : "No customers yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Create the first customer to start selling."}
          />
        ) : (
          <Table caption="Customers">
            <THead>
              {COLUMNS.map((col) => (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  active={filters.sort.column === col.key}
                  ascending={filters.sort.ascending}
                  href={buildHref("/customers", params, {
                    sort: filters.sort.column === col.key && filters.sort.ascending ? `-${col.key}` : col.key,
                    page: undefined,
                  })}
                />
              ))}
              <Th>Type</Th>
              <Th>Status</Th>
            </THead>
            <TBody>
              {customers.rows.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs">
                    <Link href={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.code}
                    </Link>
                  </Td>
                  <Td className="max-w-72">
                    <Link href={`/customers/${c.id}`} className="block truncate font-medium text-slate-900 hover:underline">
                      {c.name}
                    </Link>
                    {c.contactName && <p className="truncate text-xs text-slate-500">{c.contactName}</p>}
                  </Td>
                  <Td>{c.city ?? <span className="text-slate-400">—</span>}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(c.totalSalesValue)}</Td>
                  <Td align="right" className="tabular-nums">
                    {c.openCount > 0 ? <Badge tone="info">{formatNumber(c.openCount)}</Badge> : "0"}
                  </Td>
                  <Td className="text-slate-500">{c.lastOrderDate ? formatDate(c.lastOrderDate) : "—"}</Td>
                  <Td>{customerTypeLabel(c.customerType)}</Td>
                  <Td>
                    <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={customers.total}
          hrefForPage={(page) => buildHref("/customers", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
