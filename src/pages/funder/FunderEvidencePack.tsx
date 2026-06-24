/**
 * FunderEvidencePack — P-5 Batch 1 Stage 5
 *
 * Funder / external reviewer read-only view. Shows only the approved
 * evidence-pack summary plus permitted readiness fields. Never shows draft
 * or rejected evidence, internal reviewer notes, raw provider payloads,
 * internal risk commentary, AI reasoning or raw personal/bank data.
 *
 * No action buttons — funders have no P-5 mutation rights in Batch 1.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { P5ReadinessCard } from "@/components/p5-governance";
import { fetchP5ReadinessSummary } from "@/lib/p5-governance/summary-client";
import type { P5ReadinessSummary } from "@/lib/p5-governance/summary-types";
import { useP5Permissions } from "@/hooks/useP5Permissions";

export default function FunderEvidencePack() {
  const [search] = useSearchParams();
  const caseId = search.get("case_id") ?? "";
  const perms = useP5Permissions();
  const [summary, setSummary] = useState<P5ReadinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(caseId));

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchP5ReadinessSummary({ case_id: caseId })
      .then((r) => {
        if (!cancelled) setSummary(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e?.message ?? "Failed to load evidence pack");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (!perms.canViewFunderEvidencePack) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <BackButton />
        <Alert>
          <AlertTitle>Not available</AlertTitle>
          <AlertDescription>This view is not available for your role.</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4" data-testid="funder-evidence-pack">
      <BackButton />
      <header>
        <h1 className="text-2xl font-semibold">Evidence pack</h1>
        <p className="text-sm text-muted-foreground">
          Read-only summary of the approved evidence pack and the permitted
          readiness position. Draft, rejected and internal review material is
          not included.
        </p>
      </header>

      {!caseId && (
        <Card>
          <CardHeader><CardTitle className="text-base">No case selected</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Open this page with <code>?case_id=…</code>.
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {error && (
        <Alert variant="destructive" data-testid="funder-evidence-pack-error">
          <AlertTitle>Could not load evidence pack</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {summary && (
        <>
          <P5ReadinessCard summary={summary} viewer="funder" subjectLabel="Evidence pack" />
          <Card data-testid="funder-evidence-pack-refs">
            <CardHeader><CardTitle className="text-base">References</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1 text-muted-foreground">
              {summary.evidence_pack_id && <div>Evidence pack ID: {summary.evidence_pack_id}</div>}
              {summary.evidence_summary_id && <div>Evidence summary ID: {summary.evidence_summary_id}</div>}
              {summary.audit_reference && <div>Audit reference: {summary.audit_reference}</div>}
              {summary.last_updated_at && (
                <div>Last updated: {summary.last_updated_at.slice(0, 10)}</div>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground" data-testid="funder-readonly-note">
            This view is read-only. No funder approval is recorded from this page.
          </p>
        </>
      )}
    </main>
  );
}
