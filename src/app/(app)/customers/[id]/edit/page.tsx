import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { updateCustomer } from "@/lib/actions/customers";
import { canManageCustomers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getCustomer } from "@/lib/data/customers";
import { isUuid } from "@/lib/search-params";
import type { CustomerFormValues } from "@/lib/validation/customer";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const user = await getActiveUser();
  if (!user || !canManageCustomers(user.role)) redirect(`/customers/${id}`);

  const customer = await getCustomer(id);
  if (!customer) notFound();

  const initialValues: CustomerFormValues = {
    code: customer.code,
    name: customer.name,
    customer_type: customer.customer_type,
    contact_name: customer.contact_name ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    address_line: customer.address_line ?? "",
    city: customer.city ?? "",
    country: customer.country,
    tax_id: customer.tax_id ?? "",
    credit_limit: customer.credit_limit.toFixed(2),
    payment_terms_days: String(customer.payment_terms_days),
    notes: customer.notes ?? "",
  };

  return (
    <>
      <PageHeader title={`Edit ${customer.code}`} description="Changes apply to new orders; existing orders keep their prices." />
      <CustomerForm
        action={updateCustomer.bind(null, customer.id)}
        initialValues={initialValues}
        cancelHref={`/customers/${customer.id}`}
        submitLabel="Save changes"
      />
    </>
  );
}
