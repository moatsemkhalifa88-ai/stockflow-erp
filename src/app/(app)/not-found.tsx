import { FileQuestion } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";

/** Shown inside the app shell when a record does not exist (or RLS hides it from you). */
export default function AppNotFound() {
  return (
    <Card>
      <EmptyState
        icon={FileQuestion}
        title="Record not found"
        description="It may never have existed, or your role does not give you access to it. Nothing is ever deleted in StockFlow, so check the link."
        action={<LinkButton href="/dashboard" variant="secondary">Back to dashboard</LinkButton>}
      />
    </Card>
  );
}
