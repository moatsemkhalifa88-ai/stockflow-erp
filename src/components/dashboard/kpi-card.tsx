import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Stat tile. The value uses proportional figures (tabular-nums is for columns
 * that align, not standalone numbers). With `href` the tile links to the
 * report or list behind the number.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
}) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {hint && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
      </div>
      <span className="rounded-lg bg-brand-50 p-2">
        <Icon aria-hidden className="size-5 text-brand-600" />
      </span>
    </div>
  );

  if (href) {
    return (
      <Card className="p-5 transition-colors hover:border-brand-200 hover:bg-brand-50/30">
        <Link href={href} className="block">
          {body}
        </Link>
      </Card>
    );
  }
  return <Card className="p-5">{body}</Card>;
}

export function KpiCardSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </Card>
  );
}
