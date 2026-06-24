/**
 * MyCompanyReadiness — P-5 Batch 1 Stage 5
 *
 * Customer / entity-owner readiness view. Consumes only the scoped
 * `p5-governance-readiness-summary` edge function — never reads
 * `p5_governance_*` tables directly.
 *
 * Visible: simple readiness badge, missing items count, next action, due
 * dates, provider dependency in neutral wording, last updated date.
 *
 * Hidden: internal reviewer notes, internal risk scores, legal comments,
 * raw provider responses, provider credentials, compliance analysis,
 * reviewer debate, internal escalation notes, funder-only views, other
 * customers' cases, raw bank-account detail fields.
 */
import { useEffect, useState } from "react";
import { useSearchParams, useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { P5ReadinessCard } from "@/components/p5-governance";
import { fetchP5ReadinessSummary } from "@/lib/p5-governance/summary-client";
import type { P5ReadinessSummary } from "@/lib/p5-governance/summary-types";
import { useP5Permissions } from "@/hooks/useP5Permissions";

export default function MyCompanyReadiness() {
  const params = useParams<{ companyId?: string }>();
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
        if (!cancelled) setError(e?.message ?? "Failed to load readiness");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (!perms.canViewCustomerReadiness) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <BackButton />
        <Alert>
          <AlertTitle>Not available</AlertTitle>
          <AlertDescription>This readiness view is not available for your role.</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4" data-testid="my-company-readiness">
      <BackButton />
      <header>
        <h1 className="text-2xl font-semibold">My readiness</h1>
        <p className="text-sm text-muted-foreground">
          Plain-language view of what is still needed on your side. This page
          does not show internal reviewer notes, raw provider responses or
          other customers' information.
        </p>
      </header>

      {!caseId && (
        <Card>
          <CardHeader><CardTitle className="text-base">No readiness case selected</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Open this page from a company or transaction record with
            <code className="mx-1">?case_id=…</code>.
            {params.companyId && (
              <div className="mt-2">
                Return to{" "}
                <Link className="underline" to={`/registry/my-companies/${params.companyId}`}>
                  the company page
                </Link>
                .
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {error && (
        <Alert variant="destructive" data-testid="my-company-readiness-error">
          <AlertTitle>Could not load readiness</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {summary && (
        <>
          <P5ReadinessCard summary={summary} viewer="customer" subjectLabel="Your record" />
          <Card data-testid="my-company-readiness-actions">
            <CardHeader><CardTitle className="text-base">What you can do now</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>
                Required items outstanding:{" "}
                <span className="font-medium">{summary.required_items_missing}</span>
              </p>
              {perms.canSubmitCustomerEvidence && summary.required_items_missing > 0 && params.companyId && (
                <p>
                  <Link
                    className="underline"
                    to={`/registry/my-companies/${params.companyId}/evidence`}
                  >
                    Upload or replace evidence
                  </Link>
                </p>
              )}
              {summary.provider_dependency && (
                <p className="text-muted-foreground">
                  Some checks rely on an external provider. We will update
                  this page when the provider responds. No action is required
                  from you for those items.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
