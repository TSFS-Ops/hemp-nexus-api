/**
 * Batch 13B — Admin / compliance bank-detail review queue + detail.
 * Routes:
 *   /admin/registry/bank-details/queue
 *   /admin/registry/bank-details/submissions/:bankDetailSubmissionId
 *
 * Admin actions on the detail view: start review, request more evidence
 * (reason required), accept as captured_unverified (acknowledgement + not
 * blocked-risk required), reject (reason required), unmask access
 * (elevated, reasoned, audited). Captured/unverified is never treated as verified.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT,
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  type RegistryBankDetailB13SubmissionStatus,
} from "@/lib/registry-bank-details-b13";
import {
  REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE,
  REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL,
  REGISTRY_BANK_DETAIL_B13_UI_RISK_LABEL,
  REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE,
} from "@/lib/registry-bank-details-b13-ui";

type QueueRow = {
  id: string;
  b13_status: RegistryBankDetailB13SubmissionStatus | null;
  company_name: string;
  country_code: string;
  risk_level: string | null;
  is_third_party: boolean | null;
  created_at: string;
};

type DetailRow = QueueRow & {
  masked_account_holder: string | null;
  masked_bank_name: string | null;
  masked_account_number: string | null;
  masked_iban: string | null;
  rejection_reason: string | null;
};

type RiskFlag = { id: string; flag_type: string; risk_level: string };

function StatusBadges({ s, risk }: { s: RegistryBankDetailB13SubmissionStatus | null; risk: string | null }) {
  const status = (s ?? "submitted") as RegistryBankDetailB13SubmissionStatus;
  return (
    <span className="flex gap-1 items-center">
      <Badge variant="outline">{REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL[status] ?? status}</Badge>
      <Badge variant="secondary">{REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE}</Badge>
      {risk && <Badge variant={risk === "blocked" ? "destructive" : "outline"}>{REGISTRY_BANK_DETAIL_B13_UI_RISK_LABEL[risk] ?? risk}</Badge>}
    </span>
  );
}

export function AdminBankDetailQueue() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("registry_bank_detail_submissions")
        .select("id, b13_status, company_name, country_code, risk_level, is_third_party, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      setRows((data ?? []) as QueueRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <BackButton fallback="/hq" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Bank-detail submission queue</h1>
        <p className="text-xs text-muted-foreground">{REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY}</p>
      </header>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No submissions.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Company</th>
                  <th className="text-left p-2">Country</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">3rd party</th>
                  <th className="text-left p-2">Submitted</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.company_name}</td>
                    <td className="p-2">{r.country_code}</td>
                    <td className="p-2"><StatusBadges s={r.b13_status} risk={r.risk_level} /></td>
                    <td className="p-2">{r.is_third_party ? "Yes" : "No"}</td>
                    <td className="p-2">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="p-2 text-right">
                      <Link
                        className="text-primary underline"
                        to={`/admin/registry/bank-details/submissions/${r.id}`}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminBankDetailReview() {
  const { bankDetailSubmissionId } = useParams();
  const [row, setRow] = useState<DetailRow | null>(null);
  const [riskFlags, setRiskFlags] = useState<RiskFlag[]>([]);
  const [loading, setLoading] = useState(true);

  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const [unmaskReason, setUnmaskReason] = useState("");
  const [unmasked, setUnmasked] = useState<Record<string, string> | null>(null);

  const reload = async () => {
    if (!bankDetailSubmissionId) return;
    setLoading(true);
    const { data } = await supabase
      .from("registry_bank_detail_submissions")
      .select(
        "id, b13_status, company_name, country_code, risk_level, is_third_party, created_at, masked_account_holder, masked_bank_name, masked_account_number, masked_iban, rejection_reason",
      )
      .eq("id", bankDetailSubmissionId)
      .maybeSingle();
    setRow((data as DetailRow | null) ?? null);
    const { data: flags } = await supabase
      .from("registry_bank_detail_risk_flags")
      .select("id, flag_type, risk_level")
      .eq("submission_id", bankDetailSubmissionId);
    setRiskFlags((flags ?? []) as RiskFlag[]);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankDetailSubmissionId]);

  const blocked = row?.risk_level === "blocked";

  const callReview = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!bankDetailSubmissionId) return;
    if (action !== "assign_reviewer" && reason.trim().length < 5) {
      toast.error("Reason required (min 5 chars).");
      return;
    }
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("registry-bank-detail-review", {
        body: { submission_id: bankDetailSubmissionId, action, reason, ...extra },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "review_failed");
      toast.success(`Action ${action} recorded.`);
      setReason("");
      setAck(false);
      await reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Action failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const callUnmask = async () => {
    if (!bankDetailSubmissionId) return;
    if (unmaskReason.trim().length < 20) {
      toast.error("Unmask reason must be at least 20 characters.");
      return;
    }
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("registry-bank-detail-unmask-access", {
        body: { submission_id: bankDetailSubmissionId, reason: unmaskReason },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; unmasked?: Record<string, string>; error?: string };
      if (!res.ok) throw new Error(res.error ?? "unmask_failed");
      setUnmasked(res.unmasked ?? {});
      toast.success("Unmask request audited.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Unmask failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const acceptEnabled = useMemo(() => ack && !blocked && reason.trim().length >= 5 && !busy, [ack, blocked, reason, busy]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!row) return <div className="p-6 text-sm">Not found.</div>;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <BackButton fallback="/admin/registry/bank-details/queue" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Review bank-detail submission</h1>
        <p className="text-xs text-muted-foreground">{row.company_name} · {row.country_code}</p>
        <StatusBadges s={row.b13_status} risk={row.risk_level} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Masked summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          <p>Holder: <span className="font-mono">{row.masked_account_holder ?? "—"}</span></p>
          <p>Bank: <span className="font-mono">{row.masked_bank_name ?? "—"}</span></p>
          <p>Account: <span className="font-mono">{row.masked_account_number ?? "—"}</span></p>
          {row.masked_iban && <p>IBAN: <span className="font-mono">{row.masked_iban}</span></p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Risk flags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {riskFlags.length === 0 && <p className="text-muted-foreground">No risk flags.</p>}
          {riskFlags.map((f) => (
            <div key={f.id} className="flex justify-between border-b py-1">
              <span>{f.flag_type}</span>
              <Badge variant={f.risk_level === "blocked" ? "destructive" : "outline"}>
                {REGISTRY_BANK_DETAIL_B13_UI_RISK_LABEL[f.risk_level] ?? f.risk_level}
              </Badge>
            </div>
          ))}
          {row.risk_level === "high" && (
            <Alert>
              <AlertTitle>High risk</AlertTitle>
              <AlertDescription>Compliance review is required before acceptance.</AlertDescription>
            </Alert>
          )}
          {blocked && (
            <Alert variant="destructive">
              <AlertTitle>Blocked</AlertTitle>
              <AlertDescription>Acceptance as captured/unverified is disabled while this submission is blocked.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Review actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs">Reason (required for every action except assign)</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason…" data-testid="bd-reason" />
          </div>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={ack} onCheckedChange={(c) => setAck(c === true)} data-testid="bd-ack" />
            <span>{REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => callReview("start_review")}>Start review</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => callReview("request_more_evidence")}>Request more evidence</Button>
            <Button
              size="sm"
              disabled={!acceptEnabled}
              data-testid="bd-accept"
              onClick={() => callReview("accept_captured_unverified", { acknowledged: true })}
            >
              Accept as captured/unverified
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => callReview("reject_submission")}>Reject</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Unmask access (elevated)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertTitle>Elevated</AlertTitle>
            <AlertDescription className="text-xs">{REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE}</AlertDescription>
          </Alert>
          <Textarea
            value={unmaskReason}
            onChange={(e) => setUnmaskReason(e.target.value)}
            placeholder="Reason (≥20 chars)…"
            data-testid="bd-unmask-reason"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || unmaskReason.trim().length < 20}
            onClick={callUnmask}
            data-testid="bd-unmask"
          >
            Request unmask access
          </Button>
          {unmasked && (
            <div className="border rounded p-2 text-xs font-mono space-y-1 bg-amber-50">
              <p className="text-amber-800">Unmasked (temporary view, audited):</p>
              {Object.entries(unmasked).map(([k, v]) => (
                <div key={k}>{k}: {v}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminBankDetailReview;
