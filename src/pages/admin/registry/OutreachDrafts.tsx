/**
 * Batch 6 — M013 admin draft generation form + queue.
 * AI may draft only. AI must never send. Mandatory copy rendered at top.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_OUTREACH_AI_DRAFT_LABEL,
  REGISTRY_OUTREACH_NO_AUTO_SEND_COPY,
  REGISTRY_OUTREACH_DRAFT_STATE_LABEL,
  type RegistryOutreachDraftState,
} from "@/lib/registry-outreach";

interface Draft {
  id: string;
  company_reference: string;
  recipient_label: string;
  channel: string;
  status: RegistryOutreachDraftState;
  reason_for_outreach: string;
  subject: string | null;
  body: string | null;
  created_at: string;
}

export default function AdminRegistryOutreachDrafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    target_kind: "claim" as "claim" | "authority" | "company",
    target_id: "",
    company_reference: "",
    country_code: "ZA",
    channel: "email" as "email" | "letter" | "internal_note",
    recipient_label: "",
    reason_for_outreach: "",
    permitted_use_basis: "",
  });

  async function load() {
    const { data, error } = await supabase
      .from("registry_outreach_drafts" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error) setDrafts((data ?? []) as unknown as Draft[]);
  }

  useEffect(() => { load(); }, []);

  async function createDraft() {
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("registry-ai-outreach-draft", {
        body: { action: "request", ...form },
      });
      if (error) throw error;
      // Auto-generate a placeholder AI draft using the form's reason as a source snippet
      const draftId = data?.draft_id;
      if (draftId) {
        await supabase.functions.invoke("registry-ai-outreach-draft", {
          body: {
            action: "generate", draft_id: draftId,
            sources: [{ source_kind: "user_supplied_reason", source_reference: "draft-request-form", snippet: form.reason_for_outreach }],
          },
        });
        await supabase.functions.invoke("registry-ai-outreach-draft", {
          body: { action: "needs_review", draft_id: draftId },
        });
      }
      await load();
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Outreach drafts</h1>
      <div className="border border-border bg-muted/40 rounded-md p-3 mb-4 text-sm">
        <strong className="font-medium">No auto-send: </strong>{REGISTRY_OUTREACH_NO_AUTO_SEND_COPY}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">New AI draft request</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Drafts are labelled {REGISTRY_OUTREACH_AI_DRAFT_LABEL.replace(/^\[|\]$/g, "")} until a human reviewer approves the wording.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Target kind</Label>
              <select className="w-full border border-input rounded-md h-9 px-2 text-sm bg-background" value={form.target_kind} onChange={(e)=>setForm({...form, target_kind: e.target.value as any})}>
                <option value="claim">Claim</option><option value="authority">Authority</option><option value="company">Company</option>
              </select>
            </div>
            <div><Label>Target ID / reference</Label><Input value={form.target_id} onChange={(e)=>setForm({...form, target_id: e.target.value})} /></div>
            <div><Label>Company reference</Label><Input value={form.company_reference} onChange={(e)=>setForm({...form, company_reference: e.target.value})} /></div>
            <div><Label>Country code</Label><Input value={form.country_code} onChange={(e)=>setForm({...form, country_code: e.target.value})} /></div>
            <div><Label>Channel</Label>
              <select className="w-full border border-input rounded-md h-9 px-2 text-sm bg-background" value={form.channel} onChange={(e)=>setForm({...form, channel: e.target.value as any})}>
                <option value="email">Email</option><option value="letter">Letter</option><option value="internal_note">Internal note</option>
              </select>
            </div>
            <div><Label>Recipient label</Label><Input value={form.recipient_label} onChange={(e)=>setForm({...form, recipient_label: e.target.value})} /></div>
          </div>
          <div><Label>Reason for outreach</Label><Textarea rows={3} value={form.reason_for_outreach} onChange={(e)=>setForm({...form, reason_for_outreach: e.target.value})} /></div>
          <div><Label>Permitted-use basis</Label><Input value={form.permitted_use_basis} onChange={(e)=>setForm({...form, permitted_use_basis: e.target.value})} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={createDraft} disabled={busy}>{busy ? "Working…" : "Request AI draft"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent drafts</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pb-2">Company</th><th>Recipient</th><th>Channel</th><th>Status</th></tr>
            </thead>
            <tbody>
              {drafts.map(d=>(
                <tr key={d.id} className="border-t border-border">
                  <td className="py-2">{d.company_reference}</td>
                  <td>{d.recipient_label}</td>
                  <td>{d.channel}</td>
                  <td data-testid={`draft-status-${d.id}`}>{REGISTRY_OUTREACH_DRAFT_STATE_LABEL[d.status] ?? d.status}</td>
                </tr>
              ))}
              {drafts.length === 0 && <tr><td colSpan={4} className="py-3 text-muted-foreground">No drafts yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
