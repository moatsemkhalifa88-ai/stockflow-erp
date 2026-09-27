import { Download } from "lucide-react";
import Form from "next/form";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { SelectField } from "@/components/ui/select-field";
import type { CategoryOption, WarehouseOption } from "@/lib/data/lookups";

/**
 * Filter row for a report plus its CSV export. The export link carries the same
 * query string, and the export route reads it with the same parser as the page.
 */
export function ReportFilterBar({
  action,
  exportUrl,
  warehouses,
  categories,
  warehouseId,
  categoryId,
  hidden,
  children,
  isFiltered,
}: {
  action: string;
  exportUrl: string;
  warehouses: WarehouseOption[];
  categories: CategoryOption[];
  warehouseId?: string;
  categoryId?: string;
  /** Parameters owned by other controls (e.g. the date range) to keep on submit. */
  hidden?: Record<string, string | undefined>;
  children?: ReactNode;
  isFiltered: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-end lg:justify-between">
      <Form action={action} className="grid flex-1 gap-3 sm:grid-cols-2 lg:flex lg:items-end [&>div]:lg:w-52">
        {Object.entries(hidden ?? {}).map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}
        {children}
        <SelectField
          id="report-warehouse"
          name="warehouse"
          label="Warehouse"
          placeholder="All warehouses"
          defaultValue={warehouseId ?? ""}
          options={warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
        />
        <SelectField
          id="report-category"
          name="category"
          label="Category"
          placeholder="All categories"
          defaultValue={categoryId ?? ""}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="flex gap-2 lg:w-auto">
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
      <a href={exportUrl} className={buttonClasses("primary", "md", "shrink-0")} download>
        <Download aria-hidden className="size-4" />
        Export CSV
      </a>
    </div>
  );
}
