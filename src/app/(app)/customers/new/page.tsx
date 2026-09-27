import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { createCustomer } from "@/lib/actions/customers";
import { canManageCustomers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { EMPTY_CUSTOMER } from "@/lib/validation/customer";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const user = await getActiveUser();
  if (!user || !canManageCustomers(user.role)) redirect("/customers");

  return (
    <>
      <PageHeader title="New customer" description="Every change to a customer is recorded in the audit log." />
      <CustomerForm action={createCustomer} initialValues={EMPTY_CUSTOMER} cancelHref="/customers" submitLabel="Create customer" />
    </>
  );
}
