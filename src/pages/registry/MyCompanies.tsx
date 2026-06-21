/**
 * Batch 16 — My Companies dashboard.
 *
 * Lists every company the logged-in user has a relationship with
 * (via claim, authority or bank-detail submission). Renders only
 * safe portal labels from the SSOT. Never shows raw bank fields,
 * raw provider payloads or other users' evidence.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import {
  PORTAL_CLAIM_LABEL,
  PORTAL_AUTHORITY_LABEL,
  PORTAL_BANK_DETAIL_LABEL,
  PORTAL_BLOCKED_LABEL,
  PORTAL_NEXT_STEP_LABEL,
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

export default function MyCompanies() {
  const [rows, setRows] = useState<PortalCompanyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-my-companies", { body: {} });
        if (error) throw error;
        setRows((data?.companies ?? []) as PortalCompanyRow[]);
      } catch (e) {
        setError((e as Error).message);
        setRows([]);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <BackButton fallback="/registry" />
      <header>
        <h1 className="text-xl font-semibold">My companies</h1>
        <p className="text-xs text-muted-foreground">
          All companies you have claimed or are authorised to act for.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {!rows && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {rows && rows.length === 0 && (
        <Alert>
          <AlertTitle>No companies yet</AlertTitle>
          <AlertDescription className="text-xs">
            {PORTAL_BLOCKED_LABEL.no_companies}{" "}
            <Link to="/registry/search" className="underline">
              Search the registry
            </Link>{" "}
            to start a claim.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {(rows ?? []).map((c) => {
          const next = computeNextStep({
            claim: c.claim_status,
            authority: c.authority_status,
            bankDetail: c.bank_detail_status,
            verification: c.verification_status,
            hasOpenEvidenceRequest: c.open_evidence_requests > 0,
            hasOpenDispute: c.open_disputes > 0,
            hasOpenCorrectionForUser: c.open_corrections > 0,
          });
          const verLabel = safeVerificationLabel(c.verification_status);
          return (
            <Card key={`${c.company_reference}|${c.country_code}`} data-testid="my-companies-row">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex justify-between items-center">
                  <Link
                    to={`/registry/my-companies/${encodeURIComponent(c.company_id ?? c.company_reference)}`}
                    className="underline"
                  >
                    {c.company_name}
                  </Link>
                  <span className="text-xs text-muted-foreground font-normal">
                    {c.country_code}
                    {c.registration_number ? ` · ${c.registration_number}` : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{c.lifecycle_label}</Badge>
                  <Badge variant="secondary">{PORTAL_CLAIM_LABEL[c.claim_status]}</Badge>
                  <Badge variant="secondary">{PORTAL_AUTHORITY_LABEL[c.authority_status]}</Badge>
                  <Badge variant="secondary">{PORTAL_BANK_DETAIL_LABEL[c.bank_detail_status]}</Badge>
                  <Badge variant="secondary" data-testid="ver-label">{verLabel}</Badge>
                </div>
                <div className="text-muted-foreground flex gap-4">
                  <span>Evidence requests: {c.open_evidence_requests}</span>
                  <span>Corrections: {c.open_corrections}</span>
                  <span>Disputes: {c.open_disputes}</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center">
                  <span>
                    <strong>Next:</strong> {PORTAL_NEXT_STEP_LABEL[next]}
                  </span>
                  {c.last_updated_at && (
                    <span className="text-muted-foreground">
                      Updated {new Date(c.last_updated_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
