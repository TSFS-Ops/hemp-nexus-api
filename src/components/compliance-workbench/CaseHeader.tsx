import { CWStatusBadge } from "./CWStatusBadge";
import { Card } from "@/components/ui/card";
import { Clock, ShieldAlert, MessageSquareWarning, User2 } from "lucide-react";
import type { CaseSummary } from "@/lib/compliance-workbench";
import { CASE_TYPE_LABELS } from "@/lib/compliance-workbench";
import { formatDate, formatDateTime, relativeFromNow } from "@/lib/funder-workspace/ui/labels";

/**
 * Header rendered at the top of every case detail page. Deliberately shows
 * ONLY human-readable identifiers — no UUIDs.
 */
export function CaseHeader({ summary }: { summary: CaseSummary }) {
  return (
    <Card className="p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Compliance case
          </div>
          <h1 className="mt-1 font-mono text-lg font-semibold text-foreground md:text-xl">
            {summary.reference}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {CASE_TYPE_LABELS[summary.type]} · {summary.primarySubject.displayName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CWStatusBadge kind="case_status" value={summary.status} />
          <CWStatusBadge kind="risk" value={summary.riskBand ?? undefined} />
          <CWStatusBadge kind="priority" value={summary.priority} />
          {summary.hasActiveHold && <CWStatusBadge kind="hold" value="critical_risk" />}
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border pt-4 text-sm md:grid-cols-4">
        <MetaCell
          icon={<User2 className="h-3.5 w-3.5" />}
          label="Assigned analyst"
          value={summary.assignment.analystDisplayName ?? "Unassigned"}
        />
        <MetaCell
          icon={<Clock className="h-3.5 w-3.5" />}
          label="SLA"
          value={
            summary.sla.targetAt
              ? `${summary.sla.breached ? "Breached · " : summary.sla.warning ? "Warning · " : ""}${relativeFromNow(summary.sla.targetAt)}`
              : "No SLA"
          }
          tone={summary.sla.breached ? "danger" : summary.sla.warning ? "warn" : "neutral"}
        />
        <MetaCell
          icon={<MessageSquareWarning className="h-3.5 w-3.5" />}
          label="Current task"
          value={summary.currentTask ?? "—"}
        />
        <MetaCell
          icon={<ShieldAlert className="h-3.5 w-3.5" />}
          label="Last updated"
          value={summary.lastActivityAt ? formatDateTime(summary.lastActivityAt) : formatDate(summary.openedAt)}
        />
      </div>
    </Card>
  );
}

function MetaCell({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : "text-foreground";
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-sm font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}
