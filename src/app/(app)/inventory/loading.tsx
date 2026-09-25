import { ListPageSkeleton } from "@/components/ui/page-skeleton";

export default function InventoryLoading() {
  return <ListPageSkeleton label="Loading inventory" kpis={4} />;
}
