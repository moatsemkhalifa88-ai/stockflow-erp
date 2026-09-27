import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export interface SortOption {
  key: string;
  label: string;
  href: string;
}

/** "Sort by" links for lists whose table is shared with other pages (so its headers are not sortable). */
export function SortLinks({ options, active, ascending }: { options: SortOption[]; active: string; ascending: boolean }) {
  return (
    <nav aria-label="Sort" className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2 text-sm">
      <span className="text-slate-500">Sort by</span>
      {options.map((option) => {
        const isActive = option.key === active;
        const Icon = ascending ? ArrowUp : ArrowDown;
        return (
          <Link
            key={option.key}
            href={option.href}
            scroll={false}
            aria-current={isActive ? "true" : undefined}
            className={cn("inline-flex items-center gap-1 hover:text-slate-900", isActive ? "font-medium text-slate-900" : "text-slate-600")}
          >
            {option.label}
            {isActive && <Icon aria-label={ascending ? "ascending" : "descending"} className="size-3.5 text-brand-600" />}
          </Link>
        );
      })}
    </nav>
  );
}
