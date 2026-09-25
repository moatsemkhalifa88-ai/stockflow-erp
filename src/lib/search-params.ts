/** Helpers for reading list-page filters from the URL and building links back to them. */

export type SearchParams = Record<string, string | string[] | undefined>;

export function getParam(params: SearchParams, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Returns the value only when it is one of `allowed`. */
export function getEnumParam<T extends string>(params: SearchParams, key: string, allowed: readonly T[]): T | undefined {
  const value = getParam(params, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function getPageParam(params: SearchParams): number {
  const page = Number.parseInt(getParam(params, "page"), 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function getUuidParam(params: SearchParams, key: string): string | undefined {
  const value = getParam(params, key);
  return isUuid(value) ? value : undefined;
}

/** yyyy-mm-dd, or undefined. */
export function getDateParam(params: SearchParams, key: string): string | undefined {
  const value = getParam(params, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/**
 * Free-text search is interpolated into PostgREST `or=(...)` filters, so strip
 * the characters that have meaning in that syntax (, . ( ) : * % " \).
 */
export function getSearchParam(params: SearchParams, key = "q"): string {
  return getParam(params, key)
    .replace(/[,.()*%:"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export interface SortState<T extends string> {
  column: T;
  ascending: boolean;
}

/** `sort=name` or `sort=-name` (descending). Falls back to `fallback` for unknown columns. */
export function getSortParam<T extends string>(
  params: SearchParams,
  allowed: readonly T[],
  fallback: SortState<T>,
): SortState<T> {
  const raw = getParam(params, "sort");
  const ascending = !raw.startsWith("-");
  const column = raw.replace(/^-/, "");
  return (allowed as readonly string[]).includes(column) ? { column: column as T, ascending } : fallback;
}

/** Builds `pathname?query` from the current params plus overrides (undefined / "" removes a key). */
export function buildHref(pathname: string, params: SearchParams, overrides: Record<string, string | number | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) query.set(key, single);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === "") query.delete(key);
    else query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export const PAGE_SIZE = 25;

export function pageRange(page: number, pageSize = PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}
