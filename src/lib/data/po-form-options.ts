import "server-only";
import type { ProductChoice, SupplierChoice, WarehouseChoice } from "@/components/purchasing/po-form";
import { getPricedProductOptions, getSupplierOptions, getWarehouseOptions } from "./lookups";

/**
 * Choices for the purchase order form. Only active records can be ordered;
 * `keep` ids (the order's current supplier / warehouse / products) stay listed
 * so an existing draft still shows what it holds.
 */
export async function getPurchaseOrderFormChoices(
  keep: { supplierId?: string; warehouseId?: string; productIds?: string[] } = {},
): Promise<{ suppliers: SupplierChoice[]; warehouses: WarehouseChoice[]; products: ProductChoice[] }> {
  const [suppliers, warehouses, products] = await Promise.all([
    getSupplierOptions(),
    getWarehouseOptions(),
    getPricedProductOptions(),
  ]);
  const keepProducts = new Set(keep.productIds ?? []);

  return {
    suppliers: suppliers
      .filter((s) => s.isActive || s.id === keep.supplierId)
      .map((s) => ({ id: s.id, label: `${s.name} (${s.code})${s.isActive ? "" : " - inactive"}`, leadTimeDays: s.leadTimeDays })),
    warehouses: warehouses
      .filter((w) => w.isActive || w.id === keep.warehouseId)
      .map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` })),
    products: products
      .filter((p) => p.isActive || keepProducts.has(p.id))
      .map((p) => ({ id: p.id, label: `${p.sku} · ${p.name}`, costPrice: p.costPrice })),
  };
}
