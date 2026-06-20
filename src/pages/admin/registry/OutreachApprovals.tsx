/**
 * Batch 6 — M014 Human approval queue UI.
 * Approving is NOT sending. Sending is a separate explicit action.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { REGISTRY_OUTREACH_NO_AUTO_SEND_COPY } from "@/lib/registry-outreach";

interface ApprovalRow {
  id: string;
  status: string;
  draft_id: string;
  rationale: string | null;
  created_at: string;
}
interface DraftRow {
  id: string;
  company_reference: string;
  recipient_label: string;
  subject: string | null;
  body: string | null;
  status: string;
}

export default function AdminRegistryOutreachApprovals() {
  const [rows, setRows] = useState<Array<ApprovalRow & { draft: DraftRow | null }>>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [sendNote, setSendNote] = useState<Record<string, string>>({});

  async function load() {
    const { data: aps } = await supabase.from("registry_outreach_approvals" as any).select("*").order("created_at", { ascending: false }).limit(50);
    const list = (aps ?? []) as unknown as ApprovalRow[];
    const draftIds = list.map(a=>a.draft_id);
    const { data: drafts } = draftIds.length
      ? await supabase.from("registry_outreach_drafts" as any).select("*").in("id", draftIds)
      : { data: [] };
    const byId = new Map<string, DraftRow>();
    for (const d of (drafts ?? []) as unknown as DraftRow[]) byId.set(d.id, d);
    setRows(list.map(a=>({ ...a, draft: byId.get(a.draft_id) ?? null })));
  }
  useEffect(()=>{ load(); }, []);

  async function decide(approvalId: string, action: "approve"|"reject"|"request_changes"|"cancel") {
    if (!ack[approvalId]) { alert("You must acknowledge the no-auto-send policy."); return; }
    setWorking(approvalId);
    try {
      const { error } = await supabase.functions.invoke("registry-outreach-review", {
        body: { action, approval_id: approvalId, rationale: rationale[approvalId] ?? "", acknowledged_no_auto_send: true },
      });
      if (error) throw error;
      await load();
    } catch (e:any) { alert(e?.message ?? "Failed"); }
    finally { setWorking(null); }
  }

  async function logSend(draftId: string, outcome: "sent"|"failed"|"no_response"|"not_sent") {
    setWorking(draftId);
    try {
      const { error } = await supabase.functions.invoke("registry-outreach-log-send", {
        body: { draft_id: draftId, outcome, send_method: "manual_external", evidence_note: sendNote[draftId] ?? "manual external send", acknowledged_no_auto_send: true },
      });
      if (error) throw error;
      await load();
    } catch (e:any) { alert(e?.message ?? "Failed"); }
    finally { setWorking(null); }
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Outreach approvals</h1>
      <div className="border border-border bg-muted/40 rounded-md p-3 mb-4 text-sm">
        <strong className="font-medium">No auto-send: </strong>{REGISTRY_OUTREACH_NO_AUTO_SEND_COPY}
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">Queue is empty.</p>}

      <div className="space-y-4">
        {rows.map(r => (
          <Card key={r.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{r.draft?.company_reference ?? "—"} → {r.draft?.recipient_label}</span>
                <span data-testid={`approval-status-${r.id}`} className="text-xs font-normal text-muted-foreground">{r.status}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{r.draft?.subject ?? "(no subject yet)"}</p>
                <pre className="text-xs whitespace-pre-wrap bg-muted/40 border border-border rounded-md p-2 mt-2 max-h-48 overflow-auto">{r.draft?.body ?? ""}</pre>
              </div>
              {["queued","in_review"].includes(r.status) && (
                <div className="space-y-2">
                  <Label>Reviewer rationale</Label>
                  <Textarea rows={2} value={rationale[r.id] ?? ""} onChange={e=>setRationale({...rationale, [r.id]: e.target.value})} />
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={!!ack[r.id]} onChange={e=>setAck({...ack, [r.id]: e.target.checked})} />
                    <span>I confirm approval does not send. Sending must be performed manually and logged separately.</span>
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" disabled={working===r.id} onClick={()=>decide(r.id,"approve")}>Approve</Button>
                    <Button size="sm" variant="secondary" disabled={working===r.id} onClick={()=>decide(r.id,"request_changes")}>Request changes</Button>
                    <Button size="sm" variant="outline" disabled={working===r.id} onClick={()=>decide(r.id,"reject")}>Reject</Button>
                    <Button size="sm" variant="ghost" disabled={working===r.id} onClick={()=>decide(r.id,"cancel")}>Cancel</Button>
                  </div>
                </div>
              )}
              {r.status === "approved" && r.draft && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Label className="text-xs">Log manual send outcome (does NOT send)</Label>
                  <Textarea rows={2} value={sendNote[r.draft.id] ?? ""} onChange={e=>setSendNote({...sendNote, [r.draft!.id]: e.target.value})} placeholder="Evidence note (required, ≥3 chars)" />
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" disabled={working===r.draft.id} onClick={()=>logSend(r.draft!.id,"sent")}>Log: Sent</Button>
                    <Button size="sm" variant="outline" disabled={working===r.draft.id} onClick={()=>logSend(r.draft!.id,"failed")}>Log: Failed</Button>
                    <Button size="sm" variant="ghost" disabled={working===r.draft.id} onClick={()=>logSend(r.draft!.id,"not_sent")}>Log: Not sent</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
