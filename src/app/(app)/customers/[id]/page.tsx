import { CalendarClock, ClipboardList, Pencil, Plus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { SalesOrderTable } from "@/components/sales/so-table";
import { ActivationToggle } from "@/components/ui/activation-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { LinkButton } from "@/components/ui/link-button";
import { setCustomerActive } from "@/lib/actions/customers";
import { canManageCustomers, canManageSalesOrders } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getCustomer, getCustomerSummary } from "@/lib/data/customers";
import { getRecentSalesOrders } from "@/lib/data/sales-orders";
import { businessToday, formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { customerTypeLabel } from "@/lib/sales";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [customer, summary, orders, user] = await Promise.all([
    getCustomer(id),
    getCustomerSummary(id),
    getRecentSalesOrders(id, 20),
    getActiveUser(),
  ]);
  if (!customer || !summary) notFound();

  const canEdit = user !== null && canManageCustomers(user.role);
  const canOrder = user !== null && canManageSalesOrders(user.role) && customer.is_active;
  const creditUsed = customer.credit_limit > 0 ? (summary.openValue / customer.credit_limit) * 100 : null;

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Customer created", description: customer.code, variant: "success" },
          updated: { title: "Customer saved", description: customer.code, variant: "success" },
        }}
      />
      <PageHeader
        title={customer.name}
        description={`${customer.code} · ${customerTypeLabel(customer.customer_type)}${customer.city ? ` · ${customer.city}` : ""}`}
        actions={
          <>
            {canOrder && (
              <LinkButton href={`/sales-orders/new?customer=${customer.id}`}>
                <Plus aria-hidden className="size-4" />
                New order
              </LinkButton>
            )}
            {canEdit && (
              <>
                <ActivationToggle
                  isActive={customer.is_active}
                  onChange={setCustomerActive.bind(null, customer.id)}
                  entityLabel="Customer"
                  deactivateWarning={
                    summary.openCount > 0
                      ? `${formatNumber(summary.openCount)} open orders stay valid and can still ship, but no new orders can be confirmed.`
                      : "No new orders can be confirmed for this customer. History is kept."
                  }
                />
                <LinkButton href={`/customers/${customer.id}/edit`} variant="secondary">
                  <Pencil aria-hidden className="size-4" />
                  Edit
                </LinkButton>
              </>
            )}
          </>
        }
      />
      {!customer.is_active && (
        <div className="mb-6">
          <Badge>Inactive: no new orders</Badge>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total purchases" value={formatCurrency(summary.totalSalesValue)} icon={Wallet} hint="Shipped and completed orders" />
        <KpiCard
          label="Open orders"
          value={formatNumber(summary.openCount)}
          icon={ClipboardList}
          hint={`${formatCurrency(summary.openValue)} confirmed, not yet shipped`}
        />
        <KpiCard
          label="Last order"
          value={summary.lastOrderDate ? formatDate(summary.lastOrderDate) : "—"}
          icon={CalendarClock}
          hint={`${formatNumber(summary.orderCount)} orders in total`}
        />
        <KpiCard
          label="Credit limit"
          value={formatCurrency(customer.credit_limit)}
          icon={Wallet}
          hint={creditUsed === null ? "No limit set" : `${creditUsed.toFixed(0)}% used by open orders`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Sales orders"
            description="Latest 20 orders"
            action={
              <LinkButton href={`/sales-orders?customer=${customer.id}`} variant="ghost" size="sm">
                View all
              </LinkButton>
            }
          />
          {orders.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No sales orders yet" />
          ) : (
            <SalesOrderTable orders={orders} today={businessToday()} hideCustomer />
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Contact", value: customer.contact_name },
                {
                  label: "Email",
                  value: customer.email && (
                    <a href={`mailto:${customer.email}`} className="text-brand-700 hover:underline">
                      {customer.email}
                    </a>
                  ),
                },
                { label: "Phone", value: customer.phone },
                { label: "Tax id", value: customer.tax_id },
                { label: "Address", value: [customer.address_line, customer.city, customer.country].filter(Boolean).join(", ") },
                { label: "Payment terms", value: `${customer.payment_terms_days} days` },
                { label: "Status", value: customer.is_active ? "Active" : "Inactive" },
              ]}
            />
            {customer.notes && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">{customer.notes}</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
