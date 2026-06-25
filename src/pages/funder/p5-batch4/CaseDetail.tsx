/**
 * P-5 Batch 4 Stage 6 — released case detail (funder).
 *
 * Strictly the funder-safe projection. NEVER renders: owner_user_id,
 * created_by, linked_*, internal notes, audit trail, raw evidence
 * references / hashes, finality internals, provider internals, or
 * other funders' data. The funder can record a decision via the
 * approved wrapper `p5b4Funder.recordDecision` only.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { P5B4FunderShell } from "./components/P5B4FunderShell";
import { P5B4FunderStatusBadge } from "./components/P5B4FunderStatusBadge";
import { P5B4FunderUnavailable } from "./components/P5B4FunderUnavailable";
import { P5B4FunderDecisionForm } from "./components/P5B4FunderDecisionForm";
import {
  p5b4FunderClient,
  type P5B4FunderCaseSummary,
} from "@/lib/p5-batch4/funder-client";

export default function P5Batch4FunderCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [summary, setSummary] = useState<P5B4FunderCaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await p5b4FunderClient.getReleasedCase(caseId);
      setSummary(res.cases[0] ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <P5B4FunderShell
      title="Released case"
      description="Released for your funder organisation only."
    >
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <P5B4FunderUnavailable message={error} /> : null}

      {!loading && !error && !summary ? (
        <div className="space-y-3">
          <P5B4FunderUnavailable message="Case not found, or it is not released to your funder organisation." />
          <Button asChild variant="outline" size="sm">
            <Link to="/funder/p5-batch4">Back to released cases</Link>
          </Button>
        </div>
      ) : null}

      {summary ? (
        <div className="space-y-6" data-testid="p5b4-funder-case-detail">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Case summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Reference" value={summary.case_reference} />
              <Row label="Process" value={summary.process_type.replace(/_/g, " ")} />
              <Row
                label="Execution"
                valueNode={
                  <P5B4FunderStatusBadge
                    kind="execution"
                    value={summary.execution_status}
                  />
                }
              />
              <Row
                label="Readiness"
                valueNode={
                  <P5B4FunderStatusBadge
                    kind="readiness"
                    value={summary.readiness_status}
                  />
                }
              />
              <Row
                label="Current milestone"
                value={summary.current_milestone?.replace(/_/g, " ") ?? "—"}
              />
              <Row label="Pack reference" value={summary.pack_reference} />
              <Row
                label="Access expires"
                value={new Date(summary.access_expires_at).toLocaleString()}
              />
              <Row
                label="Download permitted"
                value={summary.download_allowed ? "Yes" : "No"}
              />
              <Row label="NDA required" value={summary.nda_required ? "Yes" : "No"} />
              <Row
                label="Release status"
                valueNode={
                  <P5B4FunderStatusBadge
                    kind="release"
                    value={summary.release_status}
                  />
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Record your decision</CardTitle>
            </CardHeader>
            <CardContent>
              <P5B4FunderDecisionForm
                releaseId={summary.release_id}
                currentStatus={summary.release_status}
                onRecorded={() => void load()}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </P5B4FunderShell>
  );
}

function Row({
  label,
  value,
  valueNode,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-muted-foreground w-44 shrink-0">{label}:</span>
      <span className="text-foreground">{valueNode ?? value}</span>
    </div>
  );
}
