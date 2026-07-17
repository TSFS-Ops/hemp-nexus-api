import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { OverviewSkeleton } from "@/components/compliance-workbench";
import { getOverviewMetrics, RISK_BANDS, RISK_BAND_LABELS, CASE_STATUS_LABELS, CASE_TYPE_LABELS, type OverviewMetrics, type CaseStatus, type CaseType } from "@/lib/compliance-workbench";
import { AlertTriangle, Clock, ShieldAlert, Users } from "lucide-react";

export default function ComplianceOverview() {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOverviewMetrics()
      .then((m) => alive && setMetrics(m))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <Card className="p-6" role="alert">
        <div className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <div>
            <div className="font-medium text-destructive">Cannot load metrics</div>
            <div className="text-muted-foreground">{error}</div>
          </div>
        </div>
      </Card>
    );
  }
  if (!metrics) {
    return <OverviewSkeleton />;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">Overview metrics</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Open cases" value={metrics.openCases} />
          <Metric label="Unassigned" value={metrics.unassignedCases} accent={metrics.unassignedCases > 0 ? "warn" : "neutral"} />
          <Metric label="High risk" value={metrics.highRiskCases} accent="warn" />
          <Metric label="Critical risk" value={metrics.criticalRiskCases} accent="danger" />
          <Metric label="Overdue" value={metrics.overdueCases} accent={metrics.overdueCases > 0 ? "danger" : "neutral"} />
          <Metric label="SLA warnings" value={metrics.slaWarnings} accent="warn" />
          <Metric label="SLA breaches" value={metrics.slaBreaches} accent="danger" />
          <Metric label="Outstanding RFIs" value={metrics.outstandingRfis} />
          <Metric label="Pending approvals" value={metrics.pendingApprovals} />
          <Metric label="Active holds" value={metrics.activeHolds} accent="danger" />
          <Metric label="Provider errors" value={metrics.providerErrors} accent="warn" />
          <Metric label="Appeals" value={metrics.appeals} />
          <Metric label="Periodic reviews due" value={metrics.periodicReviewsDue} />
          <Metric label="Avg decision (h)" value={metrics.averageDecisionHours ?? "—"} icon={<Clock className="h-3.5 w-3.5" />} />
          <Metric label="Awaiting customer (h)" value={metrics.timeAwaitingCustomerHours ?? "—"} />
          <Metric label="Awaiting provider (h)" value={metrics.timeAwaitingProviderHours ?? "—"} />
        </div>
      </section>

      <section aria-labelledby="dist-heading" className="grid gap-4 lg:grid-cols-3">
        <h2 id="dist-heading" className="sr-only">Distributions</h2>
        <DistributionCard title="Risk distribution" icon={<ShieldAlert className="h-4 w-4" />}>
          {RISK_BANDS.map((b) => (
            <DistRow key={b} label={RISK_BAND_LABELS[b]} value={metrics.riskDistribution[b]} total={metrics.openCases} />
          ))}
        </DistributionCard>
        <DistributionCard title="Status distribution" icon={<Clock className="h-4 w-4" />}>
          {(Object.entries(metrics.statusDistribution) as [CaseStatus, number][]).map(([s, n]) => (
            <DistRow key={s} label={CASE_STATUS_LABELS[s]} value={n} total={metrics.openCases} />
          ))}
        </DistributionCard>
        <DistributionCard title="Cases by type" icon={<Users className="h-4 w-4" />}>
          {(Object.entries(metrics.caseTypeDistribution) as [CaseType, number][]).map(([t, n]) => (
            <DistRow key={t} label={CASE_TYPE_LABELS[t]} value={n} total={metrics.openCases} />
          ))}
        </DistributionCard>
      </section>

      <section aria-labelledby="analysts-heading">
        <h2 id="analysts-heading" className="mb-2 text-sm font-semibold text-foreground">Cases by analyst</h2>
        <Card className="divide-y divide-border">
          {metrics.perAnalyst.map((a) => (
            <div key={a.analystDisplayName} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-medium">{a.analystDisplayName}</span>
              <div className="flex gap-4 text-muted-foreground">
                <span>{a.open} open</span>
                <span className={a.overdue > 0 ? "text-destructive" : ""}>{a.overdue} overdue</span>
              </div>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function Metric({ label, value, accent = "neutral", icon }: { label: string; value: number | string; accent?: "neutral" | "warn" | "danger"; icon?: React.ReactNode }) {
  const cls =
    accent === "danger"
      ? "text-destructive"
      : accent === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : "text-foreground";
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </Card>
  );
}

function DistributionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </Card>
  );
}

function DistRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="text-xs">
      <div className="flex justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded bg-muted">
        <div className="h-1.5 rounded bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
