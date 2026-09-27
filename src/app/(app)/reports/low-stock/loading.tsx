import { ListPageSkeleton } from "@/components/ui/page-skeleton";

export default function LowStockLoading() {
  return <ListPageSkeleton label="Loading low stock report" kpis={4} />;
}
