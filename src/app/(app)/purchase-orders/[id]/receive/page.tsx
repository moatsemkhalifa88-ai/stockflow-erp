import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ReceiveForm } from "@/components/purchasing/receive-form";
import { receiveGoods } from "@/lib/actions/purchase-orders";
import { getActiveUser } from "@/lib/auth/session";
import { getPurchaseOrderLines, getPurchaseOrderSummary } from "@/lib/data/purchase-orders";
import { canPerform } from "@/lib/purchasing";
import { isUuid } from "@/lib/search-params";

export const metadata: Metadata = { title: "Receive goods" };

export default async function ReceiveGoodsPage({ params }: PageProps<"/purchase-orders/[id]/receive">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [user, po, lines] = await Promise.all([getActiveUser(), getPurchaseOrderSummary(id), getPurchaseOrderLines(id)]);
  if (!po) notFound();
  if (!user || !canPerform("receive", user.role, po.status)) redirect(`/purchase-orders/${id}`);

  return (
    <>
      <PageHeader
        title={`Receive ${po.poNumber}`}
        description={`${po.supplierName} · each line received is posted to the stock ledger as a purchase receipt.`}
      />
      <ReceiveForm
        action={receiveGoods.bind(null, po.id)}
        lines={lines}
        cancelHref={`/purchase-orders/${po.id}`}
        warehouseLabel={`${po.warehouseCode} · ${po.warehouseName}`}
      />
    </>
  );
}
