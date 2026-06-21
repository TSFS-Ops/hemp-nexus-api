/**
 * Batch 11 — Admin claim review queue (batch-11 surface) at
 * /admin/registry/claims-review. Sits alongside the Batch 3
 * /admin/registry/claims page without disturbing it.
 *
 * Admin approval requires acknowledgement that approval does not verify
 * authority-to-act, company profile accuracy or bank details.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  REGISTRY_CLAIM_ADMIN_APPROVAL_ACK,
  REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE,
  REGISTRY_CLAIM_REVIEW_ACTIONS,
} from "@/lib/registry-claim-workflow";

type Row = {
  id: string;
  workflow_status: string;
  company_name: string;
  company_reference: string;
  country_code: string;
  claimant_name: string;
  claimant_type: string | null;
  sla_due_at: string | null;
  assigned_reviewer_user_id: string | null;
  created_at: string;
};

export default function AdminRegistryClaimsReview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCountry, setFilterCountry] = useState<string>("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [action, setAction] = useState<(typeof REGISTRY_CLAIM_REVIEW_ACTIONS)[number]>("start_review");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    let q = supabase.from("registry_company_claims")
      .select("id, workflow_status, company_name, company_reference, country_code, claimant_name, claimant_type, sla_due_at, assigned_reviewer_user_id, created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (filterStatus) q = q.eq("workflow_status", filterStatus);
    if (filterCountry) q = q.eq("country_code", filterCountry);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStatus, filterCountry]);

  async function submitAction() {
    if (!selected) return;
    if (action === "approve_claim" && !ack) {
      toast.error("You must acknowledge the non-verification statement.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-claim-review", {
        body: {
          claim_id: selected.id,
          action,
          reason: reason || undefined,
          acknowledged_not_verification: action === "approve_claim" ? true : undefined,
        },
      });
      if (error) throw error;
      toast.success(`Action ${action} recorded`);
      setReason(""); setAck(false);
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <ReadinessBanner state="shell_ready" />
      <Card>
        <CardHeader>
          <CardTitle>Claims review (Batch 11)</CardTitle>
          <p className="text-xs text-muted-foreground">
            {REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Filter status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="max-w-xs" />
            <Input placeholder="Filter country" value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)} className="max-w-xs" />
          </div>
          <div className="space-y-2">
            {rows.map((r) => (
              <button key={r.id} onClick={() => setSelected(r)}
                className={`w-full text-left border rounded p-3 hover:bg-muted ${selected?.id === r.id ? "border-primary" : ""}`}>
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{r.company_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.claimant_name} · {r.claimant_type ?? "—"} · {r.country_code}
                    </div>
                  </div>
                  <Badge variant="outline">{r.workflow_status}</Badge>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader><CardTitle>Review {selected.company_name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Action</Label>
              <select className="w-full border rounded p-2 mt-1" value={action} onChange={(e) => setAction(e.target.value as never)}>
                {REGISTRY_CLAIM_REVIEW_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required for most actions)" />
            </div>
            {action === "approve_claim" && (
              <div className="flex items-start gap-2 p-3 border rounded bg-muted">
                <Checkbox id="ack" checked={ack} onCheckedChange={(v) => setAck(!!v)} />
                <Label htmlFor="ack" className="text-sm">{REGISTRY_CLAIM_ADMIN_APPROVAL_ACK}</Label>
              </div>
            )}
            <Button disabled={busy} onClick={submitAction}>Submit action</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
