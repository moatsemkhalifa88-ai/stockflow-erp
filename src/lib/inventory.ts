import type { BadgeTone } from "@/components/ui/badge";
import { Constants, type Enums } from "@/types/database";

/** Domain vocabulary shared by the inventory, product, warehouse and movement screens. */

export type MovementType = Enums<"movement_type">;
export const MOVEMENT_TYPES: readonly MovementType[] = Constants.public.Enums.movement_type;

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  PURCHASE_RECEIPT: "Purchase receipt",
  SALE: "Sale",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
  RETURN: "Return",
};

/** Movement types a user may post by hand. Everything else comes from documents (Phases 3-4). */
export const MANUAL_MOVEMENT_TYPES = ["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] as const satisfies readonly MovementType[];
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

export function isManualMovementType(value: string): value is ManualMovementType {
  return (MANUAL_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** Matches the CASE expression in the inventory_valuation view. */
export const STOCK_STATUSES = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
};

export const STOCK_STATUS_TONES: Record<StockStatus, BadgeTone> = {
  IN_STOCK: "success",
  LOW_STOCK: "warning",
  OUT_OF_STOCK: "danger",
};

export function isStockStatus(value: string): value is StockStatus {
  return (STOCK_STATUSES as readonly string[]).includes(value);
}

export function toStockStatus(value: string | null): StockStatus {
  return value !== null && isStockStatus(value) ? value : "OUT_OF_STOCK";
}

/** Reference types that are not business documents; movements with these can be reversed from the UI. */
const MANUAL_REFERENCE_TYPES = new Set<string | null>([null, "ADJUSTMENT", "OPENING_BALANCE"]);

/**
 * The UI offers "Reverse" only for manual movements that are not reversals and
 * have not been reversed. Document movements are reversed by cancelling the document.
 * The database enforces the reversal rules either way.
 */
export function canReverseFromUi(movement: {
  reference_type: string | null;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
}): boolean {
  return (
    movement.reversal_of_id === null &&
    movement.reversed_by_id === null &&
    MANUAL_REFERENCE_TYPES.has(movement.reference_type)
  );
}

export const UNITS_OF_MEASURE = ["EA", "BOX", "PACK", "CASE", "KG", "L", "M", "ROLL", "SET", "PAIR"] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const UNIT_LABELS: Record<UnitOfMeasure, string> = {
  EA: "Each",
  BOX: "Box",
  PACK: "Pack",
  CASE: "Case",
  KG: "Kilogram",
  L: "Litre",
  M: "Metre",
  ROLL: "Roll",
  SET: "Set",
  PAIR: "Pair",
};
