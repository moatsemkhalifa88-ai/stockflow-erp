import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MovementTypeBadge } from "@/components/movements/movement-type-badge";
import { ReverseMovementForm } from "@/components/movements/reverse-movement-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { FlashToast } from "@/components/ui/flash-toast";
import { canMoveStock } from "@/lib/auth/permissions";
import { getActiveUser } from "@/lib/auth/session";
import { getMovement } from "@/lib/data/movements";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDateTime, formatNumber, formatSignedNumber } from "@/lib/format";
import { canReverseFromUi } from "@/lib/inventory";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Stock movement" };

export default async function MovementDetailPage({ params }: PageProps<"/movements/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [movement, user] = await Promise.all([getMovement(id), getActiveUser()]);
  if (!movement) notFound();

  const reversible = canReverseFromUi({
    reference_type: movement.referenceType,
    reversal_of_id: movement.reversalOfId,
    reversed_by_id: movement.reversedById,
  });
  const canReverse = reversible && user !== null && canMoveStock(user.role);

  return (
    <>
      <FlashToast
        messages={{
          created: { title: "Adjustment posted", description: movement.movementNumber, variant: "success" },
          reversed: { title: "Movement reversed", description: `Reversal ${movement.movementNumber} posted`, variant: "success" },
        }}
      />
      <PageHeader
        title={movement.movementNumber}
        description={`${formatDateTime(movement.movementDate)} · ${movement.performedByName ?? "System"}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Movement"
            action={
              <MovementTypeBadge
                type={movement.movementType}
                direction={movement.quantityChange}
                isReversal={movement.reversalOfId !== null}
              />
            }
          />
          <CardBody>
            <div className="mb-6 grid grid-cols-3 gap-4 rounded-lg bg-slate-50 p-4 text-center">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Before</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(movement.quantityBefore)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Change</p>
                <p
                  className={cn(
                    "mt-1 text-xl font-semibold tabular-nums",
                    movement.quantityChange > 0 ? "text-emerald-700" : "text-red-700",
                  )}
                >
                  {formatSignedNumber(movement.quantityChange)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">After</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(movement.quantityAfter)}</p>
              </div>
            </div>

            <DescriptionList
              items={[
                {
                  label: "Product",
                  value: (
                    <Link href={`/products/${movement.productId}`} className="text-brand-700 hover:underline">
                      <span className="font-mono">{movement.sku}</span> · {movement.productName}
                    </Link>
                  ),
                },
                {
                  label: "Warehouse",
                  value: (
                    <Link href={`/warehouses/${movement.warehouseId}`} className="text-brand-700 hover:underline">
                      <span className="font-mono">{movement.warehouseCode}</span> · {movement.warehouseName}
                    </Link>
                  ),
                },
                { label: "Unit cost", value: formatCurrency(movement.unitCost) },
                { label: "Movement value", value: formatCurrency(movement.movementValue) },
                { label: "Reference type", value: movement.referenceType },
                { label: "Reference", value: movement.referenceNumber },
                { label: "Reason", value: movement.reason },
                { label: "Notes", value: movement.notes },
                { label: "Recorded at", value: formatDateTime(movement.createdAt) },
                { label: "Performed by", value: movement.performedByName },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Corrections" />
          <CardBody className="space-y-4 text-sm">
            {movement.reversalOfId && (
              <p>
                This movement reverses{" "}
                <Link href={`/movements/${movement.reversalOfId}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {movement.reversalOfNumber}
                </Link>
                . Reversals cannot themselves be reversed.
              </p>
            )}
            {movement.reversedById && (
              <p>
                Reversed by{" "}
                <Link href={`/movements/${movement.reversedById}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {movement.reversedByNumber}
                </Link>
                .
              </p>
            )}
            {canReverse && (
              <ReverseMovementForm
                movementId={movement.id}
                movementNumber={movement.movementNumber}
                quantityChange={movement.quantityChange}
              />
            )}
            {movement.referenceType === "GOODS_RECEIPT" && movement.referenceId && (
              <p>
                Posted by goods receipt{" "}
                <Link href={`/goods-receipts/${movement.referenceId}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {movement.referenceNumber}
                </Link>
                . To correct it, reverse the goods receipt: that also updates the purchase order.
              </p>
            )}
            {movement.referenceType === "SALES_ORDER" && movement.referenceId && (
              <p>
                Shipped on sales order{" "}
                <Link href={`/sales-orders/${movement.referenceId}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {movement.referenceNumber}
                </Link>
                . To correct it, reverse the order&apos;s shipment: that puts every line back and resets the order.
              </p>
            )}
            {movement.referenceType === "STOCK_TRANSFER" && movement.referenceId && (
              <p>
                One leg of transfer{" "}
                <Link href={`/transfers/${movement.referenceId}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {movement.referenceNumber}
                </Link>
                . Transfers are corrected with a transfer back, never by reversing one leg.
              </p>
            )}
            {!movement.reversalOfId &&
              !movement.reversedById &&
              !reversible &&
              !["GOODS_RECEIPT", "SALES_ORDER", "STOCK_TRANSFER"].includes(movement.referenceType ?? "") && (
              <p className="flex gap-2 text-slate-500">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                Movements posted from a business document are corrected by cancelling that document.
              </p>
            )}
            <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
              The ledger is append-only. Mistakes are corrected with an opposite movement, never by editing or deleting history.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
