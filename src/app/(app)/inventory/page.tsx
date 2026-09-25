import { AlertTriangle, Boxes, CircleX, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { SortableTh, Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { canMoveStock } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import {
  getInventoryTotals,
  INVENTORY_SORT_COLUMNS,
  listInventory,
  type InventoryFilters,
  type InventorySortColumn,
} from "@/lib/data/inventory";
import { getCategoryOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { formatCurrency, formatNumber } from "@/lib/format";
import { STOCK_STATUS_LABELS, STOCK_STATUSES } from "@/lib/inventory";
import {
  buildHref,
  getEnumParam,
  getPageParam,
  getSearchParam,
  getSortParam,
  getUuidParam,
  PAGE_SIZE,
} from "@/lib/search-params";

export const metadata: Metadata = { title: "Inventory" };

const SORTABLE: { key: InventorySortColumn; label: string; align?: "right" }[] = [
  { key: "sku", label: "SKU" },
  { key: "product_name", label: "Product" },
  { key: "warehouse_code", label: "Warehouse" },
  { key: "quantity", label: "Quantity", align: "right" },
];

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const params = await searchParams;
  const filters: InventoryFilters = {
    q: getSearchParam(params),
    warehouseId: getUuidParam(params, "warehouse"),
    categoryId: getUuidParam(params, "category"),
    status: getEnumParam(params, "status", STOCK_STATUSES),
    sort: getSortParam(params, INVENTORY_SORT_COLUMNS, { column: "sku", ascending: true }),
    page: getPageParam(params),
  };

  // The cards and the table use the same filters, so the cards always summarise the list below.
  const [user, warehouses, categories, totals, inventory] = await Promise.all([
    getActiveUser(),
    getWarehouseOptions(),
    getCategoryOptions(),
    getInventoryTotals(filters),
    listInventory(filters),
  ]);

  const isFiltered = Boolean(filters.q || filters.warehouseId || filters.categoryId || filters.status);
  const scopeHint = `${formatNumber(totals.lineCount)} lines${isFiltered ? " matching the filters" : ", all warehouses"}`;
  const sortValue = `${filters.sort.ascending ? "" : "-"}${filters.sort.column}`;
  const sortHref = (key: InventorySortColumn) =>
    buildHref("/inventory", params, {
      sort: filters.sort.column === key && filters.sort.ascending ? `-${key}` : key,
      page: undefined,
    });

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand per product and warehouse, valued at current cost price."
        actions={
          user && canMoveStock(user.role) ? <LinkButton href="/movements/new">Adjust stock</LinkButton> : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Inventory value" value={formatCurrency(totals.inventoryValue)} icon={Wallet} hint={scopeHint} />
        <KpiCard label="Units on hand" value={formatNumber(totals.totalQuantity)} icon={Boxes} hint={scopeHint} />
        <KpiCard label="Low stock" value={formatNumber(totals.lowStockCount)} icon={AlertTriangle} hint="Lines at or below minimum" />
        <KpiCard label="Out of stock" value={formatNumber(totals.outOfStockCount)} icon={CircleX} hint="Lines with 0 on hand" />
      </div>

      <Card>
        <FilterBar
          action="/inventory"
          searchLabel="Search inventory"
          searchPlaceholder="SKU or product name"
          searchValue={filters.q}
          hidden={{ sort: sortValue }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-warehouse"
            name="warehouse"
            label="Warehouse"
            placeholder="All warehouses"
            defaultValue={filters.warehouseId ?? ""}
            options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
          />
          <SelectField
            id="filter-category"
            name="category"
            label="Category"
            placeholder="All categories"
            defaultValue={filters.categoryId ?? ""}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            id="filter-status"
            name="status"
            label="Status"
            placeholder="Any status"
            defaultValue={filters.status ?? ""}
            options={STOCK_STATUSES.map((s) => ({ value: s, label: STOCK_STATUS_LABELS[s] }))}
          />
        </FilterBar>

        {inventory.rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={isFiltered ? "No inventory matches these filters" : "No stock recorded yet"}
            description={
              isFiltered
                ? "Try a different search or reset the filters."
                : "Inventory is built only from stock movements. Post a receipt or an adjustment to get started."
            }
          />
        ) : (
          <Table caption="Inventory">
            <THead>
              {SORTABLE.map((col) => (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  href={sortHref(col.key)}
                  active={filters.sort.column === col.key}
                  ascending={filters.sort.ascending}
                />
              ))}
              <Th align="right">Min. stock</Th>
              <Th>Status</Th>
              <SortableTh
                label="Value"
                align="right"
                href={sortHref("inventory_value")}
                active={filters.sort.column === "inventory_value"}
                ascending={filters.sort.ascending}
              />
            </THead>
            <TBody>
              {inventory.rows.map((line) => (
                <Tr key={line.inventoryId}>
                  <Td className="font-mono text-xs">
                    <Link href={`/products/${line.productId}`} className="font-medium text-brand-700 hover:underline">
                      {line.sku}
                    </Link>
                  </Td>
                  <Td className="max-w-80">
                    <p className="truncate font-medium text-slate-900">{line.productName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {line.categoryName}
                      {!line.productIsActive && " · Inactive"}
                    </p>
                  </Td>
                  <Td>
                    <Link href={`/warehouses/${line.warehouseId}`} className="font-mono text-xs hover:underline">
                      {line.warehouseCode}
                    </Link>
                  </Td>
                  <Td align="right" className="font-semibold text-slate-900 tabular-nums">
                    {formatNumber(line.quantity)} <span className="text-xs font-normal text-slate-400">{line.unitOfMeasure}</span>
                  </Td>
                  <Td align="right" className="text-slate-500 tabular-nums">{formatNumber(line.minStockLevel)}</Td>
                  <Td>
                    <StockStatusBadge status={line.stockStatus} />
                  </Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(line.inventoryValue)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={inventory.total}
          hrefForPage={(page) => buildHref("/inventory", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
