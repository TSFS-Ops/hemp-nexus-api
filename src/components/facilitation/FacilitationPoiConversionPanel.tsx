/**
 * Batch 16 — Controlled POI conversion panel (admin drawer section).
 *
 * Surfaces the eligibility report from `facilitation-poi-conversion` and
 * requires a deliberate platform_admin confirmation before any conversion
 * is recorded.
 *
 * No outreach, no payment, no token movement, no WaD, no match — this
 * panel only triggers the dedicated `facilitation-poi-conversion`
 * edge function which records a safe linkage on the facilitation case.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  onChanged: () => void | Promise<void>;
};

type Report = {
  eligible: boolean;
  blockers: string[];
  blocker_labels: Array<{ code: string; label: string }>;
  summary: Record<string, unknown>;
  deferred_live_integrations: { registry_kyb: string; sanctions_pep: string };
};

const friendlyValue = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
};

const SUMMARY_LABELS: Record<string, string> = {
  case_number: "Case number",
  requester_organisation_id: "Requester organisation",
  counterparty_legal_name: "Counterparty",
  counterparty_trading_name: "Trading name",
  jurisdiction: "Jurisdiction",
  role: "Role",
  product_or_commodity: "Product / commodity",
  authority_evidence_summary_present: "Authority evidence on file",
  manual_registry_or_kyb_status: "Manual Registry / KYB",
  manual_sanctions_pep_status: "Manual Sanctions / PEP",
  sanctions_compliance_decision: "Sanctions compliance decision",
  dnc_active: "Do-not-contact active",
  duplicate_conflict_open: "Duplicate review open",
  already_converted: "Already converted",
  internal_status: "Current status",
};

export const FacilitationPoiConversionPanel: React.FC<Props> = ({ caseId, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [canConfirm, setCanConfirm] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [poiId, setPoiId] = useState("");
  const [poiReference, setPoiReference] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      } catch { /* ignore — defaults to read-only */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function runCheck() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-poi-conversion", {
        body: { action: "check_eligibility", case_id: caseId },
      });
      if (error) throw error;
      const r = (data as { report?: Report })?.report ?? null;
      setReport(r);
      if (!r) toast.error("Eligibility check returned no report");
    } catch (e) {
      toast.error(await friendlyFacilitationError(e, "facilitation-poi-conversion"));
    } finally {
      setLoading(false);
    }
  }

  async function confirmLink() {
    if (!poiId.trim() || !reason.trim() || !acknowledge) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-poi-conversion", {
        body: {
          action: "confirm_link_existing",
          case_id: caseId,
          poi_id: poiId.trim(),
          reason: reason.trim(),
          confirmed: true,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; blockers?: string[] };
      if (!d?.ok) throw new Error("Conversion was not accepted");
      toast.success("POI conversion confirmed — existing POI linked");
      setLinkOpen(false);
      setPoiId(""); setReason(""); setAcknowledge(false);
      await onChanged();
    } catch (e) {
      toast.error(await friendlyFacilitationError(e, "facilitation-poi-conversion"));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCreateRef() {
    if (!poiReference.trim() || !reason.trim() || !acknowledge) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("facilitation-poi-conversion", {
        body: {
          action: "confirm_create_reference",
          case_id: caseId,
          poi_reference: poiReference.trim(),
          reason: reason.trim(),
          evidence_summary: evidence.trim() || null,
          confirmed: true,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean };
      if (!d?.ok) throw new Error("Conversion was not accepted");
      toast.success("POI conversion recorded");
      setRefOpen(false);
      setPoiReference(""); setReason(""); setEvidence(""); setAcknowledge(false);
      await onChanged();
    } catch (e) {
      toast.error(await friendlyFacilitationError(e, "facilitation-poi-conversion"));
    } finally {
      setSubmitting(false);
    }
  }

  const eligible = report?.eligible === true;

  return (
    <section className="border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">Controlled POI conversion</h3>
          <p className="text-sm text-muted-foreground">
            Eligibility is checked against case data, manual Registry/KYB and Sanctions/PEP records,
            do-not-contact rules and organisation status. A platform admin must deliberately confirm
            any conversion. Live Registry / Sanctions providers are deferred (Batch 14 / 15).
          </p>
        </div>
        <Button variant="secondary" onClick={runCheck} disabled={loading}>
          {loading ? "Checking…" : "Check eligibility"}
        </Button>
      </div>

      {report ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={eligible ? "default" : "destructive"}>
              {eligible ? "Eligible for conversion" : "Blocked"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Live providers deferred: {report.deferred_live_integrations.registry_kyb}; {report.deferred_live_integrations.sanctions_pep}
            </span>
          </div>

          {!eligible ? (
            <ul className="text-sm list-disc pl-5">
              {report.blocker_labels.map((b) => (
                <li key={b.code}>{b.label}</li>
              ))}
            </ul>
          ) : null}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(report.summary).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b py-1">
                <span className="text-muted-foreground">{SUMMARY_LABELS[k] ?? k}</span>
                <span className="font-medium text-right truncate">{friendlyValue(v)}</span>
              </div>
            ))}
          </div>

          {eligible && canConfirm ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {/* Link existing POI */}
              <Dialog open={linkOpen} onOpenChange={(o) => { setLinkOpen(o); if (!o) setAcknowledge(false); }}>
                <DialogTrigger asChild>
                  <Button>Link existing POI…</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm POI link</DialogTitle>
                    <DialogDescription>
                      You are about to link this facilitation case to an existing POI.
                      This will not create a WaD, payment, token movement, match, or credit movement.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="poi-id">Existing POI ID</Label>
                    <Input id="poi-id" value={poiId} onChange={(e) => setPoiId(e.target.value)} placeholder="UUID of the POI" />
                    <Label htmlFor="link-reason">Reason for linking</Label>
                    <Textarea id="link-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox id="ack-link" checked={acknowledge} onCheckedChange={(c) => setAcknowledge(c === true)} />
                      <Label htmlFor="ack-link" className="text-sm">
                        I confirm this conversion. No WaD, payment, token, match, or credit movement will occur.
                      </Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setLinkOpen(false)}>Cancel</Button>
                    <Button disabled={!poiId.trim() || !reason.trim() || !acknowledge || submitting} onClick={confirmLink}>
                      {submitting ? "Confirming…" : "Confirm link"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Record reference (safe linkage) */}
              <Dialog open={refOpen} onOpenChange={(o) => { setRefOpen(o); if (!o) setAcknowledge(false); }}>
                <DialogTrigger asChild>
                  <Button variant="outline">Record POI reference…</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm POI conversion (record reference)</DialogTitle>
                    <DialogDescription>
                      You are about to record a POI reference for this facilitation case as a safe
                      linkage record. This will not create a WaD, payment, token movement, match,
                      or credit movement. A real POI row is not inserted in this batch — trade-context
                      capture is required first.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="poi-ref">POI reference</Label>
                    <Input id="poi-ref" value={poiReference} onChange={(e) => setPoiReference(e.target.value)} placeholder="Internal POI reference" />
                    <Label htmlFor="ref-reason">Reason</Label>
                    <Textarea id="ref-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                    <Label htmlFor="ref-evidence">Evidence summary (optional)</Label>
                    <Textarea id="ref-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} />
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox id="ack-ref" checked={acknowledge} onCheckedChange={(c) => setAcknowledge(c === true)} />
                      <Label htmlFor="ack-ref" className="text-sm">
                        I confirm this conversion. No WaD, payment, token, match, or credit movement will occur.
                      </Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setRefOpen(false)}>Cancel</Button>
                    <Button disabled={!poiReference.trim() || !reason.trim() || !acknowledge || submitting} onClick={confirmCreateRef}>
                      {submitting ? "Confirming…" : "Confirm conversion"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : null}

          {eligible && !canConfirm ? (
            <p className="text-xs text-muted-foreground">
              Only a platform admin can confirm a conversion. You may review eligibility only.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Run an eligibility check to see whether this case is ready for controlled POI conversion.
        </p>
      )}
    </section>
  );
};

export default FacilitationPoiConversionPanel;
