import { AlertTriangle, ArrowRight, History, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  {
    href: "/reports/inventory-valuation",
    icon: Wallet,
    title: "Inventory Valuation",
    description: "Stock and value per product and warehouse on any date, at current cost prices.",
  },
  {
    href: "/reports/stock-movements",
    icon: History,
    title: "Stock Movement Report",
    description: "Every ledger entry in a period, with units and value in and out.",
  },
  {
    href: "/reports/low-stock",
    icon: AlertTriangle,
    title: "Low Stock Report",
    description: "Locations at or below their minimum, with a suggested order quantity.",
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Filter by date, warehouse and category, then export to CSV. The same SQL views are available to Power BI."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.href} className="transition-colors hover:border-brand-200">
            <Link href={r.href} className="flex h-full flex-col gap-3 p-5">
              <span className="w-fit rounded-lg bg-brand-50 p-2">
                <r.icon aria-hidden className="size-5 text-brand-600" />
              </span>
              <span className="font-semibold text-slate-900">{r.title}</span>
              <span className="flex-1 text-sm text-slate-500">{r.description}</span>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
                Open report <ArrowRight aria-hidden className="size-4" />
              </span>
            </Link>
          </Card>
        ))}
      </div>
    </>
  );
}
