/**
 * Facilitation Outreach drawer tab.
 *
 * Operator surface for managing outreach candidates on a facilitation case.
 * All gating decisions are made server-side; this tab only renders the
 * results and offers the lifecycle controls each role is allowed to use.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useOutreachRoles } from "./useOutreachRoles";
import {
  outreachStateLabel,
  GATE_RESULT_LABEL,
  gateReasonLabel,
  SEND_STATUS_LABEL,
  ESCALATION_STATUS_LABEL,
  friendlyFacilitationError,
} from "@/lib/facilitation-labels";

type Candidate = {
  id: string;
  facilitation_case_id: string;
  contact_email: string;
  contact_name: string | null;
  org_name: string | null;
  outreach_state: string;
  dnc_check_result: string | null;
  duplicate_check_result: string | null;
  last_gate_evaluated_at: string | null;
};

type Template = {
  id: string;
  slug: string;
  name: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  status: string;
  version: number;
};

type SendRow = {
  id: string;
  candidate_id: string;
  status: string;
  recipient_email: string;
  subject: string;
  send_error: string | null;
  sent_at: string | null;
  created_at: string;
};

type Escalation = {
  id: string;
  candidate_id: string;
  status: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  reopened_at: string | null;
  resolution_notes: string | null;
};

const stateBadge = (s: string) => {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    new: "secondary",
    blocked: "destructive",
    escalated: "destructive",
    sent: "default",
    suppressed: "destructive",
  };
  return <Badge variant={map[s] ?? "outline"}>{outreachStateLabel(s)}</Badge>;
};

const gateResultBadge = (dnc: string | null, dup: string | null) => {
  // Render the server-stored chips. UI does NOT compute gate locally.
  if (dnc === "block" || dup === "red") return <Badge variant="destructive">{GATE_RESULT_LABEL.block}</Badge>;
  if (dnc === "warn" || dup === "amber") return <Badge variant="secondary">{GATE_RESULT_LABEL.warn}</Badge>;
  if (dnc === "clear" && dup === "green") return <Badge variant="default">{GATE_RESULT_LABEL.allow}</Badge>;
  return <Badge variant="outline">{GATE_RESULT_LABEL.unevaluated}</Badge>;
};

function genIdempotencyKey() {
  // Browser-safe key for the Step 3 send endpoint (8–128 chars).
  const ab = new Uint8Array(16);
  crypto.getRandomValues(ab);
  return "ui-" + Array.from(ab).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const FacilitationOutreachTab: React.FC<{ caseId: string }> = ({ caseId }) => {
  const { isPlatformAdmin, isComplianceAnalyst, loading: rolesLoading } = useOutreachRoles();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add candidate form
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addOrg, setAddOrg] = useState("");
  const [addNote, setAddNote] = useState("");

  // Send form
  const [templateId, setTemplateId] = useState<string>("");
  const [ackedWarns, setAckedWarns] = useState<string[]>([]);
  const [idemKey, setIdemKey] = useState<string>(() => genIdempotencyKey());

  // Escalation form
  const [escReason, setEscReason] = useState("");
  const [escNotes, setEscNotes] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cands, tpls] = await Promise.all([
        supabase
          .from("facilitation_outreach_candidates")
          .select("id,facilitation_case_id,contact_email,contact_name,org_name,outreach_state,dnc_check_result,duplicate_check_result,last_gate_evaluated_at")
          .eq("facilitation_case_id", caseId)
          .order("created_at", { ascending: false }),
        supabase
          .from("facilitation_outreach_templates")
          .select("id,slug,name,subject,body_text,body_html,status,version")
          .order("name", { ascending: true }),
      ]);
      if (cands.error) throw cands.error;
      if (tpls.error) throw tpls.error;
      setCandidates((cands.data ?? []) as Candidate[]);
      setTemplates((tpls.data ?? []) as Template[]);
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not load outreach data. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const loadCandidateDetail = useCallback(async (cid: string) => {
    try {
      const [s, e] = await Promise.all([
        supabase.from("facilitation_outreach_sends").select("*").eq("candidate_id", cid).order("created_at", { ascending: false }),
        supabase.from("facilitation_compliance_escalations").select("*").eq("candidate_id", cid).order("created_at", { ascending: false }),
      ]);
      setSends((s.data ?? []) as SendRow[]);
      setEscalations((e.data ?? []) as Escalation[]);
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not load candidate details. Please try again."));
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    if (selectedCandidate) void loadCandidateDetail(selectedCandidate);
    else { setSends([]); setEscalations([]); }
  }, [selectedCandidate, loadCandidateDetail]);

  const approvedTemplates = useMemo(() => templates.filter((t) => t.status === "approved"), [templates]);
  const selectedTemplate = useMemo(() => approvedTemplates.find((t) => t.id === templateId) ?? null, [approvedTemplates, templateId]);
  const selectedCand = useMemo(() => candidates.find((c) => c.id === selectedCandidate) ?? null, [candidates, selectedCandidate]);

  // Build a fixed list of warn reason codes that may have come back from the
  // server-evaluated gate on this candidate.
  const requiredAckCodes = useMemo<string[]>(() => {
    if (!selectedCand) return [];
    const out: string[] = [];
    if (selectedCand.dnc_check_result === "warn") out.push("dnc_org_name_warning");
    if (selectedCand.duplicate_check_result === "amber") out.push("duplicate_soft_name_match");
    return out;
  }, [selectedCand]);

  const isBlocked = !!selectedCand && (selectedCand.dnc_check_result === "block" || selectedCand.duplicate_check_result === "red" || selectedCand.outreach_state === "blocked" || selectedCand.outreach_state === "escalated");
  const openEscalation = escalations.find((e) => e.status === "open") ?? null;

  const sendDisabled =
    !isPlatformAdmin ||
    !selectedCand ||
    !selectedTemplate ||
    !idemKey ||
    idemKey.length < 8 ||
    isBlocked ||
    !!openEscalation ||
    requiredAckCodes.some((c) => !ackedWarns.includes(c)) ||
    busy;

  const handleAddCandidate = async () => {
    if (!isPlatformAdmin) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-outreach-candidate-add", {
        body: {
          facilitation_case_id: caseId,
          counterparty_org_name: addOrg.trim(),
          contact_email: addEmail.trim(),
          contact_name: addName.trim() || undefined,
          source_note: addNote.trim() || undefined,
        },
      });
      if (error) throw error;
      toast.success("Candidate added. Contact checks have been run.");
      setAddEmail(""); setAddName(""); setAddOrg(""); setAddNote("");
      await loadAll();
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not register the candidate. Please check the details and try again."));
    } finally { setBusy(false); }
  };

  const handleSend = async () => {
    if (sendDisabled || !selectedCand || !selectedTemplate) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-outreach-send", {
        body: {
          candidate_id: selectedCand.id,
          template_id: selectedTemplate.id,
          idempotency_key: idemKey,
          acknowledged_warnings: ackedWarns,
        },
      });
      if (error) throw error;
      const replay = (data as { replay?: boolean } | null)?.replay;
      toast.success(replay ? "Idempotent replay (no new send)." : "Send dispatched.");
      setIdemKey(genIdempotencyKey());
      setAckedWarns([]);
      await loadCandidateDetail(selectedCand.id);
      await loadAll();
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "The message could not be sent. Please try again."));
    } finally { setBusy(false); }
  };

  const handleEscalate = async () => {
    if (!isPlatformAdmin || !selectedCand || !escReason.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-outreach-escalate", {
        body: {
          facilitation_case_id: caseId,
          candidate_id: selectedCand.id,
          reason: escReason.trim(),
        },
      });
      if (error) throw error;
      toast.success("Compliance escalation opened.");
      setEscReason("");
      await loadCandidateDetail(selectedCand.id);
      await loadAll();
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not open the compliance escalation. Please try again."));
    } finally { setBusy(false); }
  };

  const handleEscalationTransition = async (escalation_id: string, next_status: "resolved" | "open") => {
    if (!isComplianceAnalyst || !escNotes.trim()) {
      toast.error("Notes are required.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-outreach-escalation-resolve", {
        body: { escalation_id, next_status, resolution_note: escNotes.trim() },
      });
      if (error) throw error;
      toast.success(next_status === "resolved" ? "Escalation resolved." : "Escalation reopened.");
      setEscNotes("");
      if (selectedCandidate) await loadCandidateDetail(selectedCandidate);
      await loadAll();
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not update the escalation. Please try again."));
    } finally { setBusy(false); }
  };

  if (rolesLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!isPlatformAdmin && !isComplianceAnalyst) {
    return <p className="text-xs text-slate-500">Outreach surface restricted to platform_admin / compliance_analyst.</p>;
  }

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2">
        <h3 className="font-medium">Candidates ({candidates.length})</h3>
        {loading && <p className="text-xs text-slate-500">Loading…</p>}
        <ul className="divide-y border rounded-sm">
          {candidates.map((c) => (
            <li key={c.id} className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer ${selectedCandidate === c.id ? "bg-slate-50" : ""}`} onClick={() => setSelectedCandidate(c.id)}>
              <div className="min-w-0">
                <div className="font-mono text-xs truncate">{c.contact_email}</div>
                <div className="text-[11px] text-slate-500 truncate">{c.org_name ?? "—"}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {gateResultBadge(c.dnc_check_result, c.duplicate_check_result)}
                {stateBadge(c.outreach_state)}
              </div>
            </li>
          ))}
          {candidates.length === 0 && !loading && <li className="px-3 py-2 text-xs text-slate-500">No candidates yet.</li>}
        </ul>
      </section>

      {isPlatformAdmin && (
        <section className="space-y-2 border rounded-sm p-3">
          <h3 className="font-medium">Add candidate</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Counterparty org</Label><Input value={addOrg} onChange={(e) => setAddOrg(e.target.value)} placeholder="Org legal name" /></div>
            <div><Label className="text-xs">Contact email</Label><Input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} type="email" placeholder="name@example.com" /></div>
            <div><Label className="text-xs">Contact name</Label><Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Optional" /></div>
            <div><Label className="text-xs">Source note</Label><Input value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="Optional internal source" /></div>
          </div>
          <Button onClick={handleAddCandidate} disabled={busy || !addOrg.trim() || !addEmail.trim()} variant="outline">Register candidate</Button>
          <p className="text-[11px] text-slate-500">Gate (DNC + duplicate + suppression + escalation) is evaluated server-side on insert. UI never computes gate locally.</p>
        </section>
      )}

      {selectedCand && (
        <section className="space-y-3 border rounded-sm p-3">
          <h3 className="font-medium">Candidate: <span className="font-mono">{selectedCand.contact_email}</span></h3>
          <div className="flex items-center gap-2">{gateResultBadge(selectedCand.dnc_check_result, selectedCand.duplicate_check_result)} {stateBadge(selectedCand.outreach_state)}</div>

          {/* Send */}
          {isPlatformAdmin && (
            <div className="space-y-2 border-t pt-3">
              <h4 className="text-xs uppercase tracking-wider text-slate-500">Manual send</h4>
              <div>
                <Label className="text-xs">Approved template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder={approvedTemplates.length ? "Pick an approved template" : "No approved templates"} /></SelectTrigger>
                  <SelectContent>
                    {approvedTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name} <span className="text-slate-400">· v{t.version}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTemplate && (
                <div className="border rounded-sm p-2 bg-slate-50 text-xs">
                  <div className="font-medium">Subject: <span className="font-normal">{selectedTemplate.subject}</span></div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] mt-2">{selectedTemplate.body_text}</pre>
                </div>
              )}

              {requiredAckCodes.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Warn acknowledgements (server-required)</Label>
                  {requiredAckCodes.map((code) => (
                    <label key={code} className="flex items-center gap-2 text-xs">
                      <Checkbox checked={ackedWarns.includes(code)} onCheckedChange={(v) => setAckedWarns((cur) => v ? [...cur, code] : cur.filter((c) => c !== code))} />
                      <span className="font-mono">{code}</span>
                    </label>
                  ))}
                </div>
              )}

              <div>
                <Label className="text-xs">Idempotency key</Label>
                <div className="flex gap-2">
                  <Input value={idemKey} onChange={(e) => setIdemKey(e.target.value)} className="font-mono text-xs" />
                  <Button variant="outline" type="button" onClick={() => setIdemKey(genIdempotencyKey())}>New</Button>
                </div>
              </div>

              <Button onClick={handleSend} disabled={sendDisabled}>
                {isBlocked ? "Blocked by gate" : openEscalation ? "Blocked: open escalation" : "Send"}
              </Button>
              <p className="text-[11px] text-slate-500">Server re-evaluates the gate immediately before dispatch. Block ⇒ 409, warn ⇒ acknowledgement required.</p>

              <div className="mt-2">
                <h5 className="text-[11px] uppercase tracking-wider text-slate-500">Send history</h5>
                <ul className="text-xs space-y-1 mt-1">
                  {sends.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{s.subject}</span>
                      <span className="flex items-center gap-2"><Badge variant={s.status === "sent" ? "default" : s.status === "failed" ? "destructive" : "outline"}>{s.status}</Badge><span className="text-slate-400">{new Date(s.created_at).toLocaleString()}</span></span>
                    </li>
                  ))}
                  {sends.length === 0 && <li className="text-slate-500">No sends yet.</li>}
                </ul>
              </div>
            </div>
          )}

          {/* Escalation */}
          <div className="space-y-2 border-t pt-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-500">Compliance escalation</h4>
            {openEscalation ? (
              <div className="border rounded-sm p-2 bg-amber-50 text-xs space-y-1">
                <div><Badge variant="destructive">OPEN</Badge> <span className="text-slate-500">{new Date(openEscalation.created_at).toLocaleString()}</span></div>
                <div className="whitespace-pre-wrap">{openEscalation.reason}</div>
                {isComplianceAnalyst && (
                  <div className="mt-2 space-y-2">
                    <Textarea value={escNotes} onChange={(e) => setEscNotes(e.target.value)} placeholder="Resolution notes (required)" rows={2} />
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => handleEscalationTransition(openEscalation.id, "resolved")}>Resolve</Button>
                  </div>
                )}
                {isPlatformAdmin && !isComplianceAnalyst && (
                  <p className="text-[11px] text-slate-500">platform_admin cannot resolve. Awaiting compliance_analyst.</p>
                )}
              </div>
            ) : isPlatformAdmin ? (
              <div className="space-y-2">
                <Textarea value={escReason} onChange={(e) => setEscReason(e.target.value)} placeholder="Reason for escalation" rows={2} />
                <Button variant="outline" disabled={busy || !escReason.trim()} onClick={handleEscalate}>Open compliance escalation</Button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">No open escalation.</p>
            )}

            {/* Closed escalation history with reopen affordance (compliance_analyst only) */}
            <ul className="text-xs space-y-1 mt-2">
              {escalations.filter((e) => e.status !== "open").map((e) => (
                <li key={e.id} className="border rounded-sm p-2">
                  <div className="flex items-center gap-2"><Badge variant="outline">{e.status}</Badge><span className="text-slate-400">{new Date(e.created_at).toLocaleString()}</span></div>
                  <div className="text-slate-600 whitespace-pre-wrap mt-1">{e.reason}</div>
                  {e.resolution_notes && <div className="text-slate-500 mt-1">Notes: {e.resolution_notes}</div>}
                  {isComplianceAnalyst && e.status === "resolved" && (
                    <div className="mt-2 space-y-2">
                      <Textarea value={escNotes} onChange={(ev) => setEscNotes(ev.target.value)} placeholder="Reopen notes (required)" rows={2} />
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleEscalationTransition(e.id, "open")}>Reopen</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
};

export default FacilitationOutreachTab;
