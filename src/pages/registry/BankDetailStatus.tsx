/**
 * Batch 13B — User-facing bank-detail status page.
 * Route: /registry/bank-details/:bankDetailSubmissionId
 *
 * Renders ONLY masked summary, status, evidence checklist, consent record,
 * more-evidence requests and safe rejection reason. Raw account fields are
 * NEVER fetched or rendered here. captured_unverified is shown as
 * "Captured but not verified" — never as "verified".
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE,
  type RegistryBankDetailB13SubmissionStatus,
} from "@/lib/registry-bank-details-b13";
import {
  REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE,
  REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL,
  REGISTRY_BANK_DETAIL_B13_UI_RAW_BLOCKED_NOTICE,
} from "@/lib/registry-bank-details-b13-ui";

type Row = {
  id: string;
  b13_status: RegistryBankDetailB13SubmissionStatus | null;
  status: string;
  company_name: string;
  country_code: string;
  masked_account_holder: string | null;
  masked_bank_name: string | null;
  masked_account_number: string | null;
  masked_iban: string | null;
  rejection_reason: string | null;
  more_evidence_due_at: string | null;
  captured_unverified_at: string | null;
};

type EvidenceRow = {
  id: string;
  category: string | null;
  evidence_category: string | null;
  state: string | null;
  evidence_state: string | null;
};

export default function BankDetailStatus() {
  const { bankDetailSubmissionId } = useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!bankDetailSubmissionId) return;
      setLoading(true);
      const { data } = await supabase
        .from("registry_bank_detail_submissions")
        .select(
          "id, b13_status, status, company_name, country_code, masked_account_holder, masked_bank_name, masked_account_number, masked_iban, rejection_reason, more_evidence_due_at, captured_unverified_at",
        )
        .eq("id", bankDetailSubmissionId)
        .maybeSingle();
      setRow((data as Row | null) ?? null);

      const { data: ev } = await supabase
        .from("registry_bank_detail_evidence")
        .select("id, evidence_category, evidence_state")
        .eq("submission_id", bankDetailSubmissionId);
      setEvidence(((ev ?? []) as EvidenceRow[]) ?? []);
      setLoading(false);
    })();
  }, [bankDetailSubmissionId]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!row) {
    return (
      <div className="p-6 space-y-3">
        <BackButton fallback="/registry" />
        <p className="text-sm">Submission not found.</p>
      </div>
    );
  }

  const b13 = (row.b13_status ?? "submitted") as RegistryBankDetailB13SubmissionStatus;
  const label = REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL[b13] ?? b13;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <BackButton fallback="/registry" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Bank-detail submission</h1>
        <p className="text-xs text-muted-foreground">{row.company_name} · {row.country_code}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2 items-center">
            <Badge variant="outline" data-testid="bd-status-label">{label}</Badge>
            <Badge variant="secondary">{REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY}</p>
          {b13 === "captured_unverified" && (
            <Alert>
              <AlertTitle>Captured</AlertTitle>
              <AlertDescription>{REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE}</AlertDescription>
            </Alert>
          )}
          {row.rejection_reason && (b13 === "rejected") && (
            <Alert variant="destructive">
              <AlertTitle>Rejected</AlertTitle>
              <AlertDescription className="text-xs">{row.rejection_reason}</AlertDescription>
            </Alert>
          )}
          {row.more_evidence_due_at && b13 === "more_evidence_requested" && (
            <p className="text-xs text-amber-700">More evidence due by {new Date(row.more_evidence_due_at).toLocaleString()}.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Masked summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          <p>Account holder: <span className="font-mono">{row.masked_account_holder ?? "—"}</span></p>
          <p>Bank: <span className="font-mono">{row.masked_bank_name ?? "—"}</span></p>
          <p>Account number: <span className="font-mono">{row.masked_account_number ?? "—"}</span></p>
          {row.masked_iban && <p>IBAN: <span className="font-mono">{row.masked_iban}</span></p>}
          <p className="text-muted-foreground">{REGISTRY_BANK_DETAIL_B13_UI_RAW_BLOCKED_NOTICE}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {evidence.length === 0 && <p className="text-muted-foreground">No evidence on file.</p>}
          {evidence.map((e) => (
            <div key={e.id} className="flex justify-between border-b py-1">
              <span>{e.evidence_category ?? e.category ?? "evidence"}</span>
              <Badge variant="outline">{e.evidence_state ?? e.state ?? "pending"}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
