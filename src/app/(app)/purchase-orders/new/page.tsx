import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderForm } from "@/components/purchasing/po-form";
import { createPurchaseOrder } from "@/lib/actions/purchase-orders";
import { canManagePurchaseOrders } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getPurchaseOrderFormChoices } from "@/lib/data/po-form-options";
import { addDays, businessToday } from "@/lib/format";
import { getUuidParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({ searchParams }: PageProps<"/purchase-orders/new">) {
  const user = await getActiveUser();
  if (!user || !canManagePurchaseOrders(user.role)) redirect("/purchase-orders");

  const params = await searchParams;
  const choices = await getPurchaseOrderFormChoices();
  const today = businessToday();
  const supplier = choices.suppliers.find((s) => s.id === getUuidParam(params, "supplier"));

  return (
    <>
      <PageHeader
        title="New purchase order"
        description="Saved as a draft. It needs to be submitted and approved by an administrator before goods can be received."
      />
      <PurchaseOrderForm
        action={createPurchaseOrder}
        initialValues={{
          supplier_id: supplier?.id ?? "",
          warehouse_id: "",
          order_date: today,
          expected_delivery_date: supplier ? addDays(today, supplier.leadTimeDays) : "",
          notes: "",
          lines: [],
        }}
        suppliers={choices.suppliers}
        warehouses={choices.warehouses}
        products={choices.products}
        cancelHref="/purchase-orders"
      />
    </>
  );
}
