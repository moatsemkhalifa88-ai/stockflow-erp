"use client";

import { Bar, BarChart as ReBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAxisValue, formatValue, type ValueFormat } from "./chart-format";
import { TooltipPanel } from "./tooltip-panel";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Extra lines for the tooltip, e.g. "In: 70". */
  details?: { label: string; value: string }[];
}

/**
 * Single-series bar chart (one colour, slot 1 - nominal categories are never
 * coloured by a value ramp). Horizontal for long labels such as product names.
 */
export function BarChart({
  data,
  format,
  seriesLabel,
  orientation = "vertical",
}: {
  data: BarDatum[];
  format: ValueFormat;
  /** Names the measure in the tooltip, e.g. "Inventory value". */
  seriesLabel: string;
  orientation?: "vertical" | "horizontal";
}) {
  const horizontal = orientation === "horizontal";
  // Horizontal: one 28px band per row plus the axis band, so nothing is clipped.
  const height = horizontal ? data.length * 30 + 36 : 260;
  const axisTick = { fill: "var(--viz-muted)", fontSize: 12 };

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 4, right: 16, bottom: 0, left: horizontal ? 8 : 0 }}
          barCategoryGap={horizontal ? 6 : "24%"}
          accessibilityLayer
        >
          <CartesianGrid stroke="var(--viz-grid)" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tick={axisTick}
                tickFormatter={(v: number) => formatAxisValue(v, format)}
                axisLine={{ stroke: "var(--viz-axis)" }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={170}
                tick={axisTick}
                tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)}
                axisLine={{ stroke: "var(--viz-axis)" }}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: "var(--viz-axis)" }} tickLine={false} interval={0} />
              <YAxis
                tick={axisTick}
                tickFormatter={(v: number) => formatAxisValue(v, format)}
                axisLine={false}
                tickLine={false}
                width={64}
              />
            </>
          )}
          <Tooltip
            cursor={{ fill: "var(--viz-hover)" }}
            content={({ active, payload }) => {
              const datum = active && payload?.[0] ? (payload[0].payload as BarDatum) : null;
              if (!datum) return null;
              return (
                <TooltipPanel
                  title={datum.label}
                  rows={[{ label: seriesLabel, value: formatValue(datum.value, format) }, ...(datum.details ?? [])]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            name={seriesLabel}
            fill="var(--viz-series-1)"
            maxBarSize={horizontal ? 18 : 40}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
