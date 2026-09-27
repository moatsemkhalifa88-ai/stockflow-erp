import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

/** A status filter link with an optional count, used as tabs above document lists. */
export function StatusChip({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
        active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {label}
      {count !== undefined && <span className={cn("tabular-nums", active ? "text-white/80" : "text-slate-400")}>{formatNumber(count)}</span>}
    </Link>
  );
}
