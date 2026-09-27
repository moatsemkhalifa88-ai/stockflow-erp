import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderForm } from "@/components/purchasing/po-form";
import { updatePurchaseOrder } from "@/lib/actions/purchase-orders";
import { getActiveUser } from "@/lib/auth/session";
import { getPurchaseOrderFormChoices } from "@/lib/data/po-form-options";
import { getPurchaseOrderLines, getPurchaseOrderSummary } from "@/lib/data/purchase-orders";
import { canPerform } from "@/lib/purchasing";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, po, lines] = await Promise.all([getActiveUser(), getPurchaseOrderSummary(id), getPurchaseOrderLines(id)]);
  if (!po) notFound();
  // Only drafts are editable; the database enforces this too.
  if (!user || !canPerform("edit", user.role, po.status)) redirect(`/purchase-orders/${id}`);

  const choices = await getPurchaseOrderFormChoices({
    supplierId: po.supplierId,
    warehouseId: po.warehouseId,
    productIds: lines.map((l) => l.productId),
  });

  return (
    <>
      <PageHeader title={`Edit ${po.poNumber}`} description="Drafts can be changed freely until they are submitted for approval." />
      <PurchaseOrderForm
        action={updatePurchaseOrder.bind(null, po.id)}
        initialValues={{
          supplier_id: po.supplierId,
          warehouse_id: po.warehouseId,
          order_date: po.orderDate,
          expected_delivery_date: po.expectedDeliveryDate ?? "",
          notes: po.notes ?? "",
          lines: lines.map((l) => ({
            product_id: l.productId,
            quantity: String(l.quantityOrdered),
            unit_cost: l.unitCost.toFixed(2),
          })),
        }}
        suppliers={choices.suppliers}
        warehouses={choices.warehouses}
        products={choices.products}
        cancelHref={`/purchase-orders/${po.id}`}
      />
    </>
  );
}
