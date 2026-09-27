import type { CsvColumn } from "@/lib/csv";
import type { LowStockLine, MovementReportLine, ValuationLine } from "@/lib/data/reports";
import { MOVEMENT_TYPE_LABELS, STOCK_STATUS_LABELS } from "@/lib/inventory";

/** CSV layouts. Numbers are written raw (no currency symbols) so spreadsheets can sum them. */

export const VALUATION_CSV: CsvColumn<ValuationLine>[] = [
  { header: "SKU", value: (r) => r.sku },
  { header: "Product", value: (r) => r.productName },
  { header: "Category", value: (r) => r.categoryName },
  { header: "Warehouse code", value: (r) => r.warehouseCode },
  { header: "Warehouse", value: (r) => r.warehouseName },
  { header: "Quantity", value: (r) => r.quantity },
  { header: "Cost price (ILS)", value: (r) => r.costPrice.toFixed(2) },
  { header: "Inventory value (ILS)", value: (r) => r.inventoryValue.toFixed(2) },
];

export const MOVEMENT_CSV: CsvColumn<MovementReportLine>[] = [
  { header: "Movement", value: (r) => r.movementNumber },
  { header: "Date", value: (r) => r.businessDate },
  { header: "Type", value: (r) => MOVEMENT_TYPE_LABELS[r.movementType] },
  { header: "Reversal", value: (r) => (r.isReversal ? "yes" : "no") },
  { header: "Reference type", value: (r) => r.referenceType },
  { header: "Reference", value: (r) => r.referenceNumber },
  { header: "SKU", value: (r) => r.sku },
  { header: "Product", value: (r) => r.productName },
  { header: "Category", value: (r) => r.categoryName },
  { header: "Warehouse", value: (r) => r.warehouseCode },
  { header: "Quantity change", value: (r) => r.quantityChange },
  { header: "Unit cost (ILS)", value: (r) => r.unitCost.toFixed(2) },
  { header: "Value change (ILS)", value: (r) => r.valueChange.toFixed(2) },
  { header: "Reason", value: (r) => r.reason },
  { header: "By", value: (r) => r.performedByName },
];

export const LOW_STOCK_CSV: CsvColumn<LowStockLine>[] = [
  { header: "Status", value: (r) => STOCK_STATUS_LABELS[r.stockStatus] },
  { header: "SKU", value: (r) => r.sku },
  { header: "Product", value: (r) => r.productName },
  { header: "Category", value: (r) => r.categoryName },
  { header: "Warehouse", value: (r) => r.warehouseCode },
  { header: "On hand", value: (r) => r.quantity },
  { header: "Minimum", value: (r) => r.minStockLevel },
  { header: "Shortfall", value: (r) => r.shortfall },
  { header: "Suggested order qty", value: (r) => r.suggestedOrderQuantity },
  { header: "Cost price (ILS)", value: (r) => r.costPrice.toFixed(2) },
  { header: "Suggested order value (ILS)", value: (r) => r.suggestedOrderValue.toFixed(2) },
  { header: "Unit", value: (r) => r.unitOfMeasure },
];
