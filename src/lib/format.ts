const integerFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return integerFormatter.format(value);
}

const WAREHOUSE_TYPE_LABELS: Record<string, string> = {
  MAIN: "Main",
  REGIONAL: "Regional",
  DISTRIBUTION: "Distribution",
  RETURNS: "Returns",
};

export function formatWarehouseType(type: string): string {
  return WAREHOUSE_TYPE_LABELS[type] ?? type;
}
