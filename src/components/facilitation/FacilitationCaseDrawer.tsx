/**
 * FacilitationCaseDrawer - admin-side drawer with full case intake fields,
 * timeline, evidence list, assign/status/note controls.
 */
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  INTERNAL_STATUSES,
  OUTCOMES,
  INTERNAL_STATUS_LABELS,
  ROLE_LABELS,
  RELATIONSHIP_STATUS_LABELS,
  type FacilitationInternalStatus,
  type FacilitationRole,
  type FacilitationRelationshipStatus,
} from "@/lib/facilitation-case-state";
import { FacilitationOutreachTab } from "@/components/facilitation-outreach/FacilitationOutreachTab";
import { FacilitationCaseManualChecksPanel } from "@/components/facilitation/FacilitationCaseManualChecksPanel";
import { FacilitationCaseProfileLinkPanel } from "@/components/facilitation/FacilitationCaseProfileLinkPanel";
import {
  friendlyFacilitationError,
  rolesLabel,
  timelineActionLabel,
  outcomeLabel,
  OUTCOME_LABEL,
} from "@/lib/facilitation-labels";

type CaseRow = Record<string, unknown> & { id: string; case_number: string; internal_status: string; case_owner_id: string | null };

type Owner = { id: string; full_name: string | null; email: string | null; roles: string[] };

