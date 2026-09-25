import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * "Showing 26-50 of 312" with previous / next links.
 * `hrefForPage` is supplied by the page so the current filters are kept.
 */
export function Pagination({
  page,
  pageSize,
  total,
  hrefForPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefForPage: (page: number) => string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 border-t border-slate-100 px-4 py-3 text-sm">
      <p className="text-slate-500">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            Showing <span className="font-medium text-slate-900">{formatNumber(first)}</span>–
            <span className="font-medium text-slate-900">{formatNumber(last)}</span> of{" "}
            <span className="font-medium text-slate-900">{formatNumber(total)}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <span className="hidden text-slate-500 sm:inline">
          Page {formatNumber(Math.min(page, pageCount))} of {formatNumber(pageCount)}
        </span>
        <PageLink href={hrefForPage(page - 1)} disabled={page <= 1} label="Previous page">
          <ChevronLeft aria-hidden className="size-4" />
        </PageLink>
        <PageLink href={hrefForPage(page + 1)} disabled={page >= pageCount} label="Next page">
          <ChevronRight aria-hidden className="size-4" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  const classes = "inline-flex size-8 items-center justify-center rounded-lg border border-slate-300 bg-white";
  if (disabled) {
    return (
      <span aria-disabled className={cn(classes, "cursor-not-allowed opacity-40")} aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(classes, "text-slate-700 hover:bg-slate-50")}>
      {children}
    </Link>
  );
}
