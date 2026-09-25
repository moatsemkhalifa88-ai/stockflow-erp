import { AlertTriangle, Boxes, CircleX, Package, Truck, Users, Wallet, Warehouse } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { getSession } from "@/lib/auth/session";
import { listWarehouseSummaries, totalsOf } from "@/lib/data/warehouses";
import { formatCurrency, formatNumber, formatWarehouseType } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

async function loadDashboard() {
  const supabase = await createClient();
  const [products, suppliers, customers, warehouses] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("warehouses")
      .select("id, code, name, city, warehouse_type, is_active")
      .order("warehouse_type")
      .order("name"),
  ]);

  const failed = [products, suppliers, customers, warehouses].find((r) => r.error);
  if (failed?.error) throw new Error(`Failed to load dashboard: ${failed.error.message}`);

  return {
    productCount: products.count ?? 0,
    supplierCount: suppliers.count ?? 0,
    customerCount: customers.count ?? 0,
    warehouses: warehouses.data ?? [],
  };
}

export default async function DashboardPage() {
  const [session, data, stock] = await Promise.all([getSession(), loadDashboard(), listWarehouseSummaries()]);
  const totals = totalsOf(stock);
  const hasStock = stock.some((w) => w.totalQuantity > 0 || w.lowStockCount + w.outOfStockCount > 0);
  const firstName = session.status === "active" ? session.user.fullName.split(" ")[0] : "";
  const activeWarehouses = data.warehouses.filter((w) => w.is_active);

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description="Overview of your inventory and warehouse operations."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active products" value={formatNumber(data.productCount)} icon={Package} hint="In the product catalogue" />
        <KpiCard label="Warehouses" value={formatNumber(activeWarehouses.length)} icon={Warehouse} hint="Active locations" />
        <KpiCard label="Suppliers" value={formatNumber(data.supplierCount)} icon={Truck} hint="Active suppliers" />
        <KpiCard label="Customers" value={formatNumber(data.customerCount)} icon={Users} hint="Active customers" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Inventory overview"
            description="Stock levels, value and alerts across all warehouses"
            action={
              <LinkButton href="/inventory" variant="ghost" size="sm">
                View inventory
              </LinkButton>
            }
          />
          {hasStock ? (
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <InventoryStat icon={Wallet} label="Inventory value" value={formatCurrency(totals.inventoryValue)} />
              <InventoryStat icon={Boxes} label="Units on hand" value={formatNumber(totals.totalQuantity)} />
              <InventoryStat icon={AlertTriangle} label="Low-stock items" value={formatNumber(totals.lowStockCount)} href="/inventory?status=LOW_STOCK" />
              <InventoryStat icon={CircleX} label="Out-of-stock items" value={formatNumber(totals.outOfStockCount)} href="/inventory?status=OUT_OF_STOCK" />
            </CardBody>
          ) : (
            <EmptyState
              icon={Boxes}
              title="No stock recorded yet"
              description="Inventory is built only from audited stock movements. Post an adjustment or run npm run seed:stock to load opening balances."
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Warehouses" description={`${activeWarehouses.length} active locations`} />
          {data.warehouses.length === 0 ? (
            <EmptyState icon={Warehouse} title="No warehouses" description="Run the seed script to load demo data." />
          ) : (
            <CardBody className="px-0 py-0">
              <ul className="divide-y divide-slate-100">
                {data.warehouses.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{w.name}</p>
                      <p className="text-xs text-slate-500">
                        <span className="font-mono">{w.code}</span> · {w.city}
                      </p>
                    </div>
                    <Badge tone={w.is_active ? "info" : "neutral"}>
                      {w.is_active ? formatWarehouseType(w.warehouse_type) : "Inactive"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

function InventoryStat({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="rounded-lg bg-brand-50 p-2">
        <Icon aria-hidden className="size-5 text-brand-600" />
      </span>
      <span>
        <span className="block text-sm text-slate-500">{label}</span>
        <span className="block text-xl font-semibold text-slate-900 tabular-nums">{value}</span>
      </span>
    </>
  );
  const classes = "flex items-center gap-3 rounded-lg border border-slate-100 p-4";
  return href ? (
    <Link href={href} className={`${classes} hover:border-brand-200 hover:bg-brand-50/40`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
