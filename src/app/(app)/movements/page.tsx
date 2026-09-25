import { History, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { MovementTable } from "@/components/movements/movement-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { canMoveStock } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getWarehouseOptions } from "@/lib/data/lookups";
import { listMovements } from "@/lib/data/movements";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES } from "@/lib/inventory";
import {
  buildHref,
  getDateParam,
  getEnumParam,
  getPageParam,
  getSearchParam,
  getUuidParam,
  PAGE_SIZE,
} from "@/lib/search-params";

export const metadata: Metadata = { title: "Stock Movements" };

export default async function MovementsPage({ searchParams }: PageProps<"/movements">) {
  const params = await searchParams;
  const filters = {
    q: getSearchParam(params),
    type: getEnumParam(params, "type", MOVEMENT_TYPES),
    warehouseId: getUuidParam(params, "warehouse"),
    productId: getUuidParam(params, "product"),
    from: getDateParam(params, "from"),
    to: getDateParam(params, "to"),
    page: getPageParam(params),
  };

  const [user, warehouses, movements] = await Promise.all([getActiveUser(), getWarehouseOptions(), listMovements(filters)]);
  const isFiltered = Boolean(
    filters.q || filters.type || filters.warehouseId || filters.productId || filters.from || filters.to,
  );

  return (
    <>
      <PageHeader
        title="Stock Movements"
        description="The append-only stock ledger. Every change in quantity is one row here and is never edited."
        actions={
          user && canMoveStock(user.role) ? (
            <LinkButton href="/movements/new">
              <Plus aria-hidden className="size-4" />
              New adjustment
            </LinkButton>
          ) : null
        }
      />

      <Card>
        <FilterBar
          action="/movements"
          searchLabel="Search movements"
          searchPlaceholder="Movement no., SKU, product or reference"
          searchValue={filters.q}
          hidden={{ product: filters.productId }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-type"
            name="type"
            label="Type"
            placeholder="All types"
            defaultValue={filters.type ?? ""}
            options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
          />
          <SelectField
            id="filter-warehouse"
            name="warehouse"
            label="Warehouse"
            placeholder="All warehouses"
            defaultValue={filters.warehouseId ?? ""}
            options={warehouses.map((w) => ({ value: w.id, label: w.code }))}
          />
          <FormField id="filter-from" name="from" type="date" label="From" defaultValue={filters.from} />
          <FormField id="filter-to" name="to" type="date" label="To" defaultValue={filters.to} />
        </FilterBar>

        {filters.productId && (
          <p className="border-b border-slate-100 bg-brand-50/50 px-4 py-2 text-sm text-slate-600">
            Showing movements for one product.{" "}
            <Link href={buildHref("/movements", params, { product: undefined, page: undefined })} className="font-medium text-brand-700 hover:underline">
              Show all products
            </Link>
          </p>
        )}

        {movements.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title={isFiltered ? "No movements match these filters" : "No stock movements yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Post an adjustment to create the first ledger entry."}
          />
        ) : (
          <MovementTable movements={movements.rows} />
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={movements.total}
          hrefForPage={(page) => buildHref("/movements", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
