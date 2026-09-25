import Link from "next/link";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatSignedNumber } from "@/lib/format";
import type { Movement } from "@/lib/data/movements";
import { cn } from "@/lib/cn";
import { MovementTypeBadge } from "./movement-type-badge";

type Column = "product" | "warehouse";

/**
 * Ledger table used on the movements page and on product / warehouse detail
 * pages. `hide` drops a column that is implied by the page (e.g. the product).
 */
export function MovementTable({ movements, hide = [] }: { movements: Movement[]; hide?: Column[] }) {
  const show = (column: Column) => !hide.includes(column);

  return (
    <Table caption="Stock movements">
      <THead>
        <Th>Movement</Th>
        <Th>Date</Th>
        <Th>Type</Th>
        {show("product") && <Th>Product</Th>}
        {show("warehouse") && <Th>Warehouse</Th>}
        <Th align="right">Change</Th>
        <Th align="right">Before → After</Th>
        <Th>Reference / reason</Th>
        <Th>By</Th>
      </THead>
      <TBody>
        {movements.map((m) => (
          <Tr key={m.id}>
            <Td>
              <Link href={`/movements/${m.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                {m.movementNumber}
              </Link>
              {m.reversedByNumber && <p className="text-xs text-slate-400">Reversed by {m.reversedByNumber}</p>}
            </Td>
            <Td className="text-slate-500">{formatDateTime(m.movementDate)}</Td>
            <Td>
              <MovementTypeBadge type={m.movementType} direction={m.quantityChange} isReversal={m.reversalOfId !== null} />
            </Td>
            {show("product") && (
              <Td className="max-w-64">
                <Link href={`/products/${m.productId}`} className="block truncate hover:underline">
                  <span className="font-mono text-xs text-slate-500">{m.sku}</span> {m.productName}
                </Link>
              </Td>
            )}
            {show("warehouse") && (
              <Td>
                <Link href={`/warehouses/${m.warehouseId}`} className="font-mono text-xs hover:underline">
                  {m.warehouseCode}
                </Link>
              </Td>
            )}
            <Td
              align="right"
              className={cn("font-medium tabular-nums", m.quantityChange > 0 ? "text-emerald-700" : "text-red-700")}
            >
              {formatSignedNumber(m.quantityChange)}
            </Td>
            <Td align="right" className="text-slate-500 tabular-nums">
              {formatNumber(m.quantityBefore)} → <span className="text-slate-900">{formatNumber(m.quantityAfter)}</span>
            </Td>
            <Td className="max-w-72">
              <p className="truncate">{m.referenceNumber ?? <span className="text-slate-400">—</span>}</p>
              {m.reason && <p className="truncate text-xs text-slate-500">{m.reason}</p>}
            </Td>
            <Td className="text-slate-500">{m.performedByName ?? "System"}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
