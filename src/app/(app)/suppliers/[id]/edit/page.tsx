import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { updateSupplier } from "@/lib/actions/suppliers";
import { canManageSuppliers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getSupplier } from "@/lib/data/suppliers";
import { isUuid } from "@/lib/search-params";
import type { SupplierFormValues } from "@/lib/validation/supplier";

export const metadata: Metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: PageProps<"/suppliers/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const user = await getActiveUser();
  if (!user || !canManageSuppliers(user.role)) redirect(`/suppliers/${id}`);

  const supplier = await getSupplier(id);
  if (!supplier) notFound();

  const initialValues: SupplierFormValues = {
    code: supplier.code,
    name: supplier.name,
    contact_name: supplier.contact_name ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    address_line: supplier.address_line ?? "",
    city: supplier.city ?? "",
    country: supplier.country,
    tax_id: supplier.tax_id ?? "",
    payment_terms_days: String(supplier.payment_terms_days),
    lead_time_days: String(supplier.lead_time_days),
    notes: supplier.notes ?? "",
  };

  return (
    <>
      <PageHeader title={`Edit ${supplier.code}`} description="Changes apply to new orders; existing orders keep their prices." />
      <SupplierForm
        action={updateSupplier.bind(null, supplier.id)}
        initialValues={initialValues}
        cancelHref={`/suppliers/${supplier.id}`}
        submitLabel="Save changes"
      />
    </>
  );
}
