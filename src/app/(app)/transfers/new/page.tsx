import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { TransferForm } from "@/components/transfers/transfer-form";
import { requestTransfer } from "@/lib/actions/transfers";
import { canRequestTransfers } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getProductOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { getUuidParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "Request transfer" };

export default async function NewTransferPage({ searchParams }: PageProps<"/transfers/new">) {
  const user = await getActiveUser();
  if (!user || !canRequestTransfers(user.role)) redirect("/transfers");

  const params = await searchParams;
  const [warehouses, products] = await Promise.all([getWarehouseOptions(), getProductOptions()]);

  return (
    <>
      <PageHeader
        title="Request transfer"
        description="An administrator approves the request; stock moves only when the approved transfer is executed."
      />
      <TransferForm
        action={requestTransfer}
        initialValues={{
          source_warehouse_id: getUuidParam(params, "from") ?? "",
          destination_warehouse_id: getUuidParam(params, "to") ?? "",
          notes: "",
          lines: [],
        }}
        warehouses={warehouses.filter((w) => w.isActive).map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }))}
        products={products.filter((p) => p.isActive).map((p) => ({ id: p.id, label: `${p.sku} · ${p.name}` }))}
      />
    </>
  );
}
