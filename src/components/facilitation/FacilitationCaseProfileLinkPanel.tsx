/**
 * Batch 6 - Profile linking, ready-for-POI, and manual POI conversion
 * controls for the facilitation case admin drawer.
 *
 * No automatic POI creation. No organisation merge. No outreach.
 * Strictly admin-side capture of operator decisions.
 */
import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";

type CaseRow = Record<string, unknown> & {
  id: string;
  internal_status: string;
};

type LinkedOrg = { id: string; name: string } | null;

type Props = {
  caseId: string;
  kase: CaseRow;
  linkedOrganisation: LinkedOrg;
  onChanged: () => void | Promise<void>;
};

type OrgHit = { id: string; name: string; legal_name: string | null; registration_number: string | null };

// Cleared-state phrasing (shown with ✓ when the blocker does not apply).
const CLEARED_LABEL: Record<string, string> = {
  active_hard_block: "No compliance block",
  unresolved_compliance_review: "No unresolved compliance review",
  unresolved_more_information_request: "No outstanding 'more information' request",
  confirmed_sanctions_pep_block: "No confirmed sanctions or PEP match",
  active_do_not_contact_block: "No active do-not-contact block",
  missing_profile_or_organisation_link: "Organisation linked or profile recorded",
};
// Active-blocker phrasing (shown with • when the blocker still needs attention).
const BLOCKER_LABEL: Record<string, string> = {
  active_hard_block: "Case is currently blocked by compliance",
  unresolved_compliance_review: "Compliance review must be cleared first",
  unresolved_more_information_request: "Outstanding 'more information' request",
  confirmed_sanctions_pep_block: "Confirmed sanctions or PEP match on file",
  active_do_not_contact_block: "An active do-not-contact rule applies",
  missing_profile_or_organisation_link:
    "Link an existing organisation or record a counterparty profile first",
};

function readinessBlockers(
  kase: CaseRow,
  linkedOrg: LinkedOrg,
): string[] {
  const out: string[] = [];
  const status = String(kase.internal_status ?? "");
  if (status === "blocked_by_compliance") out.push("active_hard_block");
  if (status === "compliance_review_required") out.push("unresolved_compliance_review");
  if (status === "more_information_needed") out.push("unresolved_more_information_request");
  const hasProfileOrOrg =
    !!linkedOrg
    || !!(kase as { profile_record_recorded_at?: string | null }).profile_record_recorded_at;
  if (!hasProfileOrOrg) out.push("missing_profile_or_organisation_link");
  return out;
}

