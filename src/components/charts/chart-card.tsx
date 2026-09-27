import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";

/**
 * A chart with its accessible twin: every chart ships a table view (values are
 * never only readable by hovering).
 */
export function ChartCard({
  title,
  description,
  action,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** The same data as a table. */
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <div className="px-3 pt-4 pb-2 sm:px-5">{children}</div>
      <details className="group border-t border-slate-100">
        <summary className="cursor-pointer list-none px-5 py-2.5 text-xs font-medium text-slate-500 select-none hover:text-slate-800 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show as table</span>
          <span className="hidden group-open:inline">Hide table</span>
        </summary>
        <div className="max-h-80 overflow-auto border-t border-slate-100">{table}</div>
      </details>
    </Card>
  );
}

/** Minimal table for chart table views. */
export function ChartTable({ headers, rows }: { headers: { label: string; numeric?: boolean }[]; rows: ReactNode[][] }) {
  return (
    <table className="min-w-full text-sm">
      <thead className="sticky top-0 bg-slate-50">
        <tr>
          {headers.map((h) => (
            <th
              key={h.label}
              scope="col"
              className={`px-4 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase ${h.numeric ? "text-right" : "text-left"}`}
            >
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((cell, j) => (
              <td key={j} className={`px-4 py-1.5 whitespace-nowrap text-slate-700 ${headers[j]?.numeric ? "text-right tabular-nums" : ""}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
