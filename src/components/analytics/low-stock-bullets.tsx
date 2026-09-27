import Link from "next/link";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import type { LowStockLine } from "@/lib/data/reports";
import { formatNumber } from "@/lib/format";

/**
 * Bullet rows: on-hand bar against a tick at the minimum stock level. Status is
 * carried by the badge (icon + label), never by the bar colour alone.
 */
export function LowStockBullets({ lines }: { lines: LowStockLine[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((l) => {
        const scale = Math.max(l.minStockLevel, l.quantity, 1) * 1.15;
        const barPct = (l.quantity / scale) * 100;
        const minPct = (l.minStockLevel / scale) * 100;
        return (
          <li key={`${l.productId}-${l.warehouseId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-2.5">
            <Link href={`/products/${l.productId}`} className="min-w-0 truncate text-sm hover:underline">
              <span className="font-mono text-xs text-slate-500">{l.sku}</span> <span className="text-slate-900">{l.productName}</span>
            </Link>
            <StockStatusBadge status={l.stockStatus} />
            <div
              className="relative h-2 rounded-full bg-slate-100"
              role="img"
              aria-label={`${l.quantity} on hand, minimum ${l.minStockLevel}`}
            >
              <div className="h-2 rounded-full bg-[color:var(--viz-series-1)]" style={{ width: `${barPct}%` }} />
              <div aria-hidden className="absolute -top-1 h-4 w-0.5 rounded bg-slate-900" style={{ left: `${minPct}%` }} />
            </div>
            <p className="text-xs whitespace-nowrap text-slate-500 tabular-nums">
              <span className="font-medium text-slate-900">{formatNumber(l.quantity)}</span> / min {formatNumber(l.minStockLevel)} ·{" "}
              {l.warehouseCode}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
