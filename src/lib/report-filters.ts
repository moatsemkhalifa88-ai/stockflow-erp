import type { LowStockFilters, MovementReportFilters, ValuationFilters } from "@/lib/data/reports";
import { readDateRange, type DateRange } from "@/lib/date-range";
import { businessToday } from "@/lib/format";
import { MOVEMENT_TYPES } from "@/lib/inventory";
import { getDateParam, getEnumParam, getUuidParam, type SearchParams } from "@/lib/search-params";

/**
 * Filters for each report, read the same way by the report page and by its
 * CSV export route - so the file always matches what was on screen.
 */

export function readValuationFilters(params: SearchParams, today = businessToday()): ValuationFilters {
  const asOf = getDateParam(params, "as_of");
  return {
    asOf: asOf && asOf < today ? asOf : today,
    warehouseId: getUuidParam(params, "warehouse"),
    categoryId: getUuidParam(params, "category"),
  };
}

export function readMovementFilters(params: SearchParams): MovementReportFilters & { range: DateRange } {
  const range = readDateRange(params, "mtd");
  return {
    range,
    from: range.from,
    to: range.to,
    warehouseId: getUuidParam(params, "warehouse"),
    categoryId: getUuidParam(params, "category"),
    movementType: getEnumParam(params, "type", MOVEMENT_TYPES),
  };
}

export function readLowStockFilters(params: SearchParams): LowStockFilters {
  return {
    warehouseId: getUuidParam(params, "warehouse"),
    categoryId: getUuidParam(params, "category"),
    status: getEnumParam(params, "status", ["LOW_STOCK", "OUT_OF_STOCK"] as const),
  };
}

/** Query string for an export link, keeping the report's filters. */
export function exportHref(path: string, params: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single && key !== "page") query.set(key, single);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}
