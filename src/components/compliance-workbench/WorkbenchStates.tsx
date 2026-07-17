/**
 * Shared skeleton loaders and empty states for the Compliance Workbench
 * and evidence surfaces. Centralised so every route uses the same
 * shimmer geometry and empty-state voice — transitions feel instant
 * because placeholders match the final layout's shape.
 */
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileX, Inbox, ShieldCheck } from "lucide-react";

/** Row skeleton matching CaseQueueTable's row height. */
export function QueueSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Card className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-12 gap-3 p-3">
            <Skeleton className="col-span-3 h-4" />
            <Skeleton className="col-span-4 h-4" />
            <Skeleton className="col-span-2 h-4" />
            <Skeleton className="col-span-2 h-4" />
            <Skeleton className="col-span-1 h-4" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** Metric-tile skeleton matching Overview grid. */
export function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Card key={i} className="p-3">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="mb-3 h-4 w-32" />
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="mb-2">
                <Skeleton className="mb-1 h-3 w-full" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Case detail skeleton: header + tab bar + body. */
export function CaseDetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-20" />
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-72" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      </Card>
      <Skeleton className="h-9 w-full max-w-3xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <Skeleton className="mb-2 h-3 w-24" />
          <Skeleton className="h-5 w-48" />
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-2 h-3 w-24" />
          <Skeleton className="h-5 w-48" />
        </Card>
        <Card className="p-4 md:col-span-2">
          <Skeleton className="mb-3 h-3 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-4 w-full" />
          ))}
        </Card>
      </div>
    </div>
  );
}

/** Evidence list skeleton — one card per expected requirement. */
export function EvidenceSkeleton({ items = 4 }: { items?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: items }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "success";
}

/** Neutral, on-brand empty state matching workbench card treatment. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
}: EmptyStateProps) {
  const Icon =
    icon ??
    (tone === "success" ? (
      <ShieldCheck className="h-6 w-6 text-primary" />
    ) : (
      <Inbox className="h-6 w-6 text-muted-foreground" />
    ));
  return (
    <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        {Icon}
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && (
        <div className="max-w-md text-xs text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

/** Small inline empty state for tabs/lists inside a case. */
export function InlineEmpty({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex items-center gap-3 p-4 text-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        {icon ?? <FileX className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
    </Card>
  );
}
