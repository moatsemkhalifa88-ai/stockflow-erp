import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";

export interface Page<T> {
  rows: T[];
  total: number;
}

/** Throws a descriptive error (caught by the route's error.tsx) when a query fails. */
export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, what: string): T {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`Failed to load ${what}: no data returned`);
  return result.data;
}

/**
 * Unwraps a paged list query. Asking for a page past the end makes PostgREST
 * answer 416 (PGRST103); that is shown as an empty page, not an error.
 */
export function unwrapPage<T>(
  result: { data: T[] | null; error: PostgrestError | null; count: number | null },
  what: string,
): Page<T> {
  if (result.error?.code === "PGRST103") return { rows: [], total: 0 };
  const rows = unwrap(result, what);
  return { rows, total: result.count ?? rows.length };
}

/**
 * Reads every row of a query in 1,000-row pages (the API's max rows per
 * request), for CSV exports. Throws past `cap` rows instead of truncating.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  what: string,
  cap = 100_000,
): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const batch = unwrap(await page(from, from + size - 1), what);
    rows.push(...batch);
    if (batch.length < size) return rows;
    if (rows.length >= cap) throw new Error(`Export of ${what} is larger than ${cap} rows; narrow the filters.`);
  }
}

/** View columns are typed nullable; these read them with a safe default. */
export const num = (value: number | null | undefined): number => value ?? 0;
export const str = (value: string | null | undefined): string => value ?? "";
