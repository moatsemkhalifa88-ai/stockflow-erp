import { ArrowLeftRight, ArrowRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { TransferStatusBadge } from "@/components/sales/so-status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { canRequestTransfers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getWarehouseOptions } from "@/lib/data/lookups";
import { listTransfers, type TransferFilters } from "@/lib/data/transfers";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUSES } from "@/lib/sales";
import { buildHref, getEnumParam, getPageParam, getParam, getSearchParam, getUuidParam, PAGE_SIZE } from "@/lib/search-params";

export const metadata: Metadata = { title: "Transfers" };

export default async function TransfersPage({ searchParams }: PageProps<"/transfers">) {
  const params = await searchParams;
  const filters: TransferFilters = {
    q: getSearchParam(params),
    status: getEnumParam(params, "status", TRANSFER_STATUSES),
    warehouseId: getUuidParam(params, "warehouse"),
    page: getPageParam(params),
  };

  const [user, warehouses, transfers] = await Promise.all([getActiveUser(), getWarehouseOptions(), listTransfers(filters)]);
  const isFiltered = Boolean(filters.q || filters.status || filters.warehouseId);
  const currentStatus = getParam(params, "status");

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Move stock between warehouses: request, approval, then execution."
        actions={
          user && canRequestTransfers(user.role) ? (
            <LinkButton href="/transfers/new">
              <Plus aria-hidden className="size-4" />
              Request transfer
            </LinkButton>
          ) : null
        }
      />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        <StatusChip href={buildHref("/transfers", params, { status: undefined, page: undefined })} active={!currentStatus} label="All" />
        {TRANSFER_STATUSES.map((s) => (
          <StatusChip
            key={s}
            href={buildHref("/transfers", params, { status: s, page: undefined })}
            active={currentStatus === s}
            label={TRANSFER_STATUS_LABELS[s]}
          />
        ))}
      </nav>

      <Card>
        <FilterBar
          action="/transfers"
          searchLabel="Search transfers"
          searchPlaceholder="Transfer number"
          searchValue={filters.q}
          hidden={{ status: currentStatus || undefined }}
          isFiltered={isFiltered}
        >
          <SelectField
            id="filter-warehouse"
            name="warehouse"
            label="Warehouse (from or to)"
            placeholder="All warehouses"
            defaultValue={filters.warehouseId ?? ""}
            options={warehouses.map((w) => ({ value: w.id, label: w.code }))}
          />
        </FilterBar>

        {transfers.rows.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={isFiltered ? "No transfers match these filters" : "No transfers yet"}
            description={isFiltered ? "Try a different search or reset the filters." : "Request a transfer to rebalance stock between warehouses."}
          />
        ) : (
          <Table caption="Stock transfers">
            <THead>
              <Th>Transfer</Th>
              <Th>Status</Th>
              <Th>Route</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Units</Th>
              <Th align="right">Value</Th>
              <Th>Requested</Th>
            </THead>
            <TBody>
              {transfers.rows.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <Link href={`/transfers/${t.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                      {t.transferNumber}
                    </Link>
                  </Td>
                  <Td>
                    <TransferStatusBadge status={t.status} />
                  </Td>
                  <Td className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      {t.sourceCode} <ArrowRight aria-label="to" className="size-3.5 text-slate-400" /> {t.destinationCode}
                    </span>
                  </Td>
                  <Td align="right" className="tabular-nums">{formatNumber(t.lineCount)}</Td>
                  <Td align="right" className="tabular-nums">{formatNumber(t.totalQuantity)}</Td>
                  <Td align="right" className="tabular-nums">{formatCurrency(t.totalValue)}</Td>
                  <Td className="text-slate-500">
                    {formatDateTime(t.requestedAt)}
                    {t.requestedByName && <span className="block text-xs">{t.requestedByName}</span>}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={transfers.total}
          hrefForPage={(page) => buildHref("/transfers", params, { page: page > 1 ? page : undefined })}
        />
      </Card>
    </>
  );
}
