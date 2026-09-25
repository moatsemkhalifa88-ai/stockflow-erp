import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/components/products/product-form";
import { updateProduct } from "@/lib/actions/products";
import { canManageProducts } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getCategoryOptions } from "@/lib/data/lookups";
import { getProduct, hasStockHistory } from "@/lib/data/products";
import { isUuid } from "@/lib/search-params";
import type { ProductFormValues } from "@/lib/validation/product";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const user = await getActiveUser();
  if (!user || !canManageProducts(user.role)) redirect(`/products/${id}`);

  const [product, categories, skuLocked] = await Promise.all([getProduct(id), getCategoryOptions(), hasStockHistory(id)]);
  if (!product) notFound();

  const initialValues: ProductFormValues = {
    sku: product.sku,
    name: product.name,
    description: product.description ?? "",
    category_id: product.category_id,
    unit_of_measure: product.unit_of_measure,
    barcode: product.barcode ?? "",
    cost_price: product.cost_price.toFixed(2),
    sale_price: product.sale_price.toFixed(2),
    min_stock_level: String(product.min_stock_level),
    reorder_quantity: String(product.reorder_quantity),
  };

  return (
    <>
      <PageHeader
        title={`Edit ${product.sku}`}
        description="Changing the cost price re-values the stock on hand. Past movements keep the cost they were posted at."
      />
      <ProductForm
        action={updateProduct.bind(null, product.id)}
        initialValues={initialValues}
        categories={categories
          .filter((c) => c.isActive || c.id === product.category_id)
          .map((c) => ({ value: c.id, label: c.name }))}
        cancelHref={`/products/${product.id}`}
        submitLabel="Save changes"
        skuLocked={skuLocked}
      />
    </>
  );
}
