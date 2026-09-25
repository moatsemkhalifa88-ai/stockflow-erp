import { PackageSearch, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { SortableTh, Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { canManageProducts } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getCategoryOptions } from "@/lib/data/lookups";
import {
  listProducts,
  PRODUCT_ACTIVITY_FILTERS,
  PRODUCT_SORT_COLUMNS,
  type ProductSortColumn,
} from "@/lib/data/products";
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

export const metadata: Metadata = { title: "Products" };

const COLUMNS: { key: ProductSortColumn; label: string; align?: "right" }[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "Product" },
  { key: "category_name", label: "Category" },
  { key: "cost_price", label: "Cost", align: "right" },
  { key: "sale_price", label: "Price", align: "right" },
  { key: "total_quantity", label: "On hand", align: "right" },
  { key: "inventory_value", label: "Value", align: "right" },
];

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const params = await searchParams;
  const filters = {
    q: getSearchParam(params),
    categoryId: getUuidParam(params, "category"),
    activity: getEnumParam(params, "active", PRODUCT_ACTIVITY_FILTERS) ?? "active",
    stockStatus: getEnumParam(params, "stock", STOCK_STATUSES),
    sort: getSortParam(params, PRODUCT_SORT_COLUMNS, { column: "sku", ascending: true }),
    page: getPageParam(params),
  };

  const [user, categories, products] = await Promise.all([getActiveUser(), getCategoryOptions(), listProducts(filters)]);
  const isFiltered = Boolean(filters.q || filters.categoryId || filters.stockStatus || filters.activity !== "active");
  const sortValue = `${filters.sort.ascending ? "" : "-"}${filters.sort.column}`;

  return (
    <>
      <PageHeader
        title="Products"
        description="Product catalogue with stock on hand across all warehouses."
        actions={
          user && canManageProducts(user.role) ? (
            <LinkButton href="/products/new">
              <Plus aria-hidden className="size-4" />
              New product
            </LinkButton>
          ) : null
        }
      />

      <Card>
        <FilterBar
          action="/products"
          searchLabel="Search products"
          searchPlaceholder="SKU, name or barcode"
          searchValue={filters.q}
          hidden={{ sort: sortValue }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-category"
            name="category"
            label="Category"
            placeholder="All categories"
            defaultValue={filters.categoryId ?? ""}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            id="filter-stock"
            name="stock"
            label="Stock status"
            placeholder="Any stock status"
            defaultValue={filters.stockStatus ?? ""}
            options={STOCK_STATUSES.map((s) => ({ value: s, label: STOCK_STATUS_LABELS[s] }))}
          />
          <SelectField
            id="filter-active"
            name="active"
            label="Status"
            defaultValue={filters.activity}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All products" },
            ]}
          />
        </FilterBar>

        {products.rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={isFiltered ? "No products match these filters" : "No products yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Create the first product to get started."}
          />
        ) : (
          <Table caption="Products">
            <THead>
              {COLUMNS.map((col) => (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  active={filters.sort.column === col.key}
                  ascending={filters.sort.ascending}
                  href={buildHref("/products", params, {
                    sort: filters.sort.column === col.key && filters.sort.ascending ? `-${col.key}` : col.key,
                    page: undefined,
                  })}
                />
              ))}
              <Th>Stock status</Th>
            </THead>
            <TBody>
              {products.rows.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-mono text-xs">
                    <Link href={`/products/${p.id}`} className="font-medium text-brand-700 hover:underline">
                      {p.sku}
                    </Link>
                  </Td>
                  <Td className="max-w-80">
                    <Link href={`/products/${p.id}`} className="block truncate font-medium text-slate-900 hover:underline">
                      {p.name}
                    </Link>
                    {!p.isActive && <Badge className="mt-1">Inactive</Badge>}
                  </Td>
                  <Td>{p.categoryName}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(p.costPrice)}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(p.salePrice)}</Td>
                  <Td align="right" className="font-medium tabular-nums">
                    {formatNumber(p.totalQuantity)} <span className="text-xs font-normal text-slate-400">{p.unitOfMeasure}</span>
                  </Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(p.inventoryValue)}</Td>
                  <Td>
                    <StockStatusBadge status={p.stockStatus} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={products.total}
          hrefForPage={(page) => buildHref("/products", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
