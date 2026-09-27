import { CalendarClock, ClipboardList, Pencil, Plus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderTable } from "@/components/purchasing/po-table";
import { ActivationToggle } from "@/components/ui/activation-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { LinkButton } from "@/components/ui/link-button";
import { setSupplierActive } from "@/lib/actions/suppliers";
import { canManagePurchaseOrders, canManageSuppliers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getRecentPurchaseOrders } from "@/lib/data/purchase-orders";
import { getSupplier, getSupplierSummary } from "@/lib/data/suppliers";
import { businessToday, formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierDetailPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [supplier, summary, orders, user] = await Promise.all([
    getSupplier(id),
    getSupplierSummary(id),
    getRecentPurchaseOrders(id, 20),
    getActiveUser(),
  ]);
  if (!supplier || !summary) notFound();

  const canEdit = user !== null && canManageSuppliers(user.role);
  const canOrder = user !== null && canManagePurchaseOrders(user.role) && supplier.is_active;

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Supplier created", description: supplier.code, variant: "success" },
          updated: { title: "Supplier saved", description: supplier.code, variant: "success" },
        }}
      />
      <PageHeader
        title={supplier.name}
        description={`${supplier.code}${supplier.city ? ` · ${supplier.city}` : ""}`}
        actions={
          <>
            {canOrder && (
              <LinkButton href={`/purchase-orders/new?supplier=${supplier.id}`}>
                <Plus aria-hidden className="size-4" />
                New order
              </LinkButton>
            )}
            {canEdit && (
              <>
                <ActivationToggle
                  isActive={supplier.is_active}
                  onChange={setSupplierActive.bind(null, supplier.id)}
                  entityLabel="Supplier"
                  deactivateWarning={
                    summary.outstandingCount > 0
                      ? `${formatNumber(summary.outstandingCount)} open orders stay valid and can still be received, but no new orders can be placed or approved.`
                      : "No new orders can be placed with this supplier. History is kept."
                  }
                />
                <LinkButton href={`/suppliers/${supplier.id}/edit`} variant="secondary">
                  <Pencil aria-hidden className="size-4" />
                  Edit
                </LinkButton>
              </>
            )}
          </>
        }
      />
      {!supplier.is_active && (
        <div className="mb-6">
          <Badge>Inactive: no new orders</Badge>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total purchase value"
          value={formatCurrency(summary.totalPurchaseValue)}
          icon={Wallet}
          hint="Approved orders, excluding cancelled"
        />
        <KpiCard
          label="Received value"
          value={formatCurrency(summary.receivedValue)}
          icon={Wallet}
          hint="Goods actually received"
        />
        <KpiCard
          label="Outstanding orders"
          value={formatNumber(summary.outstandingCount)}
          icon={ClipboardList}
          hint={`${formatCurrency(summary.outstandingValue)} still to be delivered`}
        />
        <KpiCard
          label="Last order"
          value={summary.lastOrderDate ? formatDate(summary.lastOrderDate) : "—"}
          icon={CalendarClock}
          hint={`${formatNumber(summary.orderCount)} orders in total`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Purchase orders"
            description="Latest 20 orders"
            action={
              <LinkButton href={`/purchase-orders?supplier=${supplier.id}`} variant="ghost" size="sm">
                View all
              </LinkButton>
            }
          />
          {orders.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No purchase orders yet" />
          ) : (
            <PurchaseOrderTable orders={orders} today={businessToday()} hideSupplier />
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Contact", value: supplier.contact_name },
                { label: "Email", value: supplier.email && <a href={`mailto:${supplier.email}`} className="text-brand-700 hover:underline">{supplier.email}</a> },
                { label: "Phone", value: supplier.phone },
                { label: "Tax id", value: supplier.tax_id },
                { label: "Address", value: [supplier.address_line, supplier.city, supplier.country].filter(Boolean).join(", ") },
                { label: "Payment terms", value: `${supplier.payment_terms_days} days` },
                { label: "Lead time", value: `${supplier.lead_time_days} days` },
                { label: "Status", value: supplier.is_active ? "Active" : "Inactive" },
              ]}
            />
            {supplier.notes && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{supplier.notes}</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
