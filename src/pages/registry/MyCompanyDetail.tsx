/**
 * Batch 16 — Company detail command centre.
 *
 * Aggregates claim, authority, bank-detail, verification, evidence,
 * correction, dispute and timeline cards for one company. Each card
 * deep-links into the accepted Batch 11/12/13/14 sub-pages. Renders
 * only safe portal labels from the SSOT; never raw bank fields, raw
 * provider payloads or admin-only notes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import {
  PORTAL_CLAIM_LABEL,
  PORTAL_AUTHORITY_LABEL,
  PORTAL_BANK_DETAIL_LABEL,
  PORTAL_NEXT_STEP_LABEL,
  PORTAL_BLOCKED_LABEL,
  PORTAL_TIMELINE_EVENT_LABEL,
  filterSafeTimeline,
  computeNextStep,
  safeVerificationLabel,
  type PortalAuthorityStatus,
  type PortalBankDetailStatus,
  type PortalClaimStatus,
  type PortalVerificationStatus,
} from "@/lib/registry-company-portal-ssot";

interface PortalCompanyRow {
  company_id: string | null;
  company_reference: string;
  company_name: string;
  country_code: string;
  registration_number: string | null;
  lifecycle_label: string;
  claim_status: PortalClaimStatus;
  authority_status: PortalAuthorityStatus;
  bank_detail_status: PortalBankDetailStatus;
  verification_status: PortalVerificationStatus;
  open_evidence_requests: number;
  open_corrections: number;
  open_disputes: number;
  last_updated_at: string | null;
}

interface TimelineEvent {
  event_name: string;
  created_at: string;
}

export default function MyCompanyDetail() {
  const { companyId } = useParams();
  const [row, setRow] = useState<PortalCompanyRow | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.functions.invoke("registry-my-companies", { body: {} });
        if (error) throw error;
        const list: PortalCompanyRow[] = data?.companies ?? [];
        const match = list.find(
          (c) => c.company_id === companyId || c.company_reference === companyId,
        );
        setRow(match ?? null);

        if (match?.company_id) {
          // Safe timeline source: this user's own claim event audit names.
          const { data: ev } = await supabase
            .from("registry_company_claim_events")
            .select("audit_event_name, created_at")
            .eq("claim_id", match.company_id)
            .order("created_at", { ascending: false })
            .limit(50);
          const mapped: TimelineEvent[] = ((ev as Array<{ audit_event_name: string; created_at: string }>) ?? []).map(
            (e) => ({ event_name: e.audit_event_name.replace(/^registry_/, ""), created_at: e.created_at }),
          );
          setTimeline(filterSafeTimeline(mapped));
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  const nextStep = useMemo(() => {
    if (!row) return "none" as const;
    return computeNextStep({
      claim: row.claim_status,
      authority: row.authority_status,
      bankDetail: row.bank_detail_status,
      verification: row.verification_status,
      hasOpenEvidenceRequest: row.open_evidence_requests > 0,
      hasOpenDispute: row.open_disputes > 0,
      hasOpenCorrectionForUser: row.open_corrections > 0,
    });
  }, [row]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6 space-y-3">
        <BackButton fallback="/registry/my-companies" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="mx-auto max-w-4xl p-6 space-y-3">
        <BackButton fallback="/registry/my-companies" />
        <Alert>
          <AlertTitle>Company not available</AlertTitle>
          <AlertDescription className="text-xs">
            {error ?? "You may not be authorised to view this company, or it has not yet been imported."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const verLabel = safeVerificationLabel(row.verification_status);
  const base = `/registry/my-companies/${encodeURIComponent(companyId ?? "")}`;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-5">
      <BackButton fallback="/registry/my-companies" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{row.company_name}</h1>
        <p className="text-xs text-muted-foreground">
          {row.country_code}
          {row.registration_number ? ` · ${row.registration_number}` : ""} ·{" "}
          {row.lifecycle_label}
        </p>
      </header>

      <Alert>
        <AlertTitle>Next step</AlertTitle>
        <AlertDescription className="text-xs">{PORTAL_NEXT_STEP_LABEL[nextStep]}</AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Claim</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            <Badge variant="secondary">{PORTAL_CLAIM_LABEL[row.claim_status]}</Badge>
            <div><Link className="underline" to={`${base}/claim`}>Open claim →</Link></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Authority-to-act</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            <Badge variant="secondary">{PORTAL_AUTHORITY_LABEL[row.authority_status]}</Badge>
            <div><Link className="underline" to={`${base}/authority`}>Open authority →</Link></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Bank details</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            <Badge variant="secondary">{PORTAL_BANK_DETAIL_LABEL[row.bank_detail_status]}</Badge>
            <div><Link className="underline" to={`${base}/bank-details`}>Open bank details →</Link></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Verification</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            <Badge variant="secondary" data-testid="ver-label">{verLabel}</Badge>
            <div><Link className="underline" to={`${base}/verification`}>Open verification →</Link></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Evidence</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            <div>{row.open_evidence_requests} open request(s)</div>
            <div><Link className="underline" to={`${base}/evidence`}>Open evidence centre →</Link></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Corrections & disputes</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            <div>{row.open_corrections} correction(s) · {row.open_disputes} dispute(s)</div>
            <div className="flex gap-3">
              <Link className="underline" to={`${base}/corrections`}>Corrections</Link>
              <Link className="underline" to={`${base}/disputes`}>Disputes</Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Timeline</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {timeline.length === 0 && (
            <p className="text-muted-foreground">{PORTAL_BLOCKED_LABEL.review_pending}</p>
          )}
          {timeline.map((e, i) => (
            <div key={i} className="flex justify-between border-b py-1">
              <span>{PORTAL_TIMELINE_EVENT_LABEL[e.event_name] ?? e.event_name}</span>
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
