import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Horizontally scrollable table for data grids. */
export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-slate-50">
      <tr>{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-slate-50/60", className)} {...props} />;
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({ align = "left", className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase", ALIGN[align], className)}
      {...props}
    />
  );
}

export function Td({ align = "left", className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return <td className={cn("px-4 py-3 whitespace-nowrap text-slate-700", ALIGN[align], className)} {...props} />;
}

/**
 * Column header that links to the same list sorted by this column.
 * `href` is built by the page so filters are kept.
 */
export function SortableTh({
  label,
  href,
  active,
  ascending,
  align = "left",
}: {
  label: string;
  href: string;
  active: boolean;
  ascending: boolean;
  align?: Align;
}) {
  const Icon = !active ? ArrowUpDown : ascending ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
      className={cn("px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap uppercase", ALIGN[align])}
    >
      <Link
        href={href}
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 hover:text-slate-900",
          active ? "text-slate-900" : "text-slate-600",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon aria-hidden className={cn("size-3.5", active ? "text-brand-600" : "text-slate-400")} />
      </Link>
    </th>
  );
}
