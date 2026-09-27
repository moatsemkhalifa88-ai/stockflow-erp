import { Plus, Truck } from "lucide-react";
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
import { canManageSuppliers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import {
  listSuppliers,
  SUPPLIER_ACTIVITY_FILTERS,
  SUPPLIER_SORT_COLUMNS,
  type SupplierFilters,
  type SupplierSortColumn,
} from "@/lib/data/suppliers";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import {
  buildHref,
  getEnumParam,
  getPageParam,
  getParam,
  getSearchParam,
  getSortParam,
  PAGE_SIZE,
} from "@/lib/search-params";

export const metadata: Metadata = { title: "Suppliers" };

const COLUMNS: { key: SupplierSortColumn; label: string; align?: "right" }[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Supplier" },
  { key: "city", label: "City" },
  { key: "total_purchase_value", label: "Purchase value", align: "right" },
  { key: "outstanding_count", label: "Open orders", align: "right" },
  { key: "last_order_date", label: "Last order" },
];

export default async function SuppliersPage({ searchParams }: PageProps<"/suppliers">) {
  const params = await searchParams;
  const filters: SupplierFilters = {
    q: getSearchParam(params),
    activity: getEnumParam(params, "active", SUPPLIER_ACTIVITY_FILTERS) ?? "active",
    outstandingOnly: getParam(params, "open") === "1",
    sort: getSortParam(params, SUPPLIER_SORT_COLUMNS, { column: "code", ascending: true }),
    page: getPageParam(params),
  };

  const [user, suppliers] = await Promise.all([getActiveUser(), listSuppliers(filters)]);
  const isFiltered = Boolean(filters.q || filters.outstandingOnly || filters.activity !== "active");
  const sortValue = `${filters.sort.ascending ? "" : "-"}${filters.sort.column}`;

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Vendors with their purchase value and open orders."
        actions={
          user && canManageSuppliers(user.role) ? (
            <LinkButton href="/suppliers/new">
              <Plus aria-hidden className="size-4" />
              New supplier
            </LinkButton>
          ) : null
        }
      />

      <Card>
        <FilterBar
          action="/suppliers"
          searchLabel="Search suppliers"
          searchPlaceholder="Code, name, contact, email or city"
          searchValue={filters.q}
          hidden={{ sort: sortValue }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-open"
            name="open"
            label="Orders"
            defaultValue={filters.outstandingOnly ? "1" : ""}
            options={[
              { value: "", label: "All suppliers" },
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
              { value: "all", label: "All suppliers" },
            ]}
          />
        </FilterBar>

        {suppliers.rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={isFiltered ? "No suppliers match these filters" : "No suppliers yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Create the first supplier to start purchasing."}
          />
        ) : (
          <Table caption="Suppliers">
            <THead>
              {COLUMNS.map((col) => (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  active={filters.sort.column === col.key}
                  ascending={filters.sort.ascending}
                  href={buildHref("/suppliers", params, {
                    sort: filters.sort.column === col.key && filters.sort.ascending ? `-${col.key}` : col.key,
                    page: undefined,
                  })}
                />
              ))}
              <Th>Status</Th>
            </THead>
            <TBody>
              {suppliers.rows.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-mono text-xs">
                    <Link href={`/suppliers/${s.id}`} className="font-medium text-brand-700 hover:underline">
                      {s.code}
                    </Link>
                  </Td>
                  <Td className="max-w-72">
                    <Link href={`/suppliers/${s.id}`} className="block truncate font-medium text-slate-900 hover:underline">
                      {s.name}
                    </Link>
                    {s.contactName && <p className="truncate text-xs text-slate-500">{s.contactName}</p>}
                  </Td>
                  <Td>{s.city ?? <span className="text-slate-400">—</span>}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(s.totalPurchaseValue)}</Td>
                  <Td align="right" className="tabular-nums">
                    {s.outstandingCount > 0 ? <Badge tone="info">{formatNumber(s.outstandingCount)}</Badge> : "0"}
                  </Td>
                  <Td className="text-slate-500">{s.lastOrderDate ? formatDate(s.lastOrderDate) : "—"}</Td>
                  <Td>
                    <Badge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? "Active" : "Inactive"}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={suppliers.total}
          hrefForPage={(page) => buildHref("/suppliers", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
