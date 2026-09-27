import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SalesOrderForm } from "@/components/sales/so-form";
import { updateSalesOrder } from "@/lib/actions/sales-orders";
import { getActiveUser } from "@/lib/auth/session";
import { getSalesOrderLines, getSalesOrderSummary } from "@/lib/data/sales-orders";
import { getSalesOrderFormChoices } from "@/lib/data/so-form-options";
import { canPerformSalesAction } from "@/lib/sales";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Edit sales order" };

export default async function EditSalesOrderPage({ params }: PageProps<"/sales-orders/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, so] = await Promise.all([getActiveUser(), getSalesOrderSummary(id)]);
  if (!so) notFound();
  if (!user || !canPerformSalesAction("edit", user.role, so.status)) redirect(`/sales-orders/${id}`);

  const lines = await getSalesOrderLines(id, so.warehouseId);
  const choices = await getSalesOrderFormChoices({
    customerId: so.customerId,
    warehouseId: so.warehouseId,
    productIds: lines.map((l) => l.productId),
  });

  return (
    <>
      <PageHeader title={`Edit ${so.soNumber}`} description="Drafts can be changed freely until they are confirmed." />
      <SalesOrderForm
        action={updateSalesOrder.bind(null, so.id)}
        initialValues={{
          customer_id: so.customerId,
          warehouse_id: so.warehouseId,
          order_date: so.orderDate,
          requested_delivery_date: so.requestedDeliveryDate ?? "",
          notes: so.notes ?? "",
          lines: lines.map((l) => ({
            product_id: l.productId,
            quantity: String(l.quantity),
            unit_price: l.unitPrice.toFixed(2),
            discount_percent: String(l.discountPercent),
          })),
        }}
        customers={choices.customers}
        warehouses={choices.warehouses}
        products={choices.products}
        cancelHref={`/sales-orders/${so.id}`}
      />
    </>
  );
}