const OwnerPicker: React.FC<{ value: string; onChange: (v: string) => void; onSave: () => void }> = ({ value, onChange, onSave }) => {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("facilitation-case-eligible-owners", { body: {} });
        if (error) throw error;
        if (!cancelled) setOwners(((data as { owners?: Owner[] })?.owners ?? []));
      } catch (err: unknown) {
        if (!cancelled) toast.error(await friendlyFacilitationError(err, "Could not load case owners. Please try again."));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  const label = (o: Owner) => o.full_name || o.email || o.id;
  return (
    <div className="flex gap-2">
      <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={loading ? "Loading…" : "Pick an eligible owner"} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">- Unassigned -</SelectItem>
          {owners.map((o) => (
            <SelectItem key={o.id} value={o.id}>{label(o)}{o.roles.length ? <span className="text-slate-400"> · {rolesLabel(o.roles)}</span> : null}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={onSave} variant="outline">Save</Button>
    </div>
  );
};


export const FacilitationCaseDrawer: React.FC<{
  caseId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}> = ({ caseId, onClose, onChanged }) => {
  const [data, setData] = useState<{ case: CaseRow; events: Array<{ id: string; action: string; created_at: string; payload: Record<string, unknown> | null; from_status: string | null; to_status: string | null }>; evidence: Array<{ id: string; original_filename: string; created_at: string; storage_path: string }>; registry_checks?: Array<Record<string, unknown>>; sanctions_checks?: Array<Record<string, unknown>>; contact_attempts?: Array<Record<string, unknown>>; linked_organisation?: { id: string; name: string } | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [nextStatus, setNextStatus] = useState<FacilitationInternalStatus | "">("");
  const [closingReason, setClosingReason] = useState("");
  const [outcome, setOutcome] = useState<string>("");
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [moreInfoMessage, setMoreInfoMessage] = useState("");
  const [moreInfoItemsText, setMoreInfoItemsText] = useState("");
  const [moreInfoDueDate, setMoreInfoDueDate] = useState("");
  const [moreInfoSubmitting, setMoreInfoSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke("get-facilitation-case", { body: { case_id: caseId } });
      if (error) throw error;
      setData(resp as typeof data);
      setOwnerInput(((resp as { case: CaseRow }).case.case_owner_id as string | null) ?? "");
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not load. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { if (caseId) void load(); else setData(null); }, [caseId, load]);

  const call = async (body: Record<string, unknown>) => {
    const { error } = await supabase.functions.invoke("facilitation-case-admin-action", { body });
    if (error) throw error;
    await load();
    onChanged?.();
  };

  const doAssign = async () => {
    try {
      await call({ action: "assign", case_id: caseId, owner_user_id: ownerInput.trim() || null });
      toast.success("Owner updated.");
    } catch (err: unknown) { toast.error(await friendlyFacilitationError(err, "Could not assign this case. Please try again.")); }
  };
  const doStatus = async () => {
    if (!nextStatus) return;
    try {
      await call({
        action: "status_change", case_id: caseId, to_status: nextStatus,
        closing_reason: closingReason.trim() || null,
        final_outcome: outcome || null,
      });
      toast.success("Status updated.");
      setClosingReason(""); setOutcome(""); setNextStatus("");
    } catch (err: unknown) { toast.error(await friendlyFacilitationError(err, "Could not change the case status. Please try again.")); }
  };
  const doNote = async () => {
    if (note.trim().length < 2) return;
    try {
      await call({ action: "note", case_id: caseId, body: note.trim() });
      setNote("");
      toast.success("Note added.");
    } catch (err: unknown) { toast.error(await friendlyFacilitationError(err, "Could not save the note. Please try again.")); }
  };

  const doRequestMoreInfo = async () => {
    const items = moreInfoItemsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (moreInfoMessage.trim().length < 5) { toast.error("Please write a short message for the requester (at least 5 characters)."); return; }
    if (items.length === 0) { toast.error("Please list at least one item you need from the requester."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moreInfoDueDate)) { toast.error("Please pick a due date."); return; }
    setMoreInfoSubmitting(true);
    try {
      await call({ action: "request_more_information", case_id: caseId, message: moreInfoMessage.trim(), items, due_date: moreInfoDueDate });
      toast.success("Requester has been asked for more information.");
      setMoreInfoOpen(false);
      setMoreInfoMessage(""); setMoreInfoItemsText(""); setMoreInfoDueDate("");
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not send the information request. Please try again."));
    } finally {
      setMoreInfoSubmitting(false);
    }
  };


  const open = !!caseId;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{data?.case.case_number ?? "Facilitation case"}</SheetTitle>
          <SheetDescription>Review the case and run outreach</SheetDescription>
        </SheetHeader>

        {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}

        {data && (
          <Tabs defaultValue="triage" className="mt-4">
            <TabsList>
              <TabsTrigger value="triage">Triage</TabsTrigger>
              <TabsTrigger value="outreach">Outreach</TabsTrigger>
            </TabsList>
            <TabsContent value="outreach" className="mt-4">
              {caseId && <FacilitationOutreachTab caseId={caseId} />}
            </TabsContent>
            <TabsContent value="triage" className="mt-4">
          <div className="mt-4 space-y-6 text-sm">
            <section>
              <h3 className="font-medium mb-2">Status</h3>
              <Badge variant="secondary">{INTERNAL_STATUS_LABELS[data.case.internal_status as FacilitationInternalStatus] ?? data.case.internal_status}</Badge>
            </section>

            {/* Batch 4 — More information request panel */}
            <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">More information</h3>
                <Dialog open={moreInfoOpen} onOpenChange={setMoreInfoOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">Request more information</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Request more information</DialogTitle>
                      <DialogDescription>
                        The requester will be notified and the case status will change to "More information needed".
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="mi-msg">Message to the requester</Label>
                        <Textarea id="mi-msg" rows={3} value={moreInfoMessage} onChange={(e) => setMoreInfoMessage(e.target.value)} placeholder="Explain what is missing in plain English. No internal compliance reasoning." />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="mi-items">Items needed (one per line)</Label>
                        <Textarea id="mi-items" rows={4} value={moreInfoItemsText} onChange={(e) => setMoreInfoItemsText(e.target.value)} placeholder={"e.g.\nProof of trading address\nUpdated contact email"} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="mi-due">Due date</Label>
                        <Input id="mi-due" type="date" value={moreInfoDueDate} onChange={(e) => setMoreInfoDueDate(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setMoreInfoOpen(false)} disabled={moreInfoSubmitting}>Cancel</Button>
                      <Button onClick={doRequestMoreInfo} disabled={moreInfoSubmitting}>{moreInfoSubmitting ? "Sending…" : "Send request"}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              {data.case.info_request_requested_at ? (
                <div className="text-xs space-y-1">
                  <div><span className="text-slate-500">Requested:</span> {new Date(data.case.info_request_requested_at as string).toLocaleString()}</div>
                  {data.case.info_request_due_date ? <div><span className="text-slate-500">Due:</span> {data.case.info_request_due_date as string}</div> : null}
                  {data.case.info_request_message ? <div className="whitespace-pre-wrap"><span className="text-slate-500">Message:</span> {data.case.info_request_message as string}</div> : null}
                  {Array.isArray(data.case.info_request_items) && (data.case.info_request_items as string[]).length > 0 ? (
                    <div>
                      <span className="text-slate-500">Items requested:</span>
                      <ul className="list-disc pl-5 mt-1 text-slate-700">
                        {(data.case.info_request_items as string[]).map((it, i) => <li key={i}>{it}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {data.case.info_request_response_at ? (
                    <div className="mt-2 rounded bg-white border border-slate-200 p-2">
                      <div><span className="text-slate-500">Requester response:</span> {new Date(data.case.info_request_response_at as string).toLocaleString()}</div>
                      {data.case.info_request_response_message ? <div className="whitespace-pre-wrap text-slate-700 mt-1">{data.case.info_request_response_message as string}</div> : null}
                      {data.case.info_request_response_evidence_summary ? <div className="whitespace-pre-wrap text-slate-600 mt-1"><span className="text-slate-500">Source / evidence: </span>{data.case.info_request_response_evidence_summary as string}</div> : null}
                    </div>
                  ) : (
                    <div className="text-slate-500">Awaiting requester response.</div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No active information request.</p>
              )}
            </section>

            {/* Batch 5 — manual checks & contact-attempt capture */}
            {caseId ? (
              <FacilitationCaseManualChecksPanel
                caseId={caseId}
                registryChecks={(data.registry_checks ?? []) as Parameters<typeof FacilitationCaseManualChecksPanel>[0]["registryChecks"]}
                sanctionsChecks={(data.sanctions_checks ?? []) as Parameters<typeof FacilitationCaseManualChecksPanel>[0]["sanctionsChecks"]}
                contactAttempts={(data.contact_attempts ?? []) as Parameters<typeof FacilitationCaseManualChecksPanel>[0]["contactAttempts"]}
                onChanged={load}
              />
            ) : null}

            <section>
              <h3 className="font-medium mb-2">Intake</h3>
              {(() => {
                const c = data.case as Record<string, unknown>;
                const get = (k: string) => {
                  const v = c[k];
                  if (v === null || v === undefined) return null;
                  if (typeof v === "string" && v.trim() === "") return null;
                  return v;
                };
                const roleRaw = get("role") as string | null;
                const relRaw = get("relationship_status") as string | null;
                const valAmt = get("estimated_value_amount");
                const valCcy = get("estimated_value_currency") as string | null;
                const rows: Array<[string, React.ReactNode]> = [
                  ["Counterparty", get("counterparty_legal_name") as React.ReactNode],
                  ["Trading name", get("counterparty_trading_name") as React.ReactNode],
                  ["Country", get("counterparty_country") as React.ReactNode],
                  ["City", get("counterparty_city") as React.ReactNode],
                  ["Physical address", get("physical_address") as React.ReactNode],
                  ["Registration number", get("registration_number") as React.ReactNode],
                  ["Tax / VAT number", get("tax_vat_number") as React.ReactNode],
                  ["Sector", get("sector") as React.ReactNode],
                  ["Product", get("product_or_commodity") as React.ReactNode],
                  ["Role", roleRaw ? (ROLE_LABELS[roleRaw as FacilitationRole] ?? roleRaw) : null],
                  ["Relationship", relRaw ? (RELATIONSHIP_STATUS_LABELS[relRaw as FacilitationRelationshipStatus] ?? relRaw) : null],
                  ["Urgency", get("urgency") as React.ReactNode],
                  ["Target response date", get("target_response_date") as React.ReactNode],
                  ["Value", valAmt ? `${valAmt} ${valCcy ?? ""}`.trim() : null],
                  ["Email", get("counterparty_email") as React.ReactNode],
                  ["Phone", get("counterparty_phone") as React.ReactNode],
                  ["Website", get("counterparty_website") as React.ReactNode],
                  ["Contact person", get("counterparty_contact_name") as React.ReactNode],
                  ["Contact title", get("contact_person_title") as React.ReactNode],
                  ["Contact phone", get("contact_person_phone") as React.ReactNode],
                  ["Contact email", get("contact_person_email") as React.ReactNode],
                  ["Preferred language", get("preferred_contact_language") as React.ReactNode],
                  ["Permission to contact", get("permission_to_contact") === undefined || get("permission_to_contact") === null ? null : (c.permission_to_contact ? "Yes" : "No")],
                ].filter(([, v]) => v !== null && v !== undefined && v !== "") as Array<[string, React.ReactNode]>;
                return (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    {rows.map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="text-slate-800">{v}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                );
              })()}
              {data.case.reason ? (
                <p className="mt-3 text-xs text-slate-600 whitespace-pre-wrap"><span className="text-slate-500">Reason: </span>{data.case.reason as string}</p>
              ) : null}
              {data.case.how_user_knows_counterparty ? (
                <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap"><span className="text-slate-500">How user knows: </span>{data.case.how_user_knows_counterparty as string}</p>
              ) : null}
              {data.case.source_evidence_summary ? (
                <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap"><span className="text-slate-500">Source / evidence: </span>{data.case.source_evidence_summary as string}</p>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">Assign owner</h3>
              <OwnerPicker value={ownerInput} onChange={setOwnerInput} onSave={doAssign} />
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">Change status</h3>
              <div className="grid grid-cols-2 gap-2">
                <Select value={nextStatus} onValueChange={(v) => setNextStatus(v as FacilitationInternalStatus)}>
                  <SelectTrigger><SelectValue placeholder="Next status" /></SelectTrigger>
                  <SelectContent>
                    {INTERNAL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{INTERNAL_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger><SelectValue placeholder="Final outcome (optional)" /></SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABEL[o] ?? o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Textarea placeholder="Closing reason / explanation" value={closingReason} onChange={(e) => setClosingReason(e.target.value)} rows={2} />
              <Button onClick={doStatus} disabled={!nextStatus}>Apply</Button>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">Add internal note</h3>
              <Textarea placeholder="Internal admin note (no outreach)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <Button onClick={doNote} variant="outline">Add note</Button>
            </section>

            <section>
              <h3 className="font-medium mb-2">Timeline</h3>
              <ol className="space-y-2 text-xs">
                {data.events.map((ev) => (
                  <li key={ev.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="text-slate-400 font-mono">{new Date(ev.created_at).toLocaleString()}</div>
                    <div className="text-slate-800">
                      {timelineActionLabel(ev.action)}
                      {ev.to_status ? <> → {INTERNAL_STATUS_LABELS[ev.to_status as FacilitationInternalStatus] ?? OUTCOME_LABEL[ev.to_status] ?? ev.to_status.replace(/_/g, " ")}</> : null}
                      {ev.payload && typeof (ev.payload as Record<string, unknown>).final_outcome === "string"
                        ? <> · {outcomeLabel((ev.payload as Record<string, unknown>).final_outcome as string)}</>
                        : null}
                    </div>
                    {ev.payload?.body ? <div className="text-slate-600 whitespace-pre-wrap mt-1">{String(ev.payload.body)}</div> : null}
                  </li>
                ))}
                {data.events.length === 0 && <li className="text-slate-500">No events yet.</li>}
              </ol>
            </section>

            <section>
              <h3 className="font-medium mb-2">Evidence</h3>
              {data.evidence.length === 0 ? <p className="text-xs text-slate-500">No evidence uploaded.</p> : (
                <ul className="text-xs space-y-1">
                  {data.evidence.map((e) => (
                    <li key={e.id} className="text-slate-700">{e.original_filename} <span className="text-slate-400">· {new Date(e.created_at).toLocaleString()}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default FacilitationCaseDrawer;
