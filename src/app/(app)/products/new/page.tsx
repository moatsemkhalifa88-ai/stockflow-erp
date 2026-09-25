import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/components/products/product-form";
import { createProduct } from "@/lib/actions/products";
import { canManageProducts } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getCategoryOptions } from "@/lib/data/lookups";
import { EMPTY_PRODUCT } from "@/lib/validation/product";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const user = await getActiveUser();
  if (!user || !canManageProducts(user.role)) redirect("/products");

  const categories = await getCategoryOptions();

  return (
    <>
      <PageHeader
        title="New product"
        description="New products start with no stock. Stock is added through receipts or adjustments."
      />
      <ProductForm
        action={createProduct}
        initialValues={EMPTY_PRODUCT}
        categories={categories.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))}
        cancelHref="/products"
        submitLabel="Create product"
      />
    </>
  );
}