export const FacilitationCaseProfileLinkPanel: React.FC<Props> = ({
  caseId,
  kase,
  linkedOrganisation,
  onChanged,
}) => {
  // ─── Link existing organisation ───────────────────────────────────────
  const [linkOpen, setLinkOpen] = useState(false);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgHits, setOrgHits] = useState<OrgHit[]>([]);
  const [orgSearching, setOrgSearching] = useState(false);
  const [chosenOrg, setChosenOrg] = useState<OrgHit | null>(null);
  const [linkReason, setLinkReason] = useState("");
  const [linkEvidence, setLinkEvidence] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  async function searchOrgs() {
    if (orgQuery.trim().length < 2) { toast.error("Type at least 2 characters to search."); return; }
    setOrgSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-case-search-organisations", {
        body: { case_id: caseId, query: orgQuery.trim() },
      });
      if (error) throw error;
      setOrgHits(((data as { organisations?: OrgHit[] })?.organisations) ?? []);
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not search organisations. Please try again."));
    } finally { setOrgSearching(false); }
  }

  async function doLink() {
    if (!chosenOrg) { toast.error("Pick an organisation to link."); return; }
    if (linkReason.trim().length < 3) { toast.error("A reason for linking is required."); return; }
    setLinkSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "link_organisation",
          case_id: caseId,
          organization_id: chosenOrg.id,
          reason: linkReason.trim(),
          evidence_summary: linkEvidence.trim() ? linkEvidence.trim() : null,
        },
      });
      if (error) throw error;
      toast.success("Organisation linked to this case.");
      setLinkOpen(false); setChosenOrg(null); setOrgQuery(""); setOrgHits([]);
      setLinkReason(""); setLinkEvidence("");
      await onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not link the organisation. Please try again."));
    } finally { setLinkSubmitting(false); }
  }

  // ─── Record counterparty profile created ──────────────────────────────
  const [profOpen, setProfOpen] = useState(false);
  const [profOrgId, setProfOrgId] = useState("");
  const [profRef, setProfRef] = useState("");
  const [profNote, setProfNote] = useState("");
  const [profEvidence, setProfEvidence] = useState("");
  const [profSubmitting, setProfSubmitting] = useState(false);

  async function doProfile() {
    if (profNote.trim().length < 3) { toast.error("A short note is required."); return; }
    setProfSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "record_profile_created",
          case_id: caseId,
          organization_id: profOrgId.trim() ? profOrgId.trim() : null,
          profile_reference: profRef.trim() ? profRef.trim() : null,
          note: profNote.trim(),
          evidence_summary: profEvidence.trim() ? profEvidence.trim() : null,
        },
      });
      if (error) throw error;
      toast.success("Counterparty profile recorded.");
      setProfOpen(false); setProfOrgId(""); setProfRef(""); setProfNote(""); setProfEvidence("");
      await onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not record the profile. Please try again."));
    } finally { setProfSubmitting(false); }
  }

  // ─── Mark ready for POI ───────────────────────────────────────────────
  const [readyOpen, setReadyOpen] = useState(false);
  const [authoritySummary, setAuthoritySummary] = useState(
    (kase as { ready_for_poi_authority_summary?: string | null }).ready_for_poi_authority_summary ?? "",
  );
  const [readySubmitting, setReadySubmitting] = useState(false);

  const blockers = readinessBlockers(kase, linkedOrganisation);
  const isReady = String(kase.internal_status) === "ready_for_known_counterparty_poi"
    || String(kase.internal_status) === "converted_to_known_counterparty_poi";

  async function doMarkReady() {
    if (authoritySummary.trim().length < 3) { toast.error("Authority / evidence summary is required."); return; }
    setReadySubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "mark_ready_for_poi",
          case_id: caseId,
          authority_summary: authoritySummary.trim(),
        },
      });
      if (error) throw error;
      toast.success("Marked ready for POI.");
      setReadyOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not mark ready for POI."));
    } finally { setReadySubmitting(false); }
  }

  // ─── Record POI conversion (manual) ───────────────────────────────────
  const [convOpen, setConvOpen] = useState(false);
  const [convRef, setConvRef] = useState("");
  const [convReason, setConvReason] = useState("");
  const [convEvidence, setConvEvidence] = useState("");
  const [convSubmitting, setConvSubmitting] = useState(false);

  async function doConversion() {
    if (convRef.trim().length < 3) { toast.error("POI reference or link is required."); return; }
    if (convReason.trim().length < 3) { toast.error("A reason is required."); return; }
    setConvSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "record_poi_conversion",
          case_id: caseId,
          poi_reference: convRef.trim(),
          reason: convReason.trim(),
          evidence_summary: convEvidence.trim() ? convEvidence.trim() : null,
        },
      });
      if (error) throw error;
      toast.success("POI conversion recorded.");
      setConvOpen(false); setConvRef(""); setConvReason(""); setConvEvidence("");
      await onChanged();
    } catch (err) {
      toast.error(await friendlyFacilitationError(err, "Could not record the POI conversion."));
    } finally { setConvSubmitting(false); }
  }

  // ─── Saved-state display values ───────────────────────────────────────
  const profileNote = (kase as { profile_record_note?: string | null }).profile_record_note ?? null;
  const profileRef = (kase as { profile_record_reference?: string | null }).profile_record_reference ?? null;
  const profileRecordedAt = (kase as { profile_record_recorded_at?: string | null }).profile_record_recorded_at ?? null;
  const linkReasonShown = (kase as { linked_organization_reason?: string | null }).linked_organization_reason ?? null;
  const readyAt = (kase as { ready_for_poi_at?: string | null }).ready_for_poi_at ?? null;
  const readySummary = (kase as { ready_for_poi_authority_summary?: string | null }).ready_for_poi_authority_summary ?? null;
  const poiRef = (kase as { poi_conversion_reference?: string | null }).poi_conversion_reference ?? null;
  const poiReason = (kase as { poi_conversion_reason?: string | null }).poi_conversion_reason ?? null;
  const poiAt = (kase as { poi_conversion_recorded_at?: string | null }).poi_conversion_recorded_at ?? null;

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Profile linking and POI readiness</h3>
      </div>

      {/* Linked organisation */}
      <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Linked organisation</div>
          <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">Link existing organisation</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Link existing organisation</DialogTitle>
                <DialogDescription>
                  Linking attaches this facilitation case to an organisation that already exists on the platform. No organisations are merged or created.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="org-q">Search organisations</Label>
                  <div className="flex gap-2">
                    <Input id="org-q" value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} placeholder="Name, legal name, or registration number" />
                    <Button variant="outline" onClick={searchOrgs} disabled={orgSearching}>{orgSearching ? "Searching…" : "Search"}</Button>
                  </div>
                </div>
                {orgHits.length > 0 ? (
                  <ul className="max-h-48 overflow-auto border border-slate-200 rounded">
                    {orgHits.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setChosenOrg(o)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 ${chosenOrg?.id === o.id ? "bg-emerald-50" : ""}`}
                        >
                          <div className="font-medium text-slate-800">{o.name}</div>
                          <div className="text-xs text-slate-500">
                            {o.legal_name ?? "-"}{o.registration_number ? ` · ${o.registration_number}` : ""}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {chosenOrg ? (
                  <div className="text-xs text-slate-600">Selected: <span className="font-medium text-slate-800">{chosenOrg.name}</span></div>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="link-reason">Reason for linking</Label>
                  <Textarea id="link-reason" rows={2} value={linkReason} onChange={(e) => setLinkReason(e.target.value)} placeholder="Why this organisation matches the counterparty in this case." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="link-evidence">Evidence / source summary (optional)</Label>
                  <Textarea id="link-evidence" rows={2} value={linkEvidence} onChange={(e) => setLinkEvidence(e.target.value)} placeholder="How the link was verified, links, references." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setLinkOpen(false)} disabled={linkSubmitting}>Cancel</Button>
                <Button onClick={doLink} disabled={linkSubmitting || !chosenOrg}>{linkSubmitting ? "Linking…" : "Link organisation"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {linkedOrganisation ? (
          <div className="text-xs space-y-1">
            <div className="text-slate-800 font-medium">{linkedOrganisation.name}</div>
            {linkReasonShown ? <div className="whitespace-pre-wrap text-slate-700"><span className="text-slate-500">Reason: </span>{linkReasonShown}</div> : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No organisation linked yet.</p>
        )}
      </div>

      {/* Counterparty profile record */}
      <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Counterparty profile</div>
          <Dialog open={profOpen} onOpenChange={setProfOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">Record counterparty profile created</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Record counterparty profile created</DialogTitle>
                <DialogDescription>
                  Records that a counterparty profile has been created or verified outside this batch. No new organisation is created automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="prof-org">Existing organisation ID (optional)</Label>
                  <Input id="prof-org" value={profOrgId} onChange={(e) => setProfOrgId(e.target.value)} placeholder="If a safe organisation already exists, paste its ID to link it." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prof-ref">Profile reference (optional)</Label>
                  <Input id="prof-ref" value={profRef} onChange={(e) => setProfRef(e.target.value)} placeholder="Internal reference or note pointing to the profile." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prof-note">Note</Label>
                  <Textarea id="prof-note" rows={2} value={profNote} onChange={(e) => setProfNote(e.target.value)} placeholder="What was created or verified, and why." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prof-ev">Evidence / source summary (optional)</Label>
                  <Textarea id="prof-ev" rows={2} value={profEvidence} onChange={(e) => setProfEvidence(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setProfOpen(false)} disabled={profSubmitting}>Cancel</Button>
                <Button onClick={doProfile} disabled={profSubmitting}>{profSubmitting ? "Saving…" : "Save record"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {profileRecordedAt ? (
          <div className="text-xs space-y-1">
            <div className="text-slate-700">Recorded {new Date(profileRecordedAt).toLocaleString()}</div>
            {profileRef ? <div className="text-slate-700"><span className="text-slate-500">Reference: </span>{profileRef}</div> : null}
            {profileNote ? <div className="whitespace-pre-wrap text-slate-700"><span className="text-slate-500">Note: </span>{profileNote}</div> : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No profile record yet.</p>
        )}
      </div>

      {/* Readiness checklist + mark ready */}
      <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Ready for POI checklist</div>
          <Dialog open={readyOpen} onOpenChange={setReadyOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={blockers.length > 0 || isReady}>
                Mark ready for POI
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Mark ready for POI</DialogTitle>
                <DialogDescription>
                  This signals that the counterparty is ready for POI. No POI is created automatically and no outreach is sent.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="auth-sum">Authority / evidence summary</Label>
                  <Textarea id="auth-sum" rows={3} value={authoritySummary} onChange={(e) => setAuthoritySummary(e.target.value)} placeholder="Summarise the authority and evidence supporting readiness." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setReadyOpen(false)} disabled={readySubmitting}>Cancel</Button>
                <Button onClick={doMarkReady} disabled={readySubmitting}>{readySubmitting ? "Saving…" : "Mark ready"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <ul className="text-xs space-y-1">
          {Object.keys(CLEARED_LABEL).map((code) => {
            const active = blockers.includes(code);
            const label = active ? BLOCKER_LABEL[code] : CLEARED_LABEL[code];
            return (
              <li key={code} className={`flex items-start gap-2 ${active ? "text-amber-800" : "text-emerald-800"}`}>
                <span aria-hidden>{active ? "•" : "✓"}</span>
                <span>{label}</span>
              </li>
            );
          })}
        </ul>
        {readyAt ? (
          <div className="text-xs text-slate-700 mt-2">
            <Badge variant="secondary" className="mr-2">Ready for POI</Badge>
            Marked {new Date(readyAt).toLocaleString()}
            {readySummary ? <div className="mt-1 whitespace-pre-wrap"><span className="text-slate-500">Authority summary: </span>{readySummary}</div> : null}
          </div>
        ) : null}
      </div>

      {/* POI conversion record */}
      <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">POI conversion (manual)</div>
          <Dialog open={convOpen} onOpenChange={setConvOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={String(kase.internal_status) !== "ready_for_known_counterparty_poi"}>
                Record POI conversion
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Record POI conversion</DialogTitle>
                <DialogDescription>
                  Manually records that this case has been converted into a known-counterparty POI. No POI is created here - provide the reference or link of the POI that already exists.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="poi-ref">POI reference or link</Label>
                  <Input id="poi-ref" value={convRef} onChange={(e) => setConvRef(e.target.value)} placeholder="POI ID or URL." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="poi-reason">Reason</Label>
                  <Textarea id="poi-reason" rows={2} value={convReason} onChange={(e) => setConvReason(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="poi-ev">Evidence / source summary (optional)</Label>
                  <Textarea id="poi-ev" rows={2} value={convEvidence} onChange={(e) => setConvEvidence(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConvOpen(false)} disabled={convSubmitting}>Cancel</Button>
                <Button onClick={doConversion} disabled={convSubmitting}>{convSubmitting ? "Saving…" : "Record conversion"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {poiAt ? (
          <div className="text-xs space-y-1">
            <div className="text-slate-700">Recorded {new Date(poiAt).toLocaleString()}</div>
            {poiRef ? <div className="text-slate-700"><span className="text-slate-500">POI reference: </span>{poiRef}</div> : null}
            {poiReason ? <div className="whitespace-pre-wrap text-slate-700"><span className="text-slate-500">Reason: </span>{poiReason}</div> : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No conversion recorded.</p>
        )}
      </div>
    </section>
  );
};

export default FacilitationCaseProfileLinkPanel;
