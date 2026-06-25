/**
 * P-5 Batch 4 Stage 4 — admin case detail.
 *
 * Reads via the Stage 3 audience-filtered edge function with
 * include=milestones,blockers,evidence,audit. All mutations call the
 * Stage 3 typed wrappers in `@/lib/p5-batch4/rpc`.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { P5B4StatusBadge } from "./components/P5B4StatusBadge";
import { P5B4ProviderSafeLabel } from "./components/P5B4ProviderSafeLabel";
import { P5B4MilestoneTimeline } from "./components/P5B4MilestoneTimeline";
import { P5B4BlockerCard } from "./components/P5B4BlockerCard";
import { P5B4EvidenceChecklist } from "./components/P5B4EvidenceChecklist";
import { P5B4ReasonedActionDialog } from "./components/P5B4ReasonedActionDialog";
import {
  p5b4SummaryClient,
  type P5B4AdminSummaryResponse,
  type P5B4AdminCaseSummary,
} from "@/lib/p5-batch4/summary-client";
import { p5b4Admin } from "@/lib/p5-batch4/rpc";

export default function P5Batch4CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [data, setData] = useState<P5B4AdminSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await p5b4SummaryClient.getAdminCase(caseId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!caseId) return <p className="p-6 text-sm text-destructive">Missing case id.</p>;
  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (error)
    return (
      <p className="p-6 text-sm text-destructive" data-testid="p5b4-case-detail-error">
        {error}
      </p>
    );

  const c: P5B4AdminCaseSummary | undefined = data?.cases[0];
  if (!c) return <p className="p-6 text-sm text-muted-foreground">Case not found.</p>;

  const blockers = data?.blockers ?? [];
  const milestones = data?.milestones ?? [];
  const evidence = data?.evidence ?? [];

  return (
    <div className="space-y-6 p-6" data-testid="p5b4-admin-case-detail">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{c.case_reference}</h1>
          <p className="text-sm text-muted-foreground">
            {c.process_type.replace(/_/g, " ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <P5B4StatusBadge kind="execution" value={c.execution_status} />
            <P5B4StatusBadge kind="readiness" value={c.readiness_status} />
            {c.provider_dependency_status ? (
              <P5B4ProviderSafeLabel label={c.provider_dependency_status} />
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <P5B4ReasonedActionDialog
            trigger={
              <Button variant="default" data-testid="p5b4-final-approval">
                Record final approval
              </Button>
            }
            title="Record final approval"
            description="Admin-only. Recorded immutably in the audit timeline."
            warning="Final approval cannot be undone."
            destructive
            onConfirm={async (reason) => {
              const { error } = await p5b4Admin.recordFinalApproval(c.id, reason);
              if (error) throw error;
              await load();
            }}
          />
          <P5B4ReasonedActionDialog
            trigger={
              <Button variant="outline" data-testid="p5b4-close-case">
                Close case
              </Button>
            }
            title="Close case"
            description="Closes the case. Reopen requires another reasoned action."
            onConfirm={async (reason) => {
              const { error } = await p5b4Admin.closeCase(c.id, reason);
              if (error) throw error;
              await load();
            }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Milestones</CardTitle>
        </CardHeader>
        <CardContent>
          <P5B4MilestoneTimeline caseId={c.id} milestones={milestones} onChanged={load} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Blockers &amp; Warnings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open blockers.</p>
          ) : (
            blockers.map((b) => <P5B4BlockerCard key={b.id} blocker={b} onChanged={load} />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <P5B4EvidenceChecklist evidence={evidence} onChanged={load} />
        </CardContent>
      </Card>
    </div>
  );
}
