"use client";

import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { formatBucket, type DateBucket } from "./chart-format";
import { TooltipPanel } from "./tooltip-panel";

export interface PurchasesSalesDatum {
  bucketStart: string;
  purchases: number;
  sales: number;
}

const SERIES = [
  { key: "purchases", label: "Purchases (received)", color: "var(--viz-series-1)" },
  { key: "sales", label: "Sales (shipped, net)", color: "var(--viz-series-2)" },
] as const;

/**
 * Two series on ONE currency axis (same unit, so no dual axis). Legend above,
 * plus a direct label on each line's last point; crosshair tooltip on hover.
 */
export function PurchasesSalesChart({ data, bucket }: { data: PurchasesSalesDatum[]; bucket: DateBucket }) {
  const last = data.length - 1;
  const axisTick = { fill: "var(--viz-muted)", fontSize: 12 };

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 px-2 text-xs text-[color:var(--viz-ink-secondary)]" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 56, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis
              dataKey="bucketStart"
              tick={axisTick}
              tickFormatter={(v: string) => formatBucket(v, bucket)}
              axisLine={{ stroke: "var(--viz-axis)" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis tick={axisTick} tickFormatter={(v: number) => formatCompactCurrency(v)} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const datum = active && payload?.[0] ? (payload[0].payload as PurchasesSalesDatum) : null;
                if (!datum) return null;
                return (
                  <TooltipPanel
                    title={formatBucket(datum.bucketStart, bucket, true)}
                    rows={SERIES.map((s) => ({ label: s.label, value: formatCurrency(datum[s.key]), color: s.color }))}
                  />
                );
              }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: s.color, stroke: "var(--viz-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey={s.key}
                  content={(props) => {
                    const { x, y, index, value } = props;
                    if (index !== last || typeof x !== "number" || typeof y !== "number") return null;
                    return (
                      <text x={x + 6} y={y} dy={4} fontSize={11} fill="var(--viz-ink-secondary)">
                        {formatCompactCurrency(Number(value))}
                      </text>
                    );
                  }}
                />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
