/**
 * Batch 3 — M004 Admin claims queue. Review, approve, reject, request evidence
 * or revoke claims. Approval copy explicitly states it is NOT verification.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { X } from "lucide-react";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_CLAIM_STATE_LABEL,
  REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY,
  type RegistryClaimState,
} from "@/lib/registry-claims";

type ClaimRow = {
  id: string;
  status: RegistryClaimState;
  company_name: string;
  company_reference: string;
  country_code: string;
  claimant_name: string;
  claimant_email: string;
  created_at: string;
};

type ClaimEvent = {
  id: string;
  audit_event_name: string;
  previous_status: string | null;
  new_status: string | null;
  reason: string | null;
  created_at: string;
};

const tabClass = (active: boolean) =>
  `px-3 py-2 text-sm border-b-2 ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`;

export default function AdminRegistryClaims() {
  const loc = useLocation();
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [selected, setSelected] = useState<ClaimRow | null>(null);
  const [events, setEvents] = useState<ClaimEvent[]>([]);
  const [decision, setDecision] = useState<"approve" | "reject" | "request_evidence" | "revoke">("approve");
  const [rationale, setRationale] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("registry_company_claims")
      .select("id, status, company_name, company_reference, country_code, claimant_name, claimant_email, created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (data) setRows(data as ClaimRow[]);
  }

  useEffect(() => { load(); }, []);

  async function openSheet(row: ClaimRow) {
    setSelected(row);
    setRationale("");
    setAcknowledged(false);
    setDecision("approve");
    const { data } = await supabase
      .from("registry_company_claim_events")
      .select("id, audit_event_name, previous_status, new_status, reason, created_at")
      .eq("claim_id", row.id)
      .order("created_at", { ascending: true });
    if (data) setEvents(data as ClaimEvent[]);
  }

  async function submitReview() {
    if (!selected) return;
    if (rationale.trim().length < 20) { toast.error("Rationale must be at least 20 characters"); return; }
    if (!acknowledged) { toast.error("You must acknowledge the non-verification statement"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-company-claim", {
        body: { action: "review", claim_id: selected.id, decision, rationale, acknowledged_not_verification: true },
      });
      if (error) throw error;
      toast.success("Decision recorded");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error("Could not record decision", { description: String(err) });
    } finally { setBusy(false); }
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Registry administration</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M004" />
      <div className="flex gap-2 border-b border-border mb-4 flex-wrap">
        <Link to="/admin/registry/readiness" className={tabClass(false)}>Readiness</Link>
        <Link to="/admin/registry/decisions" className={tabClass(false)}>Decisions</Link>
        <Link to="/admin/registry/provenance" className={tabClass(false)}>Provenance</Link>
        <Link to="/admin/registry/coverage" className={tabClass(false)}>Country coverage</Link>
        <Link to="/admin/registry/imports" className={tabClass(false)}>Import batches</Link>
        <Link to="/admin/registry/claims" className={tabClass(loc.pathname.includes("claims"))}>Claims</Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Claim queue</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No claims have been submitted yet.</p>}
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{r.company_name} <span className="text-[10px] font-mono text-muted-foreground">[{r.country_code}]</span></div>
                  <div className="text-xs text-muted-foreground">{r.claimant_name} · {r.claimant_email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{REGISTRY_CLAIM_STATE_LABEL[r.status]}</Badge>
                  <Button size="sm" variant="outline" onClick={() => openSheet(r)} data-testid="admin-claim-review-open">Review</Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent>
          <SheetHeader className="flex items-start justify-between">
            <SheetTitle>Review claim — {selected?.company_name}</SheetTitle>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close"><X className="h-4 w-4" /></Button>
            </SheetClose>
          </SheetHeader>
          {selected && (
            <div className="px-4 pb-6 space-y-4 max-w-2xl mx-auto w-full">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Reference:</span> <span className="font-mono">{selected.company_reference}</span></div>
                <div><span className="text-muted-foreground">Status:</span> {REGISTRY_CLAIM_STATE_LABEL[selected.status]}</div>
                <div><span className="text-muted-foreground">Claimant:</span> {selected.claimant_name}</div>
                <div><span className="text-muted-foreground">Email:</span> {selected.claimant_email}</div>
              </div>

              <div>
                <Label className="text-xs">Decision</Label>
                <div className="flex gap-2 flex-wrap pt-1">
                  {(["approve", "reject", "request_evidence", "revoke"] as const).map((d) => (
                    <Button key={d} size="sm" variant={decision === d ? "default" : "outline"} onClick={() => setDecision(d)}>{d.replace("_", " ")}</Button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Rationale (min 20 chars)</Label>
                <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />
              </div>

              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold mb-1">Important</p>
                <p data-testid="admin-non-verification-copy">{REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY}</p>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} data-testid="admin-non-verification-ack" />
                <span>I acknowledge that this decision is not a verification of authority, profile or bank details.</span>
              </label>

              <Button onClick={submitReview} disabled={busy} data-testid="admin-claim-review-submit">Record decision</Button>

              <div className="pt-2 border-t border-border">
                <p className="text-xs font-semibold mb-2">Event history</p>
                <ul className="space-y-1">
                  {events.map((e) => (
                    <li key={e.id} className="text-[11px] font-mono text-muted-foreground">
                      {new Date(e.created_at).toISOString()} · {e.audit_event_name}{e.previous_status ? ` (${e.previous_status} → ${e.new_status ?? ""})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
