/**
 * Batch 11 — Claimant-facing claim status detail at /registry/claims/:claimId.
 * Shows evidence checklist, status, SLA, audit events, and allows cancel.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE,
  REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING,
  REGISTRY_CLAIM_REJECTION_PUBLIC_WORDING,
} from "@/lib/registry-claim-workflow";

export default function RegistryClaimStatus() {
  const { claimId } = useParams();
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!claimId) return;
    const { data, error } = await supabase.functions.invoke("registry-claim-status", { body: { claim_id: claimId } });
    if (error) { toast.error(error.message); return; }
    setState(data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [claimId]);

  async function cancel() {
    if (!claimId) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-claim-review", {
        body: { claim_id: claimId, action: "cancel_claim", reason: "Cancelled by claimant" },
      });
      if (error) throw error;
      toast.success("Claim cancelled");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  if (!state) return <div className="container mx-auto py-8"><ReadinessBanner state="shell_ready" />Loading…</div>;
  const c = state.claim;
  const isApproved = c.workflow_status === "approved";
  const isRejected = c.workflow_status === "rejected";

  return (
    <div className="container mx-auto py-8 space-y-6">
      <ReadinessBanner state="shell_ready" />
      <Card>
        <CardHeader>
          <CardTitle>{c.company_name}</CardTitle>
          <div className="flex gap-2 mt-2">
            <Badge variant="outline">{c.workflow_status}</Badge>
            {c.sla_due_at && <Badge variant="secondary">SLA: {new Date(c.sla_due_at).toLocaleDateString()}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isApproved && (
            <div className="p-3 rounded border bg-muted">
              <p className="text-sm font-medium">{REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING}</p>
              <p className="text-xs text-muted-foreground mt-2">Next step: you may request authority-to-act separately.</p>
            </div>
          )}
          {isRejected && (
            <div className="p-3 rounded border bg-muted">
              <p className="text-sm font-medium">{REGISTRY_CLAIM_REJECTION_PUBLIC_WORDING}</p>
              {c.rejection_reason && <p className="text-xs text-muted-foreground mt-2">Reason: {c.rejection_reason}</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {state.evidence.length === 0 && <p className="text-sm text-muted-foreground">No evidence uploaded.</p>}
          {state.evidence.map((e: any) => (
            <div key={e.id} className="border rounded p-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{e.document_name || e.category}</span>
                <Badge variant="outline">{e.evidence_state}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{e.category}{e.sensitive ? " · sensitive" : ""}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {state.events.map((ev: any, i: number) => (
            <div key={i} className="text-xs flex justify-between">
              <span>{ev.audit_event_name}</span>
              <span className="text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {!isApproved && !isRejected && (
        <Button variant="destructive" disabled={busy} onClick={cancel}>Cancel claim</Button>
      )}
    </div>
  );
}
