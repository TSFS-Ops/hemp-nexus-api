/**
 * Customer Compliance Area — case detail.
 *
 * Renders only customer-safe information: outstanding actions, RFI inbox,
 * upload forms, final outcome, conditions, customer-visible timeline,
 * disclosure history, appeal submission.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AdapterModeBanner,
  CWStatusBadge,
} from "@/components/compliance-workbench";
import {
  COMPLIANCE_SENDER_NAME,
  complianceMutations,
  getCaseDetail,
  type CaseDetail,
} from "@/lib/compliance-workbench";
import { formatDate, formatDateTime } from "@/lib/funder-workspace/ui/labels";
import { AlertTriangle, ArrowLeft, Upload, Info, MessageSquare } from "lucide-react";

export default function DeskComplianceCaseDetail() {
  const { reference = "" } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    getCaseDetail(reference)
      .then((v) => alive && setD(v))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [reference]);

  if (error) return (
    <div className="mx-auto max-w-4xl p-6" role="alert">
      <Card className="p-6">
        <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
        <div className="font-medium">Cannot load your case</div>
        <div className="text-sm text-muted-foreground">{error}</div>
      </Card>
    </div>
  );

  if (!d) return (
    <div className="mx-auto max-w-4xl space-y-3 p-6">
      <Skeleton className="h-24" />
      <Skeleton className="h-48" />
    </div>
  );

  const outstandingEvidence = d.evidence.filter(
    (e) => e.state === "required" || e.state === "missing" || e.state === "rejected" || e.state === "replacement_requested" || e.state === "expired",
  );
  const openRfis = d.rfis.filter((r) => !r.closedAt);
  const latestDecision = d.decisions.at(-1);

  const uploadDoc = async (requirementKey: string) => {
    setUploading(requirementKey);
    const res = await complianceMutations.uploadEvidence(reference, requirementKey);
    setUploading(null);
    if (!res.ok) {
      toast.error(res.message ?? "Not available yet");
    } else {
      toast.success("Uploaded to compliance review");
    }
  };

  const sendReply = async (rfiId: string, itemId: string) => {
    const body = reply[itemId]?.trim();
    if (!body) return;
    const res = await complianceMutations.respondToRfi(rfiId, itemId, body);
    if (!res.ok) toast.error(res.message ?? "Not available yet");
    else {
      toast.success("Response sent");
      setReply((p) => ({ ...p, [itemId]: "" }));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
      </Button>

      <Card className="p-4 md:p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Compliance review</div>
        <h1 className="mt-1 font-mono text-lg font-semibold md:text-xl">{d.summary.reference}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CWStatusBadge kind="case_status" value={d.summary.status} />
          {d.summary.hasActiveHold && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">Review in progress</span>}
        </div>
      </Card>

      <AdapterModeBanner />

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="text-sm font-semibold">Outstanding actions</h2>
        {outstandingEvidence.length === 0 && openRfis.length === 0 ? (
          <Card className="mt-2 p-4 text-sm text-muted-foreground">Nothing required from you right now.</Card>
        ) : (
          <div className="mt-2 space-y-2">
            {outstandingEvidence.map((ev) => (
              <Card key={ev.id} className="p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">{ev.requirementLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {ev.state === "rejected"
                        ? "Previously uploaded document was not accepted"
                        : ev.state === "expired"
                        ? "Previously uploaded document has expired"
                        : "Not yet provided"}
                      {ev.rejectionReason ? ` · ${ev.rejectionReason}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => uploadDoc(ev.requirementKey)}
                    disabled={uploading === ev.requirementKey}
                  >
                    <Upload className="mr-1 h-3.5 w-3.5" />
                    {uploading === ev.requirementKey ? "Uploading…" : "Upload"}
                  </Button>
                </div>
              </Card>
            ))}
            {openRfis.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="text-xs text-muted-foreground">
                  Response due {formatDate(r.dueAt)}
                </div>
                <ul className="mt-2 space-y-3">
                  {r.items.map((it) => (
                    <li key={it.id} className="rounded border border-border p-3">
                      <div className="text-sm">{it.customerSafeText}</div>
                      <div className="mt-2 space-y-2">
                        <Label htmlFor={`reply-${it.id}`} className="text-xs text-muted-foreground">
                          Your response
                        </Label>
                        <Textarea
                          id={`reply-${it.id}`}
                          value={reply[it.id] ?? ""}
                          onChange={(e) => setReply((p) => ({ ...p, [it.id]: e.target.value }))}
                          placeholder="Type your response…"
                          rows={3}
                        />
                        <Button size="sm" onClick={() => sendReply(r.id, it.id)} disabled={!reply[it.id]?.trim()}>
                          Send response
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="messages-heading">
        <h2 id="messages-heading" className="text-sm font-semibold">Messages from {COMPLIANCE_SENDER_NAME}</h2>
        {d.customerMessages.length === 0 ? (
          <Card className="mt-2 p-4 text-sm text-muted-foreground">No messages.</Card>
        ) : (
          <div className="mt-2 space-y-2">
            {d.customerMessages.map((m) => (
              <Card key={m.id} className="p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {COMPLIANCE_SENDER_NAME} · {formatDateTime(m.createdAt)}
                </div>
                <div className="mt-1 text-sm">{m.body}</div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {latestDecision && (
        <section aria-labelledby="outcome-heading">
          <h2 id="outcome-heading" className="text-sm font-semibold">Outcome</h2>
          <Card className="mt-2 p-4">
            <CWStatusBadge kind="decision" value={latestDecision.outcome} />
            <p className="mt-2 text-sm">{latestDecision.rationaleCustomerSafe}</p>
            {latestDecision.conditions.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-muted-foreground">Conditions</div>
                <ul className="mt-1 list-inside list-disc text-sm">
                  {latestDecision.conditions.map((c) => (
                    <li key={c.id}>{c.label} — due {formatDate(c.dueAt)}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </section>
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-sm font-semibold">History</h2>
        <Card className="mt-2 divide-y divide-border">
          {d.timeline.filter((e) => e.customerVisible).map((e) => (
            <div key={e.id} className="flex justify-between p-3 text-sm">
              <span>{e.summary}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
            </div>
          ))}
          {d.timeline.filter((e) => e.customerVisible).length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Nothing to show yet.</div>
          )}
        </Card>
      </section>

      <section aria-labelledby="disclosure-heading">
        <h2 id="disclosure-heading" className="text-sm font-semibold">Funder disclosures</h2>
        <Card className="mt-2 p-4 text-sm">
          {d.appeals.length === 0 && (
            <p className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4" />
              No approved disclosures have been shared with a funder from this case.
            </p>
          )}
        </Card>
      </section>

      {latestDecision && ["rejected", "blocked", "suspended", "conditionally_approved"].includes(latestDecision.outcome) && (
        <section aria-labelledby="appeal-heading">
          <h2 id="appeal-heading" className="text-sm font-semibold">Appeal</h2>
          <Card className="mt-2 space-y-2 p-4">
            <p className="text-xs text-muted-foreground">
              You may appeal within 10 business days of this decision if you have new material
              evidence or believe there was an error.
            </p>
            <AppealForm caseReference={reference} />
          </Card>
        </section>
      )}
    </div>
  );
}

function AppealForm({ caseReference }: { caseReference: string }) {
  const [body, setBody] = useState("");
  const [basis, setBasis] = useState("new_evidence");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    const res = await complianceMutations.submitAppeal(caseReference, basis, body);
    setSubmitting(false);
    if (!res.ok) toast.error(res.message ?? "Not available yet");
    else {
      toast.success("Appeal submitted");
      setBody("");
    }
  };
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">Basis for appeal</Label>
        <select
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="new_evidence">I have new material evidence</option>
          <option value="platform_error">There was an error in how my case was handled</option>
          <option value="provider_error">There was an error in a third-party check</option>
        </select>
      </div>
      <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the reason for your appeal…" />
      <Input type="file" aria-label="Supporting document" />
      <Button size="sm" onClick={submit} disabled={submitting || !body.trim()}>
        {submitting ? "Submitting…" : "Submit appeal"}
      </Button>
    </div>
  );
}
