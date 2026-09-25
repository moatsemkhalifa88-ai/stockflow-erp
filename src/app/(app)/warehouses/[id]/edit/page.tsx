import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WarehouseForm } from "@/components/warehouses/warehouse-form";
import { updateWarehouse } from "@/lib/actions/warehouses";
import { canManageWarehouses } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getManagerSelectOptions, WAREHOUSE_TYPE_OPTIONS } from "@/lib/data/warehouse-form-options";
import { getWarehouse, hasWarehouseStockHistory } from "@/lib/data/warehouses";
import { isUuid } from "@/lib/search-params";
import type { WarehouseFormValues } from "@/lib/validation/warehouse";

export const metadata: Metadata = { title: "Edit warehouse" };

export default async function EditWarehousePage({ params }: PageProps<"/warehouses/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const user = await getActiveUser();
  if (!user || !canManageWarehouses(user.role)) redirect(`/warehouses/${id}`);

  const [warehouse, codeLocked] = await Promise.all([getWarehouse(id), hasWarehouseStockHistory(id)]);
  if (!warehouse) notFound();
  const managerOptions = await getManagerSelectOptions(warehouse.manager_id);

  const initialValues: WarehouseFormValues = {
    code: warehouse.code,
    name: warehouse.name,
    warehouse_type: warehouse.warehouse_type,
    address_line: warehouse.address_line ?? "",
    city: warehouse.city,
    country: warehouse.country,
    phone: warehouse.phone ?? "",
    manager_id: warehouse.manager_id ?? "",
  };

  return (
    <>
      <PageHeader title={`Edit ${warehouse.code}`} description="Every change is recorded in the audit log with your name." />
      <WarehouseForm
        action={updateWarehouse.bind(null, warehouse.id)}
        initialValues={initialValues}
        typeOptions={WAREHOUSE_TYPE_OPTIONS}
        managerOptions={managerOptions}
        cancelHref={`/warehouses/${warehouse.id}`}
        submitLabel="Save changes"
        codeLocked={codeLocked}
      />
    </>
  );
}
