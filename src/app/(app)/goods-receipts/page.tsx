import { PackageCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AwaitingDelivery } from "@/components/purchasing/awaiting-delivery";
import { ReceiptTable } from "@/components/purchasing/receipt-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { canReceiveGoods } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { listGoodsReceipts, type GoodsReceiptFilters } from "@/lib/data/goods-receipts";
import { getSupplierOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { getPurchaseOrdersAwaitingDelivery } from "@/lib/data/purchase-orders";
import { businessToday } from "@/lib/format";
import { buildHref, getDateParam, getPageParam, getSearchParam, getUuidParam, PAGE_SIZE } from "@/lib/search-params";

export const metadata: Metadata = { title: "Goods Receipts" };

export default async function GoodsReceiptsPage({ searchParams }: PageProps<"/goods-receipts">) {
  const params = await searchParams;
  const filters: GoodsReceiptFilters = {
    q: getSearchParam(params),
    warehouseId: getUuidParam(params, "warehouse"),
    supplierId: getUuidParam(params, "supplier"),
    from: getDateParam(params, "from"),
    to: getDateParam(params, "to"),
    page: getPageParam(params),
  };

  const [user, suppliers, warehouses, receipts, awaiting] = await Promise.all([
    getActiveUser(),
    getSupplierOptions(),
    getWarehouseOptions(),
    listGoodsReceipts(filters),
    getPurchaseOrdersAwaitingDelivery(),
  ]);
  const isFiltered = Boolean(filters.q || filters.warehouseId || filters.supplierId || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Goods Receipts"
        description="Deliveries received against approved purchase orders. Each receipt posts its lines to the stock ledger."
      />
      <AwaitingDelivery orders={awaiting} canReceive={user !== null && canReceiveGoods(user.role)} today={businessToday()} />
      <Card>
        <FilterBar
          action="/goods-receipts"
          searchLabel="Search receipts"
          searchPlaceholder="Receipt no., PO number or supplier"
          searchValue={filters.q}
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
          <FormField id="filter-from" name="from" type="date" label="Received from" defaultValue={filters.from} />
          <FormField id="filter-to" name="to" type="date" label="Received to" defaultValue={filters.to} />
        </FilterBar>

        {receipts.rows.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title={isFiltered ? "No receipts match these filters" : "No goods received yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Receipts appear here once goods are received against an order above."}
          />
        ) : (
          <ReceiptTable receipts={receipts.rows} />
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={receipts.total}
          hrefForPage={(page) => buildHref("/goods-receipts", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
