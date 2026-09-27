import "server-only";
import type { CustomerChoice, SaleProductChoice, WarehouseChoice } from "@/components/sales/so-form";
import { getCustomerOptions, getPricedProductOptions, getWarehouseOptions } from "./lookups";

/**
 * Choices for the sales order form. Only active records can be sold; `keep`
 * ids (an existing draft's customer / warehouse / products) stay listed.
 */
export async function getSalesOrderFormChoices(
  keep: { customerId?: string; warehouseId?: string; productIds?: string[] } = {},
): Promise<{ customers: CustomerChoice[]; warehouses: WarehouseChoice[]; products: SaleProductChoice[] }> {
  const [customers, warehouses, products] = await Promise.all([
    getCustomerOptions(),
    getWarehouseOptions(),
    getPricedProductOptions(),
  ]);
  const keepProducts = new Set(keep.productIds ?? []);
  return {
    customers: customers
      .filter((c) => c.isActive || c.id === keep.customerId)
      .map((c) => ({ id: c.id, label: `${c.name} (${c.code})${c.isActive ? "" : " - inactive"}` })),
    warehouses: warehouses
      .filter((w) => w.isActive || w.id === keep.warehouseId)
      .map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` })),
    products: products
      .filter((p) => p.isActive || keepProducts.has(p.id))
      .map((p) => ({ id: p.id, label: `${p.sku} · ${p.name}`, salePrice: p.salePrice })),
  };
}
