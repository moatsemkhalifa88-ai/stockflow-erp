import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuditRaw, AuditSummary } from "@/components/audit/audit-details";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { LinkButton } from "@/components/ui/link-button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getActiveUser } from "@/lib/auth/session";
import { AUDIT_PAGE_SIZE, getAuditFacets, listAuditLog, type AuditFilters } from "@/lib/data/audit";
import { formatDateTime, formatNumber } from "@/lib/format";
import { buildHref, getDateParam, getPageParam, getParam, isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Audit Log" };

/** Where an audited record lives in the app. */
const ENTITY_PATHS: Record<string, string> = {
  products: "/products",
  warehouses: "/warehouses",
  suppliers: "/suppliers",
  customers: "/customers",
  purchase_orders: "/purchase-orders",
  goods_receipts: "/goods-receipts",
  sales_orders: "/sales-orders",
  stock_transfers: "/transfers",
  stock_movements: "/movements",
};

const ENTITY_LABELS: Record<string, string> = {
  products: "Product",
  warehouses: "Warehouse",
  suppliers: "Supplier",
  customers: "Customer",
  categories: "Category",
  profiles: "User",
  roles: "Role",
  purchase_orders: "Purchase order",
  goods_receipts: "Goods receipt",
  sales_orders: "Sales order",
  stock_transfers: "Transfer",
  stock_movements: "Stock movement",
};

function actionTone(action: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (/CANCEL|REJECT|REVERS|DELETE/.test(action)) return "danger";
  if (/APPROVE|SHIP|RECEIPT|EXECUTE|COMPLETE/.test(action)) return "success";
  if (/UPDATE/.test(action)) return "warning";
  if (/INSERT|CREATE|REQUEST|SUBMIT|CONFIRM/.test(action)) return "info";
  return "neutral";
}

export default async function AuditLogPage({ searchParams }: PageProps<"/audit-log">) {
  const user = await getActiveUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const facets = await getAuditFacets();
  const pick = (key: string, allowed: { value: string }[]) => {
    const v = getParam(params, key);
    return allowed.some((a) => a.value === v) ? v : undefined;
  };
  const entityId = getParam(params, "entity_id");
  const filters: AuditFilters = {
    action: pick("action", facets.actions),
    entityType: pick("entity", facets.entityTypes),
    user: pick("user", facets.users),
    entityId: entityId && (isUuid(entityId) || /^\d+$/.test(entityId)) ? entityId : undefined,
    from: getDateParam(params, "from"),
    to: getDateParam(params, "to"),
    page: getPageParam(params),
  };
  const entries = await listAuditLog(filters);
  const isFiltered = Boolean(filters.action || filters.entityType || filters.user || filters.entityId || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Every master-data change and every workflow step, with who did it and when. Entries can never be edited or deleted."
      />

      <Card>
        <Form action="/audit-log" className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          {filters.entityId && <input type="hidden" name="entity_id" value={filters.entityId} />}
          <SelectField
            id="audit-entity"
            name="entity"
            label="Entity"
            placeholder="All entities"
            defaultValue={filters.entityType ?? ""}
            options={facets.entityTypes.map((f) => ({ value: f.value, label: `${ENTITY_LABELS[f.value] ?? f.value} (${formatNumber(f.entries)})` }))}
          />
          <SelectField
            id="audit-action"
            name="action"
            label="Action"
            placeholder="All actions"
            defaultValue={filters.action ?? ""}
            options={facets.actions.map((f) => ({ value: f.value, label: `${f.value} (${formatNumber(f.entries)})` }))}
          />
          <SelectField
            id="audit-user"
            name="user"
            label="User"
            placeholder="All users"
            defaultValue={filters.user ?? ""}
            options={facets.users.map((f) => ({ value: f.value, label: `${f.value} (${formatNumber(f.entries)})` }))}
          />
          <FormField id="audit-from" name="from" type="date" label="From" defaultValue={filters.from} />
          <FormField id="audit-to" name="to" type="date" label="To" defaultValue={filters.to} />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {isFiltered && (
              <LinkButton href="/audit-log" variant="ghost">
                Reset
              </LinkButton>
            )}
          </div>
        </Form>

        {filters.entityId && (
          <p className="border-b border-slate-100 bg-brand-50/50 px-4 py-2 text-sm text-slate-600">
            Showing the history of one record.{" "}
            <Link href={buildHref("/audit-log", params, { entity_id: undefined, page: undefined })} className="font-medium text-brand-700 hover:underline">
              Show all
            </Link>
          </p>
        )}

        {entries.rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No audit entries match these filters" />
        ) : (
          <Table caption="Audit log">
            <THead>
              <Th>When</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Details</Th>
            </THead>
            <TBody>
              {entries.rows.map((e) => {
                const base = ENTITY_PATHS[e.entityType];
                const linkable = base && e.entityId && isUuid(e.entityId) && e.action !== "DELETE";
                return (
                  <Tr key={e.id} className="align-top">
                    <Td className="text-slate-500">{formatDateTime(e.occurredAt)}</Td>
                    <Td>{e.userEmail ?? <span className="text-slate-400">System</span>}</Td>
                    <Td>
                      <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                    </Td>
                    <Td>
                      <p>{ENTITY_LABELS[e.entityType] ?? e.entityType}</p>
                      {e.entityId &&
                        (linkable ? (
                          <Link href={`${base}/${e.entityId}`} className="font-mono text-xs text-brand-700 hover:underline">
                            {e.entityId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-slate-400">{e.entityId.slice(0, 8)}</span>
                        ))}
                      {e.entityId && !filters.entityId && (
                        <Link
                          href={buildHref("/audit-log", {}, { entity_id: e.entityId })}
                          className="block text-xs text-slate-500 hover:text-slate-800 hover:underline"
                        >
                          History
                        </Link>
                      )}
                    </Td>
                    <Td className="max-w-xl text-xs whitespace-normal text-slate-600">
                      <AuditSummary details={e.details} oldValues={e.oldValues} />
                      <AuditRaw details={e.details} oldValues={e.oldValues} newValues={e.newValues} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={AUDIT_PAGE_SIZE}
          total={entries.total}
          hrefForPage={(p) => buildHref("/audit-log", params, { page: p > 1 ? p : undefined })}
        />
      </Card>
    </>
  );
}
