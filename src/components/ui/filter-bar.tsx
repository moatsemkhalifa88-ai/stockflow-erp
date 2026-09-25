import { Search } from "lucide-react";
import Form from "next/form";
import type { ReactNode } from "react";
import { Button } from "./button";
import { LinkButton } from "./link-button";

/**
 * GET form that writes filters to the URL (shareable, back-button friendly).
 * Submitting resets pagination because `page` is not part of the form.
 */
export function FilterBar({
  action,
  searchLabel,
  searchPlaceholder,
  searchValue,
  children,
  hidden,
  isFiltered,
}: {
  action: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  /** Extra filter controls (selects, dates). */
  children?: ReactNode;
  /** Params to keep (e.g. the current sort). */
  hidden?: Record<string, string | undefined>;
  isFiltered: boolean;
}) {
  return (
    <Form action={action} className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-end">
      {Object.entries(hidden ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor="filter-q" className="block text-sm font-medium text-slate-700">
          {searchLabel}
        </label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={searchValue}
            placeholder={searchPlaceholder}
            className="block h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
        </div>
      </div>
      {children && <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-none lg:items-end [&>*]:lg:w-44">{children}</div>}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {isFiltered && (
          <LinkButton href={action} variant="ghost">
            Reset
          </LinkButton>
        )}
      </div>
    </Form>
  );
}
