/**
 * Batch 4 — M005 Admin authority queue + review drawer.
 *
 * Canonical non-verification copy (rendered verbatim below and pinned by
 * scripts/check-registry-batch4-wording.mjs):
 *   "Approving authority confirms only that this person may act for the company within the recorded scope. It does not verify the company profile or any bank details."
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { X } from "lucide-react";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_AUTHORITY_STATE_LABEL,
  REGISTRY_AUTHORITY_APPROVAL_NON_VERIFICATION_COPY,
  type RegistryAuthorityState,
} from "@/lib/registry-authority";

type Row = {
  id: string; status: RegistryAuthorityState; company_name: string; company_reference: string;
  representative_name: string; representative_email: string; authority_basis: string; created_at: string;
};

type Decision = "approve" | "conditionally_approve" | "reject" | "revoke" | "dispute";

export default function AdminRegistryAuthority() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [decision, setDecision] = useState<Decision>("approve");
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");
  const [expiry, setExpiry] = useState("");
  const [ackCompany, setAckCompany] = useState(false);
  const [ackBank, setAckBank] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("registry_authority_requests")
      .select("id, status, company_name, company_reference, representative_name, representative_email, authority_basis, created_at")
      .order("created_at", { ascending: false }).limit(100);
    setRows((data as Row[] | null) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function review() {
    if (!open) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-authority-review", {
        body: {
          authority_request_id: open.id, decision, rationale, conditions: conditions || undefined,
          expiry_at: expiry ? new Date(expiry).toISOString() : undefined,
          acknowledged_not_company_verification: true, acknowledged_not_bank_verification: true,
        },
      });
      if (error) throw error;
      toast.success("Authority reviewed");
      setOpen(null); setRationale(""); setConditions(""); setExpiry(""); setAckCompany(false); setAckBank(false);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Authority review queue</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M005" />
      <Card>
        <CardHeader><CardTitle className="text-base">Pending and recent authority requests</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th>Company</th><th>Representative</th><th>Basis</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2">{r.company_name}<br /><span className="text-xs text-muted-foreground">{r.company_reference}</span></td>
                  <td>{r.representative_name}<br /><span className="text-xs text-muted-foreground">{r.representative_email}</span></td>
                  <td className="text-xs">{r.authority_basis.replace(/_/g, " ")}</td>
                  <td><Badge>{REGISTRY_AUTHORITY_STATE_LABEL[r.status]}</Badge></td>
                  <td><Button size="sm" variant="outline" onClick={() => setOpen(r)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-[480px] sm:w-[560px]">
          <SheetHeader>
            <SheetTitle>Review authority request</SheetTitle>
            <SheetClose className="absolute right-4 top-4"><X className="h-4 w-4" /></SheetClose>
          </SheetHeader>
          {open && (
            <div className="space-y-3 mt-4">
              <div className="text-sm">{open.company_name}</div>
              <div>
                <Label>Decision</Label>
                <select className="w-full border border-input rounded-md h-10 px-3 text-sm bg-background" value={decision} onChange={(e) => setDecision(e.target.value as Decision)}>
                  <option value="approve">Approve</option>
                  <option value="conditionally_approve">Conditionally approve</option>
                  <option value="reject">Reject</option>
                  <option value="revoke">Revoke</option>
                  <option value="dispute">Dispute</option>
                </select>
              </div>
              <div><Label>Rationale (≥ 20 chars)</Label><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4} /></div>
              <div><Label>Conditions (optional)</Label><Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} rows={2} /></div>
              <div><Label>Expiry (optional)</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              <div className="rounded border bg-muted/30 p-3 text-xs">{REGISTRY_AUTHORITY_APPROVAL_NON_VERIFICATION_COPY}</div>
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={ackCompany} onCheckedChange={(v) => setAckCompany(!!v)} /> I acknowledge this does not verify the company profile.</label>
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={ackBank} onCheckedChange={(v) => setAckBank(!!v)} /> I acknowledge this does not verify any bank details.</label>
              <Button onClick={review} disabled={busy || rationale.length < 20 || !ackCompany || !ackBank}>Record decision</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
