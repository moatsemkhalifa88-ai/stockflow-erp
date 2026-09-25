import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AdjustmentForm } from "@/components/movements/adjustment-form";
import { canMoveStock } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getProductOptions, getWarehouseOptions } from "@/lib/data/lookups";
import { getUuidParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "New adjustment" };

export default async function NewAdjustmentPage({ searchParams }: PageProps<"/movements/new">) {
  const user = await getActiveUser();
  if (!user || !canMoveStock(user.role)) redirect("/movements");

  const params = await searchParams;
  const [products, warehouses] = await Promise.all([getProductOptions(), getWarehouseOptions()]);

  return (
    <>
      <PageHeader
        title="New stock adjustment"
        description="Correct stock after a count, damage or loss. Receipts, sales and transfers are posted from their documents."
      />
      <AdjustmentForm
        products={products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}${p.isActive ? "" : " (inactive)"}` }))}
        warehouses={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}${w.isActive ? "" : " (inactive)"}` }))}
        initialValues={{
          movement_type: "",
          product_id: getUuidParam(params, "product") ?? "",
          warehouse_id: getUuidParam(params, "warehouse") ?? "",
          quantity: "",
          reason: "",
          reference_number: "",
          notes: "",
        }}
      />
    </>
  );
}
