/**
 * Batch 4 — M006 / M007 Admin bank-detail queue + status transition drawer.
 *
 * Mandatory copy (pinned by scripts/check-registry-batch4-wording.mjs):
 *   "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry."
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { X } from "lucide-react";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_BANK_DETAIL_STATES,
  REGISTRY_BANK_DETAIL_STATE_LABEL,
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  type RegistryBankDetailState,
} from "@/lib/registry-bank-details";

type Row = {
  id: string; status: RegistryBankDetailState; company_name: string; company_reference: string;
  masked_bank_name: string | null; masked_account_number: string | null; masked_iban: string | null;
  verified_at: string | null; expiry_at: string | null; created_at: string;
};

export default function AdminRegistryBankDetails() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [next, setNext] = useState<RegistryBankDetailState>("verification_pending");
  const [rationale, setRationale] = useState("");
  const [method, setMethod] = useState("");
  const [expiry, setExpiry] = useState("");
  const [unmaskReason, setUnmaskReason] = useState("");
  const [unmasked, setUnmasked] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("registry_bank_detail_submissions")
      .select("id, status, company_name, company_reference, masked_bank_name, masked_account_number, masked_iban, verified_at, expiry_at, created_at")
      .order("created_at", { ascending: false }).limit(100);
    setRows((data as Row[] | null) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function transition() {
    if (!open) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-bank-detail-status-transition", {
        body: {
          submission_id: open.id, next_status: next, rationale,
          verification_method: method || undefined,
          expiry_at: expiry ? new Date(expiry).toISOString() : undefined,
        },
      });
      if (error) throw error;
      toast.success(`Status changed to ${next}`);
      setOpen(null); setRationale(""); setMethod(""); setExpiry(""); setUnmasked(null);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function requestUnmask() {
    if (!open) return;
    if (unmaskReason.length < 20) { toast.error("Reason ≥ 20 characters required"); return; }
    const { error, data } = await supabase.functions.invoke("registry-bank-detail-access", {
      body: { submission_id: open.id, mode: "read_unmasked", reason: unmaskReason },
    });
    if (error) { toast.error(error.message); return; }
    const d = data as { unmasked?: Record<string, string> };
    if (d.unmasked) setUnmasked(d.unmasked);
    toast.success("Unmasked view logged");
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Bank-detail submissions</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M007" />
      <Alert className="mb-4">
        <AlertTitle>Captured does not mean verified</AlertTitle>
        <AlertDescription className="text-xs">{REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Submissions (masked)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th>Company</th><th>Bank</th><th>Masked account</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2">{r.company_name}<br /><span className="text-xs text-muted-foreground">{r.company_reference}</span></td>
                  <td>{r.masked_bank_name ?? "—"}</td>
                  <td className="font-mono text-xs">{r.masked_account_number ?? r.masked_iban ?? "—"}</td>
                  <td><Badge>{REGISTRY_BANK_DETAIL_STATE_LABEL[r.status]}</Badge></td>
                  <td><Button size="sm" variant="outline" onClick={() => setOpen(r)}>Manage</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-[480px] sm:w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Bank-detail submission</SheetTitle>
            <SheetClose className="absolute right-4 top-4"><X className="h-4 w-4" /></SheetClose>
          </SheetHeader>
          {open && (
            <div className="space-y-4 mt-4">
              <div className="text-sm">{open.company_name} · {open.company_reference}</div>
              <div className="text-xs text-muted-foreground">Current status: {REGISTRY_BANK_DETAIL_STATE_LABEL[open.status]}</div>

              <Card>
                <CardHeader><CardTitle className="text-sm">Status transition</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <Label>Next status</Label>
                    <select className="w-full border border-input rounded-md h-10 px-3 text-sm bg-background" value={next} onChange={(e) => setNext(e.target.value as RegistryBankDetailState)}>
                      {REGISTRY_BANK_DETAIL_STATES.map((s) => <option key={s} value={s}>{REGISTRY_BANK_DETAIL_STATE_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div><Label>Rationale (≥ 10 chars)</Label><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} /></div>
                  {next === "verified" && (
                    <>
                      <div className="rounded border bg-amber-50 p-2 text-xs">Marked-verified requires verification method, expiry, audited verifier.</div>
                      <div><Label>Verification method</Label><Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. mandate_letter_cross_check" /></div>
                      <div><Label>Expiry</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
                    </>
                  )}
                  <Button onClick={transition} disabled={busy || rationale.length < 10}>Record transition</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Unmasked access (audited)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs text-muted-foreground">Unmasked access is audited and requires a written reason ≥ 20 characters.</div>
                  <Textarea value={unmaskReason} onChange={(e) => setUnmaskReason(e.target.value)} rows={2} placeholder="Reason" />
                  <Button size="sm" variant="outline" onClick={requestUnmask}>Reveal (audited)</Button>
                  {unmasked && (
                    <div className="text-xs font-mono bg-muted rounded p-2 space-y-1">
                      {Object.entries(unmasked).filter(([, v]) => v).map(([k, v]) => <div key={k}>{k}: {v}</div>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
