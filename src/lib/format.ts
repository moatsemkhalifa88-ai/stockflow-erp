const integerFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return integerFormatter.format(value);
}

/** Signed quantity for ledger columns: +40, -7. */
export function formatSignedNumber(value: number): string {
  return value > 0 ? `+${integerFormatter.format(value)}` : integerFormatter.format(value);
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Amounts are stored in ILS (numeric(12,2)). */
export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ILS",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompactCurrency(value: number): string {
  return compactCurrencyFormatter.format(value);
}

const TIME_ZONE = "Asia/Jerusalem";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: TIME_ZONE });
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});

export function formatDate(value: string | Date): string {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

const isoDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date (yyyy-mm-dd) in business time. */
export function businessToday(now: Date = new Date()): string {
  return isoDayFormatter.format(now);
}

/** Adds whole days to a yyyy-mm-dd date. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const offsetFormatter =new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" });

/** UTC offset of the business time zone on a given day, e.g. "+03:00" in summer and "+02:00" in winter. */
function businessOffset(day: string): string {
  const name = offsetFormatter.formatToParts(new Date(`${day}T12:00:00Z`)).find((p) => p.type === "timeZoneName");
  return /GMT([+-]\d{2}:\d{2})/.exec(name?.value ?? "")?.[1] ?? "+00:00";
}

/** Start and end of a calendar day (yyyy-mm-dd) in business time, as ISO timestamps for filters. */
export function businessDayRange(day: string): { start: string; end: string } {
  const offset = businessOffset(day);
  return { start: `${day}T00:00:00${offset}`, end: `${day}T23:59:59.999${offset}` };
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
