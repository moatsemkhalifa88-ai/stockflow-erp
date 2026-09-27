import { ListPageSkeleton } from "@/components/ui/page-skeleton";

export default function MovementReportLoading() {
  return <ListPageSkeleton label="Loading stock movement report" kpis={4} />;
}
