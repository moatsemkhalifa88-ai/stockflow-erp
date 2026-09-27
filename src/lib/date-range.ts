import { addDays, businessToday } from "@/lib/format";
import { getDateParam, getParam, type SearchParams } from "@/lib/search-params";

/** Date ranges for the dashboard and reports, in business dates (yyyy-mm-dd, Asia/Jerusalem). */

export const RANGE_PRESETS = ["7d", "30d", "90d", "mtd", "ytd"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset | "custom", string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "Month to date",
  ytd: "Year to date",
  custom: "Custom",
};

export interface DateRange {
  from: string;
  to: string;
  preset: RangePreset | "custom";
}

export type Bucket = "day" | "week" | "month";

export function presetRange(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today, preset };
    case "30d":
      return { from: addDays(today, -29), to: today, preset };
    case "90d":
      return { from: addDays(today, -89), to: today, preset };
    case "mtd":
      return { from: `${today.slice(0, 8)}01`, to: today, preset };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, preset };
  }
}

/**
 * Reads `range=<preset>` or `from` / `to` from the URL. Custom ranges are
 * clamped to today, swapped if reversed, and limited to 3 years.
 */
export function readDateRange(params: SearchParams, fallback: RangePreset, today = businessToday()): DateRange {
  const preset = getParam(params, "range");
  if ((RANGE_PRESETS as readonly string[]).includes(preset)) return presetRange(preset as RangePreset, today);

  const from = getDateParam(params, "from");
  const to = getDateParam(params, "to");
  if (!from && !to) return presetRange(fallback, today);

  let start = from ?? addDays(to ?? today, -29);
  let end = to ?? today;
  if (start > end) [start, end] = [end, start];
  if (end > today) end = today;
  if (start > end) start = end;
  if (start < addDays(end, -3 * 366)) start = addDays(end, -3 * 366);
  return { from: start, to: end, preset: "custom" };
}

/** Daily up to a month, weekly up to half a year, then monthly. */
export function bucketFor(range: Pick<DateRange, "from" | "to">): Bucket {
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  if (days <= 31) return "day";
  if (days <= 190) return "week";
  return "month";
}
