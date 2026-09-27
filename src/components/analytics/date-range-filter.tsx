import { Check } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { RANGE_LABELS, RANGE_PRESETS, type DateRange } from "@/lib/date-range";
import { buildHref, type SearchParams } from "@/lib/search-params";

/**
 * One filter row that scopes everything below it: preset ranges as links and a
 * custom from / to range. Other query parameters are kept.
 */
export function DateRangeFilter({
  action,
  params,
  range,
  label = "Period",
}: {
  action: string;
  params: SearchParams;
  range: DateRange;
  label?: string;
}) {
  const keep = Object.entries(params).filter(([k]) => !["range", "from", "to", "page"].includes(k));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <nav aria-label={`${label} presets`} className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-medium text-slate-700">{label}</span>
        {RANGE_PRESETS.map((preset) => {
          const active = range.preset === preset;
          return (
            <Link
              key={preset}
              href={buildHref(action, params, { range: preset, from: undefined, to: undefined, page: undefined })}
              aria-current={active ? "true" : undefined}
              scroll={false}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm",
                active ? "bg-slate-900 font-semibold text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {active && <Check aria-hidden className="size-3.5" />}
              {RANGE_LABELS[preset]}
            </Link>
          );
        })}
      </nav>
      <Form action={action} scroll={false} className="flex flex-wrap items-end gap-2">
        {keep.map(([name, value]) => {
          const v = Array.isArray(value) ? value[0] : value;
          return v ? <input key={name} type="hidden" name={name} value={v} /> : null;
        })}
        <label className="text-xs text-slate-500">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className="mt-0.5 block h-9 rounded-lg border border-slate-300 px-2 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            className="mt-0.5 block h-9 rounded-lg border border-slate-300 px-2 text-sm text-slate-900"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" className="h-9">
          Apply
        </Button>
      </Form>
      <p className="sr-only" aria-live="polite">
        Showing {formatDate(range.from)} to {formatDate(range.to)}
      </p>
    </div>
  );
}
