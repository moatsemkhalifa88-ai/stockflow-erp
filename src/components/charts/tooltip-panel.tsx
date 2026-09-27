import type { ReactNode } from "react";

export interface TooltipRow {
  label: string;
  value: string;
  /** Series colour swatch; omitted for single-series charts. */
  color?: string;
}

/** Hover panel shared by all charts. Text stays in ink colours; only the swatch carries the series colour. */
export function TooltipPanel({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-[color:var(--viz-ink)]">{title}</p>
      <dl className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-[color:var(--viz-ink-secondary)]">
              {row.color && <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: row.color }} />}
              {row.label}
            </dt>
            <dd className="font-medium text-[color:var(--viz-ink)] tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-1 border-t border-slate-100 pt-1 text-[color:var(--viz-muted)]">{footer}</div>}
    </div>
  );
}
