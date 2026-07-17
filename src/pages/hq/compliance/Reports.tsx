import { Card } from "@/components/ui/card";
import { getOverviewMetrics, type OverviewMetrics } from "@/lib/compliance-workbench";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ComplianceReports() {
  const [m, setM] = useState<OverviewMetrics | null>(null);
  useEffect(() => {
    getOverviewMetrics().then(setM).catch(() => setM(null));
  }, []);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Management Reports</h2>
        <p className="text-sm text-muted-foreground">
          Customer wait time and provider wait time are reported separately from internal processing time.
        </p>
      </div>
      {!m ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <ReportCard title="Average decision" value={`${m.averageDecisionHours ?? "—"} h`} description="From Submitted to final decision, excluding paused time." />
          <ReportCard title="Time awaiting customer" value={`${m.timeAwaitingCustomerHours ?? "—"} h`} description="Aggregate customer-response wait time." />
          <ReportCard title="Time awaiting provider" value={`${m.timeAwaitingProviderHours ?? "—"} h`} description="Provider dependency wait time, tracked separately." />
          <ReportCard title="Approval turnaround" value={`${m.approvalTurnaroundHours ?? "—"} h`} description="From proposal to completion of all required distinct approvers." />
          <ReportCard title="Overdue" value={String(m.overdueCases)} description="Cases past their SLA target." />
          <ReportCard title="Periodic reviews due" value={String(m.periodicReviewsDue)} description="Scheduled full or partial reviews falling due." />
        </div>
      )}
      <Card className="p-4 text-sm">
        <div className="font-medium text-foreground">Export a management report</div>
        <p className="mt-1 text-muted-foreground">
          Bundled report generation is awaiting secure backend enablement. Metric definitions are
          fixed in the compliance workbench SSOT and will be consistent across the dashboard,
          exports and API projections.
        </p>
      </Card>
    </div>
  );
}

function ReportCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{description}</div>
    </Card>
  );
}
