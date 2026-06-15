/**
 * FacilitationCaseDrawer — admin-side drawer with full case intake fields,
 * timeline, evidence list, assign/status/note controls.
 */
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  INTERNAL_STATUSES,
  OUTCOMES,
  INTERNAL_STATUS_LABELS,
  type FacilitationInternalStatus,
} from "@/lib/facilitation-case-state";
import { FacilitationOutreachTab } from "@/components/facilitation-outreach/FacilitationOutreachTab";
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
          <SelectItem value="__none__">— Unassigned —</SelectItem>
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
  const [data, setData] = useState<{ case: CaseRow; events: Array<{ id: string; action: string; created_at: string; payload: Record<string, unknown> | null; from_status: string | null; to_status: string | null }>; evidence: Array<{ id: string; original_filename: string; created_at: string; storage_path: string }> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [nextStatus, setNextStatus] = useState<FacilitationInternalStatus | "">("");
  const [closingReason, setClosingReason] = useState("");
  const [outcome, setOutcome] = useState<string>("");

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

            <section>
              <h3 className="font-medium mb-2">Intake</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {[
                  ["Counterparty", data.case.counterparty_legal_name as string],
                  ["Country", data.case.counterparty_country as string],
                  ["Product", data.case.product_or_commodity as string],
                  ["Role", data.case.role as string],
                  ["Urgency", data.case.urgency as string],
                  ["Value", `${data.case.estimated_value_amount} ${data.case.estimated_value_currency}`],
                  ["Email", (data.case.counterparty_email as string) || "—"],
                  ["Permission to contact", data.case.permission_to_contact ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <React.Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></React.Fragment>
                ))}
              </dl>
              <p className="mt-3 text-xs text-slate-600 whitespace-pre-wrap"><span className="text-slate-500">Reason: </span>{data.case.reason as string}</p>
              <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap"><span className="text-slate-500">How user knows: </span>{data.case.how_user_knows_counterparty as string}</p>
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
                    {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
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
                    <div className="text-slate-800">{ev.action} {ev.to_status ? `→ ${ev.to_status}` : ""}</div>
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
