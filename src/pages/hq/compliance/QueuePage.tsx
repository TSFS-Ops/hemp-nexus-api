import { useEffect, useState } from "react";
import { CaseQueueTable, QueueSkeleton, EmptyState } from "@/components/compliance-workbench";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Inbox } from "lucide-react";
import { listCases, type CaseSummary, type QueueFilters } from "@/lib/compliance-workbench";

interface Props {
  title: string;
  description?: string;
  initialFilters?: QueueFilters;
  emptyLabel?: string;
  showFilters?: boolean;
}

/** Shared shell used by every queue-style page in the internal workbench. */
export function QueuePage({ title, description, initialFilters, emptyLabel, showFilters = true }: Props) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCases(null);
    setError(null);
    listCases(initialFilters ?? {})
      .then((c) => alive && setCases(c))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialFilters)]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {error ? (
        <Card className="p-6" role="alert">
          <div className="flex items-start gap-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <div className="font-medium text-destructive">Cannot load cases</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </div>
        </Card>
      ) : !cases ? (
        <QueueSkeleton />
      ) : cases.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6 text-muted-foreground" />}
          title={emptyLabel ?? "No cases match this view"}
          description="When new cases arrive or filters change, they will appear here instantly."
        />
      ) : (
        <CaseQueueTable
          cases={cases}
          initialFilters={initialFilters}
          showFilters={showFilters}
          emptyLabel={emptyLabel}
        />
      )}
    </div>
  );
}
