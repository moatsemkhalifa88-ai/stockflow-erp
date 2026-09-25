import { Card } from "./card";
import { Skeleton } from "./skeleton";

/** Loading placeholder for list pages: header, optional KPI row, filter bar and table rows. */
export function ListPageSkeleton({ kpis = 0, rows = 8, label }: { kpis?: number; rows?: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-6 h-4 w-80" />
      {kpis > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: kpis }, (_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-7 w-20" />
            </Card>
          ))}
        </div>
      )}
      <Card>
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
