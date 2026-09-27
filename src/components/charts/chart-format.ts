import { formatCompactCurrency, formatCurrency, formatNumber } from "@/lib/format";

/** Formats are passed to client charts by name (functions cannot cross the server/client boundary). */
export type ValueFormat = "currency" | "number";
export type DateBucket = "day" | "week" | "month";

export function formatValue(value: number, format: ValueFormat): string {
  return format === "currency" ? formatCurrency(value) : formatNumber(value);
}

export function formatAxisValue(value: number, format: ValueFormat): string {
  if (format === "currency") return formatCompactCurrency(value);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** Label for a bucket start date (yyyy-mm-dd). */
export function formatBucket(date: string, bucket: DateBucket, long = false): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (bucket === "month") return MONTH.format(d);
  if (bucket === "week") return long ? `Week of ${DAY.format(d)}` : DAY.format(d);
  return DAY.format(d);
}
