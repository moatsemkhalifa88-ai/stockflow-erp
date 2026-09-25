import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WarehouseForm } from "@/components/warehouses/warehouse-form";
import { createWarehouse } from "@/lib/actions/warehouses";
import { canManageWarehouses } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getManagerSelectOptions, WAREHOUSE_TYPE_OPTIONS } from "@/lib/data/warehouse-form-options";
import { EMPTY_WAREHOUSE } from "@/lib/validation/warehouse";

export const metadata: Metadata = { title: "New warehouse" };

export default async function NewWarehousePage() {
  const user = await getActiveUser();
  if (!user || !canManageWarehouses(user.role)) redirect("/warehouses");

  const managerOptions = await getManagerSelectOptions();

  return (
    <>
      <PageHeader title="New warehouse" description="New warehouses start empty. Stock arrives through receipts, transfers or adjustments." />
      <WarehouseForm
        action={createWarehouse}
        initialValues={EMPTY_WAREHOUSE}
        typeOptions={WAREHOUSE_TYPE_OPTIONS}
        managerOptions={managerOptions}
        cancelHref="/warehouses"
        submitLabel="Create warehouse"
      />
    </>
  );
}
