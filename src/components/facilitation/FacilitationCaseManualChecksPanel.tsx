/**
 * Batch 5 — manual check & contact-attempt capture panels.
 *
 * Renders three admin-only sections inside the facilitation case drawer:
 *   - Registry / KYB lookup result capture
 *   - Sanctions / PEP screening result capture
 *   - Manual call / contact attempt capture
 *
 * No live integrations. No automation. All results are operator-entered.
 */
import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  friendlyFacilitationError,
  registryResultLabel,
  confidenceLabel,
  sanctionsResultLabel,
  riskLevelLabel,
  complianceDecisionLabel,
  contactChannelLabel,
  contactResultLabel,
} from "@/lib/facilitation-labels";

type RegistryCheck = {
  id: string; created_at: string; provider_name: string; lookup_date: string;
  result: string; confidence: string; source_reference: string | null;
  note: string | null; evidence_summary: string | null;
};
type SanctionsCheck = {
  id: string; created_at: string; screening_date: string; result: string;
  screening_source: string; matched_name: string | null;
  risk_level: string; compliance_decision: string;
  note: string | null; evidence_summary: string | null;
};
type ContactAttempt = {
  id: string; created_at: string; channel: string; contact_at: string;
  recipient: string | null; contact_details_used: string | null;
  result: string; note: string | null; next_action_date: string | null;
  evidence_summary: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const nowLocalForInput = () => {
  const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const FacilitationCaseManualChecksPanel: React.FC<{
  caseId: string;
  registryChecks: RegistryCheck[];
  sanctionsChecks: SanctionsCheck[];
  contactAttempts: ContactAttempt[];
  onChanged: () => void;
}> = ({ caseId, registryChecks, sanctionsChecks, contactAttempts, onChanged }) => {
  return (
    <div className="space-y-6">
      <RegistrySection caseId={caseId} items={registryChecks} onChanged={onChanged} />
      <SanctionsSection caseId={caseId} items={sanctionsChecks} onChanged={onChanged} />
      <ContactSection caseId={caseId} items={contactAttempts} onChanged={onChanged} />
    </div>
  );
};

// ─── Registry / KYB ─────────────────────────────────────────────────────
const RegistrySection: React.FC<{ caseId: string; items: RegistryCheck[]; onChanged: () => void }> = ({ caseId, items, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("");
  const [lookupDate, setLookupDate] = useState(todayISO());
  const [result, setResult] = useState<string>("");
  const [confidence, setConfidence] = useState<string>("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const latest = items[0];

  const submit = async () => {
    if (!provider.trim()) return toast.error("Please name the registry / KYB source.");
    if (!result) return toast.error("Please pick a result.");
    if (!confidence) return toast.error("Please pick a confidence level.");
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "record_registry_check",
          case_id: caseId,
          provider_name: provider.trim(),
          lookup_date: lookupDate,
          result, confidence,
          source_reference: ref.trim() || null,
          note: note.trim() || null,
          evidence_summary: evidence.trim() || null,
        },
      });
      if (error) throw error;
      toast.success("Registry / KYB check recorded.");
      setOpen(false);
      setProvider(""); setResult(""); setConfidence(""); setRef(""); setNote(""); setEvidence("");
      onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not record the registry check. Please try again."));
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Registry / KYB checks</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline">Record registry/KYB check</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Record registry / KYB check</DialogTitle>
              <DialogDescription>Manual result capture only. No live registry connection is performed.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Field label="Provider / source"><Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Companies House, regulator portal" /></Field>
              <Field label="Lookup date"><Input type="date" value={lookupDate} onChange={(e) => setLookupDate(e.target.value)} /></Field>
              <Field label="Result">
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger><SelectValue placeholder="Pick a result" /></SelectTrigger>
                  <SelectContent>
                    {["clear","possible_match","no_match","unavailable","failed"].map((v) => (
                      <SelectItem key={v} value={v}>{registryResultLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Confidence">
                <Select value={confidence} onValueChange={setConfidence}>
                  <SelectTrigger><SelectValue placeholder="Pick confidence" /></SelectTrigger>
                  <SelectContent>
                    {["high","medium","low","unknown"].map((v) => (
                      <SelectItem key={v} value={v}>{confidenceLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Source reference / link (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Registry number or link" /></Field>
              <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
              <Field label="Source / evidence summary (optional)"><Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} /></Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save check"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {latest ? (
        <div className="text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{registryResultLabel(latest.result)}</Badge>
            <Badge variant="outline">Confidence: {confidenceLabel(latest.confidence)}</Badge>
            <span className="text-slate-500">{latest.provider_name} · {latest.lookup_date}</span>
          </div>
          {latest.source_reference ? <div className="text-slate-700"><span className="text-slate-500">Reference: </span>{latest.source_reference}</div> : null}
          {latest.note ? <div className="text-slate-700 whitespace-pre-wrap"><span className="text-slate-500">Note: </span>{latest.note}</div> : null}
          {latest.evidence_summary ? <div className="text-slate-700 whitespace-pre-wrap"><span className="text-slate-500">Source / evidence: </span>{latest.evidence_summary}</div> : null}
        </div>
      ) : <p className="text-xs text-slate-500">No registry / KYB check recorded yet.</p>}
      {items.length > 1 ? (
        <details className="text-xs"><summary className="cursor-pointer text-slate-500">History ({items.length})</summary>
          <ul className="mt-1 space-y-1">
            {items.slice(1).map((r) => (
              <li key={r.id} className="text-slate-600">
                {r.lookup_date} · {r.provider_name} · {registryResultLabel(r.result)} · {confidenceLabel(r.confidence)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
};

// ─── Sanctions / PEP ────────────────────────────────────────────────────
const SanctionsSection: React.FC<{ caseId: string; items: SanctionsCheck[]; onChanged: () => void }> = ({ caseId, items, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [source, setSource] = useState("");
  const [result, setResult] = useState<string>("");
  const [matched, setMatched] = useState("");
  const [risk, setRisk] = useState<string>("");
  const [decision, setDecision] = useState<string>("");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const latest = items[0];

  const submit = async () => {
    if (!source.trim()) return toast.error("Please name the screening source.");
    if (!result) return toast.error("Please pick a result.");
    if (!risk) return toast.error("Please pick a risk level.");
    if (!decision) return toast.error("Please pick a compliance decision.");
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "record_sanctions_check",
          case_id: caseId,
          screening_date: date,
          result,
          screening_source: source.trim(),
          matched_name: matched.trim() || null,
          risk_level: risk,
          compliance_decision: decision,
          note: note.trim() || null,
          evidence_summary: evidence.trim() || null,
        },
      });
      if (error) throw error;
      toast.success("Sanctions / PEP result recorded.");
      setOpen(false);
      setSource(""); setResult(""); setMatched(""); setRisk(""); setDecision(""); setNote(""); setEvidence("");
      onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not record the sanctions / PEP result. Please try again."));
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Sanctions / PEP screening</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline">Record sanctions/PEP result</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Record sanctions / PEP result</DialogTitle>
              <DialogDescription>Manual result capture only. Confirmed matches preserve a hard block; possible matches require compliance review.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Field label="Screening date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Screening source / provider"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. OFAC lookup, official sanctions list" /></Field>
              <Field label="Result">
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger><SelectValue placeholder="Pick a result" /></SelectTrigger>
                  <SelectContent>
                    {["clear","possible_match","confirmed_match","unavailable","failed"].map((v) => (
                      <SelectItem key={v} value={v}>{sanctionsResultLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Matched name (if any)"><Input value={matched} onChange={(e) => setMatched(e.target.value)} /></Field>
              <Field label="Risk level">
                <Select value={risk} onValueChange={setRisk}>
                  <SelectTrigger><SelectValue placeholder="Pick risk level" /></SelectTrigger>
                  <SelectContent>
                    {["low","medium","high","critical","unknown"].map((v) => (
                      <SelectItem key={v} value={v}>{riskLevelLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Compliance decision">
                <Select value={decision} onValueChange={setDecision}>
                  <SelectTrigger><SelectValue placeholder="Pick decision" /></SelectTrigger>
                  <SelectContent>
                    {["no_issue","review_required","blocked","cleared_after_review"].map((v) => (
                      <SelectItem key={v} value={v}>{complianceDecisionLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reason / note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
              <Field label="Source / evidence summary (optional)"><Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} /></Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save result"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {latest ? (
        <div className="text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{sanctionsResultLabel(latest.result)}</Badge>
            <Badge variant="outline">{riskLevelLabel(latest.risk_level)}</Badge>
            <Badge variant="outline">{complianceDecisionLabel(latest.compliance_decision)}</Badge>
            <span className="text-slate-500">{latest.screening_source} · {latest.screening_date}</span>
          </div>
          {latest.matched_name ? <div className="text-slate-700"><span className="text-slate-500">Matched name: </span>{latest.matched_name}</div> : null}
          {latest.note ? <div className="text-slate-700 whitespace-pre-wrap"><span className="text-slate-500">Note: </span>{latest.note}</div> : null}
          {latest.evidence_summary ? <div className="text-slate-700 whitespace-pre-wrap"><span className="text-slate-500">Source / evidence: </span>{latest.evidence_summary}</div> : null}
        </div>
      ) : <p className="text-xs text-slate-500">No sanctions / PEP result recorded yet.</p>}
      {items.length > 1 ? (
        <details className="text-xs"><summary className="cursor-pointer text-slate-500">History ({items.length})</summary>
          <ul className="mt-1 space-y-1">
            {items.slice(1).map((s) => (
              <li key={s.id} className="text-slate-600">
                {s.screening_date} · {s.screening_source} · {sanctionsResultLabel(s.result)} · {complianceDecisionLabel(s.compliance_decision)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
};

// ─── Manual call / contact attempt ──────────────────────────────────────
const ContactSection: React.FC<{ caseId: string; items: ContactAttempt[]; onChanged: () => void }> = ({ caseId, items, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<string>("");
  const [contactAt, setContactAt] = useState(nowLocalForInput());
  const [recipient, setRecipient] = useState("");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<string>("");
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [evidence, setEvidence] = useState("");
  const [advance, setAdvance] = useState<string>("");
  const latest = items[0];

  const submit = async () => {
    if (!channel) return toast.error("Please pick a channel.");
    if (!result) return toast.error("Please pick a result.");
    setBusy(true);
    try {
      const iso = new Date(contactAt).toISOString();
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "record_contact_attempt",
          case_id: caseId,
          channel,
          contact_at: iso,
          recipient: recipient.trim() || null,
          contact_details_used: details.trim() || null,
          result,
          note: note.trim() || null,
          next_action_date: nextAction || null,
          evidence_summary: evidence.trim() || null,
          advance_status: advance || null,
        },
      });
      if (error) throw error;
      toast.success("Contact attempt recorded.");
      setOpen(false);
      setChannel(""); setRecipient(""); setDetails(""); setResult(""); setNote("");
      setNextAction(""); setEvidence(""); setAdvance("");
      onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not record the contact attempt. Please try again."));
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Manual call / contact attempts</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline">Record call/contact attempt</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Record call / contact attempt</DialogTitle>
              <DialogDescription>Manual record only. No message is sent; WhatsApp/SMS/social DM are not part of this surface.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Field label="Channel">
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger><SelectValue placeholder="Pick a channel" /></SelectTrigger>
                  <SelectContent>
                    {["phone","email_outside_system","meeting","other"].map((v) => (
                      <SelectItem key={v} value={v}>{contactChannelLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contact date / time"><Input type="datetime-local" value={contactAt} onChange={(e) => setContactAt(e.target.value)} /></Field>
              <Field label="Recipient / contact person (optional)"><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
              <Field label="Contact details used (optional)"><Input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Phone number, email, or meeting reference" /></Field>
              <Field label="Result">
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger><SelectValue placeholder="Pick a result" /></SelectTrigger>
                  <SelectContent>
                    {["no_answer","left_message","reached_counterparty","wrong_contact","declined","requested_more_information","other"].map((v) => (
                      <SelectItem key={v} value={v}>{contactResultLabel(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Call / contact note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></Field>
              <Field label="Next action date (optional)"><Input type="date" value={nextAction} onChange={(e) => setNextAction(e.target.value)} /></Field>
              <Field label="Source / evidence summary (optional)"><Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} /></Field>
              <Field label="Move case status (optional)">
                <Select value={advance || "__none__"} onValueChange={(v) => setAdvance(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Do not change status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Do not change status</SelectItem>
                    <SelectItem value="contact_attempted">Mark contact attempted</SelectItem>
                    <SelectItem value="counterparty_responded">Mark counterparty responded</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save attempt"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {latest ? (
        <div className="text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{contactResultLabel(latest.result)}</Badge>
            <Badge variant="outline">{contactChannelLabel(latest.channel)}</Badge>
            <span className="text-slate-500">{new Date(latest.contact_at).toLocaleString()}</span>
          </div>
          {latest.recipient ? <div className="text-slate-700"><span className="text-slate-500">Recipient: </span>{latest.recipient}</div> : null}
          {latest.contact_details_used ? <div className="text-slate-700"><span className="text-slate-500">Contact details used: </span>{latest.contact_details_used}</div> : null}
          {latest.note ? <div className="text-slate-700 whitespace-pre-wrap"><span className="text-slate-500">Note: </span>{latest.note}</div> : null}
          {latest.next_action_date ? <div className="text-slate-700"><span className="text-slate-500">Next action: </span>{latest.next_action_date}</div> : null}
          {latest.evidence_summary ? <div className="text-slate-700 whitespace-pre-wrap"><span className="text-slate-500">Source / evidence: </span>{latest.evidence_summary}</div> : null}
        </div>
      ) : <p className="text-xs text-slate-500">No call / contact attempt recorded yet.</p>}
      {items.length > 1 ? (
        <details className="text-xs"><summary className="cursor-pointer text-slate-500">History ({items.length})</summary>
          <ul className="mt-1 space-y-1">
            {items.slice(1).map((a) => (
              <li key={a.id} className="text-slate-600">
                {new Date(a.contact_at).toLocaleString()} · {contactChannelLabel(a.channel)} · {contactResultLabel(a.result)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1"><Label>{label}</Label>{children}</div>
);

export default FacilitationCaseManualChecksPanel;
