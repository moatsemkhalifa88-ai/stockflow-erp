import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { createSupplier } from "@/lib/actions/suppliers";
import { canManageSuppliers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { EMPTY_SUPPLIER } from "@/lib/validation/supplier";

export const metadata: Metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  const user = await getActiveUser();
  if (!user || !canManageSuppliers(user.role)) redirect("/suppliers");

  return (
    <>
      <PageHeader title="New supplier" description="Every change to a supplier is recorded in the audit log." />
      <SupplierForm action={createSupplier} initialValues={EMPTY_SUPPLIER} cancelHref="/suppliers" submitLabel="Create supplier" />
    </>
  );
}
