import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SalesOrderForm } from "@/components/sales/so-form";
import { createSalesOrder } from "@/lib/actions/sales-orders";
import { canManageSalesOrders } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getSalesOrderFormChoices } from "@/lib/data/so-form-options";
import { businessToday } from "@/lib/format";
import { getUuidParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "New sales order" };

export default async function NewSalesOrderPage({ searchParams }: PageProps<"/sales-orders/new">) {
  const user = await getActiveUser();
  if (!user || !canManageSalesOrders(user.role)) redirect("/sales-orders");

  const params = await searchParams;
  const choices = await getSalesOrderFormChoices();
  const customer = choices.customers.find((c) => c.id === getUuidParam(params, "customer"));

  return (
    <>
      <PageHeader
        title="New sales order"
        description="Saved as a draft. Once confirmed, the warehouse picks and ships it; stock is only taken when it ships."
      />
      <SalesOrderForm
        action={createSalesOrder}
        initialValues={{
          customer_id: customer?.id ?? "",
          warehouse_id: "",
          order_date: businessToday(),
          requested_delivery_date: "",
          notes: "",
          lines: [],
        }}
        customers={choices.customers}
        warehouses={choices.warehouses}
        products={choices.products}
        cancelHref="/sales-orders"
      />
    </>
  );
}
