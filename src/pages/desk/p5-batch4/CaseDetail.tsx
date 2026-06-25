/**
 * P-5 Batch 4 Stage 5 — organisation / counterparty user case detail.
 *
 * Strictly task-focused view: case summary, current milestone, progress
 * bar, due date, next action, blockers (external-safe label only),
 * evidence checklist with upload/replace actions.
 *
 * NEVER renders: admin-only fields, internal notes, funder release
 * data, full audit log, raw evidence file references / hashes,
 * provider internals, other organisations' data. All reads go through
 * `p5b4OrgUserClient`; the only mutation surface is
 * `p5b4OrgUser.submitEvidence` (used inside the evidence component).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { P5B4DeskStatusBadge } from "./components/P5B4DeskStatusBadge";
import { P5B4DeskMilestoneProgress } from "./components/P5B4DeskMilestoneProgress";
import { P5B4DeskBlockerNotice } from "./components/P5B4DeskBlockerNotice";
import { P5B4DeskEvidenceTask } from "./components/P5B4DeskEvidenceTask";
import { P5B4DeskNextAction } from "./components/P5B4DeskNextAction";
import {
  p5b4OrgUserClient,
  type P5B4OrgUserSummaryResponse,
} from "@/lib/p5-batch4/org-user-client";

export default function P5Batch4DeskCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [data, setData] = useState<P5B4OrgUserSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await p5b4OrgUserClient.getMyCase(caseId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!caseId) {
    return <p className="text-sm text-destructive">Missing case id.</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" data-testid="p5b4-desk-case-detail-error">
        {error}
      </p>
    );
  }
  const summary = data?.cases[0];
  if (!summary) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="p5b4-desk-case-not-found">
          Case not found, or you no longer have access.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/desk/p5-batch4">Back to my cases</Link>
        </Button>
      </div>
    );
  }

  const milestones = data?.milestones ?? [];
  const blockers = data?.blockers ?? [];
  const evidence = data?.evidence ?? [];

  return (
    <div className="space-y-6" data-testid="p5b4-desk-case-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/desk/p5-batch4"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← My cases
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{summary.case_reference}</h1>
          <p className="text-sm text-muted-foreground">
            {summary.process_type.replace(/_/g, " ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <P5B4DeskStatusBadge kind="execution" value={summary.execution_status} />
            <P5B4DeskStatusBadge kind="readiness" value={summary.readiness_status} />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <P5B4DeskNextAction summary={summary} evidence={evidence} />

      <P5B4DeskMilestoneProgress
        milestones={milestones}
        currentMilestoneKey={summary.current_milestone}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items needing attention</CardTitle>
        </CardHeader>
        <CardContent>
          <P5B4DeskBlockerNotice blockers={blockers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <P5B4DeskEvidenceTask evidence={evidence} onChanged={() => void load()} />
        </CardContent>
      </Card>
    </div>
  );
}
