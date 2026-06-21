/**
 * Batch 14B — Admin / compliance bank-verification review.
 * Routes:
 *   /admin/registry/bank-verification
 *   /admin/registry/bank-verification/:bankDetailSubmissionId
 *
 * This page is separate from Batch 13B BankDetailReview and only reads
 * the Batch 14 verification tables. It MUST NEVER render raw bank
 * account details. captured_unverified / manual_verified / provider_matched
 * are NEVER rendered as verified — only a final `verified` status with no
 * expiry/dispute/revocation gets the verified badge.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_BANK_VERIFICATION_DECISION_GATES,
  type RegistryBankVerificationStatus,
  type RegistryBankVerificationMode,
  type RegistryBankVerificationDecisionGate,
} from "@/lib/registry-bank-verification";
import {
  REGISTRY_BANK_VERIFICATION_UI_GATE_LABELS,
  REGISTRY_BANK_VERIFICATION_UI_MODE_LABEL,
  REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL,
  REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE,
  REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL,
  REGISTRY_BANK_VERIFICATION_UI_MANUAL_ACK_TEXT,
  REGISTRY_BANK_VERIFICATION_UI_RAW_BLOCKED_NOTICE,
  REGISTRY_BANK_VERIFICATION_UI_NO_LIVE_PROVIDER_NOTICE,
  REGISTRY_BANK_VERIFICATION_UI_EXPIRED_PAYMENT_NOTICE,
  REGISTRY_BANK_VERIFICATION_UI_DISPUTED_PAYMENT_NOTICE,
  REGISTRY_BANK_VERIFICATION_UI_REVOKED_PAYMENT_NOTICE,
  REGISTRY_BANK_VERIFICATION_UI_PAGE_SIZE,
  verificationBadgeFor,
  slaIndicatorFor,
  encodeCursor,
  decodeCursor,
  type GateDisplayRow,
  type VerificationQueueCursor,
} from "@/lib/registry-bank-verification-ui";
import { REGISTRY_BANK_VERIFICATION_MODES, REGISTRY_BANK_VERIFICATION_STATUSES } from "@/lib/registry-bank-verification";

type QueueRow = {
  id: string;
  submission_id: string;
  verification_status: string;
  verification_mode: string;
  country_code: string | null;
  expires_at: string | null;
  created_at: string;
  requested_role: string | null;
};

type SubmissionRow = {
  id: string;
  company_name: string;
  country_code: string;
  risk_level: string | null;
  b13_status: string | null;
  masked_account_holder: string | null;
  masked_bank_name: string | null;
  masked_account_number: string | null;
  masked_iban: string | null;
};

function VerificationBadges({
  status,
  expiresAt,
}: {
  status: RegistryBankVerificationStatus;
  expiresAt: string | null;
}) {
  const badge = verificationBadgeFor(status, { expiresAt });
  return (
    <span className="flex gap-1 items-center">
      <Badge variant="outline" data-testid="b14b-status-label">
        {REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL[status] ?? status}
      </Badge>
      <Badge
        variant={badge.tone === "verified" ? "default" : "secondary"}
        data-testid="b14b-verified-badge"
      >
        {badge.label}
      </Badge>
    </span>
  );
}

export function AdminBankVerificationQueue() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("registry_bank_detail_verification_requests")
        .select(
          "id, submission_id, verification_status, verification_mode, country_code, expires_at, created_at, requested_role",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      setRows((data ?? []) as QueueRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(
    () => (statusFilter ? rows.filter((r) => r.verification_status === statusFilter) : rows),
    [rows, statusFilter],
  );

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <BackButton fallback="/admin/registry" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Bank verification — review queue</h1>
        <p className="text-xs text-muted-foreground">
          Admin / compliance verification decision layer. {REGISTRY_BANK_VERIFICATION_UI_RAW_BLOCKED_NOTICE}
        </p>
      </header>

      <Alert>
        <AlertTitle>Provider integration</AlertTitle>
        <AlertDescription>{REGISTRY_BANK_VERIFICATION_UI_NO_LIVE_PROVIDER_NOTICE}</AlertDescription>
      </Alert>

      <div className="flex gap-2 items-center">
        <label className="text-xs">Status</label>
        <select
          className="border rounded text-xs px-2 py-1"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="b14b-queue-status-filter"
        >
          <option value="">All</option>
          {Object.keys(REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Verification requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">No verification requests visible.</p>
          )}
          <div className="space-y-2">
            {filtered.map((r) => {
              const status = r.verification_status as RegistryBankVerificationStatus;
              const mode = r.verification_mode as RegistryBankVerificationMode;
              return (
                <div
                  key={r.id}
                  className="flex justify-between items-center border-b py-2 text-xs"
                  data-testid="b14b-queue-row"
                >
                  <div className="space-y-1">
                    <div className="font-mono">{r.submission_id.slice(0, 8)}</div>
                    <VerificationBadges status={status} expiresAt={r.expires_at} />
                    <div className="text-muted-foreground">
                      {REGISTRY_BANK_VERIFICATION_UI_MODE_LABEL[mode] ?? mode} ·{" "}
                      {r.country_code ?? "—"} · age{" "}
                      {Math.max(
                        0,
                        Math.round(
                          (Date.now() - new Date(r.created_at).getTime()) / 86_400_000,
                        ),
                      )}
                      d
                    </div>
                  </div>
                  <Link to={`/admin/registry/bank-verification/${r.submission_id}`}>
                    <Button size="sm" variant="outline">
                      Open verification review
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GatesPanel({ gates }: { gates: GateDisplayRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Decision gates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        {gates.map((g) => (
          <div
            key={g.gate}
            className="flex justify-between border-b py-1"
            data-testid={`b14b-gate-${g.gate}`}
          >
            <span>{g.label}</span>
            <Badge
              variant={
                g.state === "passed"
                  ? "default"
                  : g.state === "failed"
                    ? "destructive"
                    : g.state === "warning"
                      ? "secondary"
                      : "outline"
              }
            >
              {g.state}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AdminBankVerificationReview() {
  const { bankDetailSubmissionId } = useParams();
  const [request, setRequest] = useState<QueueRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!bankDetailSubmissionId) return;
      setLoading(true);
      const { data: reqRow } = await supabase
        .from("registry_bank_detail_verification_requests")
        .select(
          "id, submission_id, verification_status, verification_mode, country_code, expires_at, created_at, requested_role, consent_ok, evidence_ok, risk_ok, duplicate_ok, country_supports_mode, blocking_gates, business_decision_id, cancelled_at, cancelled_reason",
        )
        .eq("submission_id", bankDetailSubmissionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setRequest((reqRow as unknown as QueueRow | null) ?? null);

      const { data: sub } = await supabase
        .from("registry_bank_detail_submissions")
        .select(
          "id, company_name, country_code, risk_level, b13_status, masked_account_holder, masked_bank_name, masked_account_number, masked_iban",
        )
        .eq("id", bankDetailSubmissionId)
        .maybeSingle();
      setSubmission((sub as SubmissionRow | null) ?? null);
      setLoading(false);
    })();
  }, [bankDetailSubmissionId]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!submission) {
    return (
      <div className="p-6 space-y-3">
        <BackButton fallback="/admin/registry/bank-verification" />
        <p className="text-sm">Submission not found.</p>
      </div>
    );
  }

  const status = (request?.verification_status ?? "not_started") as RegistryBankVerificationStatus;
  const mode = (request?.verification_mode ?? "not_available") as RegistryBankVerificationMode;
  const expiresAt = request?.expires_at ?? null;
  const expired = expiresAt && new Date(expiresAt).getTime() < Date.now();
  const isCancelled = !!(request as any)?.cancelled_at;

  const gates: GateDisplayRow[] = REGISTRY_BANK_VERIFICATION_DECISION_GATES.map((gate) => {
    const r = request as any;
    let state: GateDisplayRow["state"] = "not_applicable";
    if (r) {
      switch (gate) {
        case "submission_is_captured_unverified":
          state = submission.b13_status === "captured_unverified" ? "passed" : "failed";
          break;
        case "consent_includes_required_scopes":
          state = r.consent_ok ? "passed" : "failed";
          break;
        case "evidence_accepted":
          state = r.evidence_ok ? "passed" : "failed";
          break;
        case "risk_not_blocked":
          state = r.risk_ok ? "passed" : "failed";
          break;
        case "duplicate_resolved":
          state = r.duplicate_ok ? "passed" : "failed";
          break;
        case "country_supports_mode":
          state = r.country_supports_mode ? "passed" : "failed";
          break;
        case "business_decision_approved":
          state = r.business_decision_id ? "passed" : "warning";
          break;
        case "company_active":
          state = "passed";
          break;
        case "mode_is_eligible":
          state =
            mode === "manual_verification_allowed" || mode === "provider_live" ? "passed" : "failed";
          break;
        default:
          state = "not_applicable";
      }
    }
    return {
      gate: gate as RegistryBankVerificationDecisionGate,
      label: REGISTRY_BANK_VERIFICATION_UI_GATE_LABELS[gate],
      state,
    };
  });

  const allGatesPassed = gates.every((g) => g.state === "passed" || g.state === "not_applicable");
  const manualAllowed =
    mode === "manual_verification_allowed" && allGatesPassed && !expired && !isCancelled;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <BackButton fallback="/admin/registry/bank-verification" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Verification review</h1>
        <p className="text-xs text-muted-foreground">
          {submission.company_name} · {submission.country_code}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <VerificationBadges status={status} expiresAt={expiresAt} />
          <p className="text-muted-foreground">
            {REGISTRY_BANK_VERIFICATION_UI_PUBLIC_LABEL[status] ?? status}
          </p>
          {expired && (
            <Alert variant="destructive">
              <AlertTitle>Expired</AlertTitle>
              <AlertDescription>{REGISTRY_BANK_VERIFICATION_UI_EXPIRED_PAYMENT_NOTICE}</AlertDescription>
            </Alert>
          )}
          {status === "disputed" && (
            <Alert variant="destructive">
              <AlertTitle>Disputed</AlertTitle>
              <AlertDescription>{REGISTRY_BANK_VERIFICATION_UI_DISPUTED_PAYMENT_NOTICE}</AlertDescription>
            </Alert>
          )}
          {status === "revoked" && (
            <Alert variant="destructive">
              <AlertTitle>Revoked</AlertTitle>
              <AlertDescription>{REGISTRY_BANK_VERIFICATION_UI_REVOKED_PAYMENT_NOTICE}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Masked summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          <p>Holder: <span className="font-mono">{submission.masked_account_holder ?? "—"}</span></p>
          <p>Bank: <span className="font-mono">{submission.masked_bank_name ?? "—"}</span></p>
          <p>Account: <span className="font-mono">{submission.masked_account_number ?? "—"}</span></p>
          {submission.masked_iban && (
            <p>IBAN: <span className="font-mono">{submission.masked_iban}</span></p>
          )}
          <p className="text-muted-foreground">{REGISTRY_BANK_VERIFICATION_UI_RAW_BLOCKED_NOTICE}</p>
          <p className="text-muted-foreground">
            For raw access use the Batch 13B unmask flow (elevated, reasoned, audited) from the{" "}
            <Link to={`/admin/registry/bank-details/submissions/${submission.id}`} className="underline">
              bank-detail review page
            </Link>.
          </p>
        </CardContent>
      </Card>

      <GatesPanel gates={gates} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Manual verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {!manualAllowed ? (
            <Alert>
              <AlertTitle>Manual verification not available</AlertTitle>
              <AlertDescription data-testid="b14b-manual-disabled">
                Manual verification is disabled by default and is not currently allowed for this
                submission. Required gates or mode are not satisfied.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-muted-foreground">{REGISTRY_BANK_VERIFICATION_UI_MANUAL_ACK_TEXT}</p>
              <Button size="sm" variant="outline" disabled data-testid="b14b-manual-action">
                Record manual decision (compliance owner)
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Action requires acknowledgement, reason, evidence basis, expiry and the compliance_owner
                role. Wiring is gated by the accepted Batch 14 backend.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Provider simulation (test only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <Badge variant="secondary" data-testid="b14b-sim-label">
            {REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL}
          </Badge>
          <p className="text-muted-foreground">
            Simulation results do not produce a verified status. Promotion requires the accepted
            Batch 14 decision gate.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Expiry &amp; reverification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          <p>
            Expires at: <span className="font-mono">{expiresAt ?? "—"}</span>
          </p>
          <p>
            Days until expiry:{" "}
            {expiresAt
              ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
              : "—"}
          </p>
          <Badge variant="outline">{REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
