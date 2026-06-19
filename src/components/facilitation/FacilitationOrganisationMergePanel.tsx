/**
 * Batch 17 — Controlled organisation merge panel (admin drawer section).
 *
 * Surfaces duplicate candidates discovered from the facilitation case and the
 * organisation record, runs the eligibility gate, and requires deliberate
 * platform-admin confirmation before any merge is recorded. No automatic,
 * silent or bulk merges. No outreach, WaD, payment, token, match, credit
 * movement, or provider call is triggered from this panel.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type Props = {
  caseId: string;
  sourceOrgId: string | null;
  onChanged: () => void | Promise<void>;
};

type OrgSummary = {
  id: string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  tax_number: string | null;
  vat_number: string | null;
  jurisdictions: string[] | null;
  website: string | null;
  industry: string | null;
  status: string | null;
  frozen: boolean;
  billing_hold: boolean;
  already_merged: boolean;
};

type Report = {
  eligible: boolean;
  blockers: string[];
  blocker_labels: Array<{ code: string; label: string }>;
  source: OrgSummary | null;
  target: OrgSummary | null;
  proposed_field_handling: Array<{ field: string; will_copy: boolean; reason: string }>;
  fields_never_copied: string[];
  deferred_live_integrations: { registry_kyb: string; sanctions_pep: string };
};

const FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  trading_name: "Trading name",
  registration_number: "Registration number",
  tax_number: "Tax number",
  vat_number: "VAT number",
  website: "Website",
  industry: "Industry",
  logo_url: "Logo",
};

const orgLine = (o: OrgSummary | null) =>
  o ? `${o.legal_name ?? "(no legal name)"} — ${o.registration_number ?? "no reg. no."} — ${(o.jurisdictions ?? []).join(", ") || "no jurisdiction"}` : "—";

export const FacilitationOrganisationMergePanel: React.FC<Props> = ({ caseId, sourceOrgId, onChanged }) => {
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<OrgSummary[]>([]);
  const [source, setSource] = useState<OrgSummary | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<OrgSummary | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);
  const [canConfirm, setCanConfirm] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldsToCopy, setFieldsToCopy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from("user_roles").select("role").eq("user_id", uid).eq("role", "platform_admin").maybeSingle();
        if (!cancelled) setCanConfirm(!!data);
      } catch { /* defaults to read-only */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadCandidates() {
    setLoadingCandidates(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-organisation-merge", {
        body: { action: "list_candidates", case_id: caseId, source_org_id: sourceOrgId ?? undefined },
      });
      if (error) throw error;
      const d = data as { source?: OrgSummary | null; candidates?: OrgSummary[] };
      setSource(d?.source ?? null);
      setCandidates(d?.candidates ?? []);
      if (!d?.candidates?.length) toast.message("No duplicate candidates found from safe fields.");
    } catch (e) {
      toast.error(await friendlyFacilitationError(e, "facilitation-organisation-merge"));
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function checkEligibility(target: OrgSummary) {
    if (!sourceOrgId) { toast.error("This case is not yet linked to an organisation."); return; }
    setSelectedTarget(target);
    setReport(null);
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-organisation-merge", {
        body: { action: "check_eligibility", source_org_id: sourceOrgId, target_org_id: target.id, case_id: caseId },
      });
      if (error) throw error;
      const r = (data as { report?: Report })?.report ?? null;
      setReport(r);
      const map: Record<string, boolean> = {};
      for (const f of r?.proposed_field_handling ?? []) map[f.field] = f.will_copy;
      setFieldsToCopy(map);
    } catch (e) {
      toast.error(await friendlyFacilitationError(e, "facilitation-organisation-merge"));
    } finally {
      setChecking(false);
    }
  }

  async function confirmMerge() {
    if (!sourceOrgId || !selectedTarget || !acknowledge || reason.trim().length < 10) return;
    setSubmitting(true);
    try {
      const fields = Object.entries(fieldsToCopy).filter(([, v]) => v).map(([k]) => k);
      const { data, error } = await supabase.functions.invoke("facilitation-organisation-merge", {
        body: {
          action: "confirm_merge",
          source_org_id: sourceOrgId,
          target_org_id: selectedTarget.id,
          case_id: caseId,
          fields_to_copy: fields,
          reason: reason.trim(),
          confirmed: true,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean };
      if (!d?.ok) throw new Error("Merge was not accepted");
      toast.success("Organisation merge confirmed and recorded");
      setConfirmOpen(false);
      setAcknowledge(false);
      setReason("");
      setReport(null);
      setSelectedTarget(null);
      await onChanged();
    } catch (e) {
      toast.error(await friendlyFacilitationError(e, "facilitation-organisation-merge"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">Controlled organisation merge</h3>
          <p className="text-sm text-muted-foreground">
            Find safe duplicate-organisation candidates and, only with deliberate platform-admin
            confirmation, merge a source organisation into a surviving target organisation. No
            automatic, silent or bulk merges. Live Registry / Sanctions providers are deferred
            (Batch 14 / 15).
          </p>
        </div>
        <Button variant="secondary" onClick={loadCandidates} disabled={loadingCandidates}>
          {loadingCandidates ? "Searching…" : "Find duplicate candidates"}
        </Button>
      </div>

      {source ? (
        <div className="text-sm">
          <span className="text-muted-foreground">Source organisation: </span>
          <span className="font-medium">{orgLine(source)}</span>
          {source.already_merged ? <Badge variant="destructive" className="ml-2">Already merged</Badge> : null}
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Safe-field matches (legal name, trading name, registration number):</p>
          <ul className="divide-y border rounded-md">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 p-2">
                <div className="text-sm">
                  <div className="font-medium">{orgLine(c)}</div>
                  <div className="text-xs text-muted-foreground">
                    Status: {c.status ?? "—"}{c.frozen ? " · frozen" : ""}{c.billing_hold ? " · billing hold" : ""}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => checkEligibility(c)} disabled={checking}>
                  {checking && selectedTarget?.id === c.id ? "Checking…" : "Check merge eligibility"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report ? (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Badge variant={report.eligible ? "default" : "destructive"}>
              {report.eligible ? "Eligible to merge" : "Blocked"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Live providers deferred: {report.deferred_live_integrations.registry_kyb}; {report.deferred_live_integrations.sanctions_pep}
            </span>
          </div>

          {!report.eligible ? (
            <ul className="text-sm list-disc pl-5">
              {report.blocker_labels.map((b) => <li key={b.code}>{b.label}</li>)}
            </ul>
          ) : null}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Source (will be marked superseded)</div>
              <div className="font-medium">{orgLine(report.source)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Target (surviving record)</div>
              <div className="font-medium">{orgLine(report.target)}</div>
            </div>
          </div>

          <div className="border rounded-md p-2">
            <div className="text-xs text-muted-foreground mb-1">Safe field handling (only empty target fields may be filled — verified data is never overwritten):</div>
            <ul className="space-y-1">
              {report.proposed_field_handling.map((f) => (
                <li key={f.field} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`copy-${f.field}`}
                    checked={!!fieldsToCopy[f.field]}
                    disabled={!f.will_copy}
                    onCheckedChange={(c) => setFieldsToCopy((prev) => ({ ...prev, [f.field]: c === true }))}
                  />
                  <Label htmlFor={`copy-${f.field}`} className="cursor-pointer">
                    {FIELD_LABELS[f.field] ?? f.field}
                    <span className="text-xs text-muted-foreground"> — {f.reason}</span>
                  </Label>
                </li>
              ))}
            </ul>
            <div className="text-xs text-muted-foreground mt-2">
              Never copied: {report.fields_never_copied.join("; ")}.
            </div>
          </div>

          {report.eligible && canConfirm ? (
            <Dialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setAcknowledge(false); }}>
              <DialogTrigger asChild>
                <Button>Confirm merge…</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm organisation merge</DialogTitle>
                  <DialogDescription>
                    You are about to merge two organisation records. This action must not create a
                    WaD, payment, token movement, match, credit movement, outreach, or POI issue.
                    The source record will be preserved for audit/history and marked as superseded.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="merge-reason">Reason (recorded in audit)</Label>
                  <Textarea
                    id="merge-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Briefly explain why these two organisations are the same entity."
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox id="ack-merge" checked={acknowledge} onCheckedChange={(c) => setAcknowledge(c === true)} />
                    <Label htmlFor="ack-merge" className="text-sm">
                      I confirm this merge. No WaD, payment, token, match, credit movement,
                      outreach, or POI issue will occur.
                    </Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                  <Button
                    disabled={!acknowledge || reason.trim().length < 10 || submitting}
                    onClick={confirmMerge}
                  >
                    {submitting ? "Confirming…" : "Confirm merge"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}

          {report.eligible && !canConfirm ? (
            <p className="text-xs text-muted-foreground">
              Only a platform admin can confirm a merge. You may review eligibility only.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default FacilitationOrganisationMergePanel;
