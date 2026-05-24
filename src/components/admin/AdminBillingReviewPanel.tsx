import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DEC_007_PAY_009_ADMIN_DISCLAIMER } from "@/lib/policy/dec-007-refund-policy";

type Decision =
  | { kind: "refund_approve"; id: string }
  | { kind: "refund_decline"; id: string }
  | { kind: "dispute_won"; id: string }
  | { kind: "dispute_lost"; id: string }
  | { kind: "hold_release"; org_id: string };

export function AdminBillingReviewPanel() {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: refunds = [] } = useQuery({
    queryKey: ["admin-refund-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refund_requests" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) ?? [];
    },
  });

  const { data: disputes = [] } = useQuery({
    queryKey: ["admin-payment-disputes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_disputes" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) ?? [];
    },
  });

  const { data: holds = [] } = useQuery({
    queryKey: ["admin-billing-holds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, billing_hold, billing_hold_reason, billing_hold_applied_at")
        .eq("billing_hold", true)
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function submit() {
    if (!decision) return;
    if (reason.trim().length < 20) {
      toast.error("Reason must be at least 20 characters.");
      return;
    }
    setBusy(true);
    try {
      let fn = "", body: Record<string, unknown> = {};
      switch (decision.kind) {
        case "refund_approve": fn = "admin-refund-approve"; body = { refund_request_id: decision.id, reason }; break;
        case "refund_decline": fn = "admin-refund-decline"; body = { refund_request_id: decision.id, reason }; break;
        case "dispute_won":    fn = "admin-payment-dispute-resolve-won"; body = { payment_dispute_id: decision.id, reason }; break;
        case "dispute_lost":   fn = "admin-payment-dispute-resolve-lost"; body = { payment_dispute_id: decision.id, reason }; break;
        case "hold_release":   fn = "admin-billing-hold-release"; body = { org_id: decision.org_id, reason }; break;
      }
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      const r = data as { error?: string; code?: string };
      if (r?.error) throw new Error(r.code ?? r.error);
      toast.success("Decision recorded.");
      setDecision(null); setReason("");
      qc.invalidateQueries({ queryKey: ["admin-refund-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-payment-disputes"] });
      qc.invalidateQueries({ queryKey: ["admin-billing-holds"] });
    } catch (e) {
      toast.error("Action failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Tabs defaultValue="refunds">
        <TabsList>
          <TabsTrigger value="refunds">Refund requests ({refunds.length})</TabsTrigger>
          <TabsTrigger value="disputes">Payment disputes ({disputes.length})</TabsTrigger>
          <TabsTrigger value="holds">Billing holds ({holds.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="refunds" className="space-y-3">
          {refunds.length === 0 && <p className="text-sm text-muted-foreground">No refund requests.</p>}
          {refunds.map((r) => (
            <div key={String(r.id)} className="border border-border rounded-sm p-3 flex flex-col gap-2 bg-card">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-xs">{String(r.id).slice(0, 8)} · purchase {String(r.token_purchase_id).slice(0, 8)}</div>
                <Badge variant="outline">{String(r.status)}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Credits at request: <span className="font-mono">{String(r.credits_at_request)}</span> ·
                Used at request: <span className="font-mono">{String(r.credits_used_at_request)}</span> ·
                Reason: {String(r.reason_code)}
              </div>
              <p className="text-sm">{String(r.reason_detail)}</p>
              {r.status === "pending" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setDecision({ kind: "refund_approve", id: String(r.id) })}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setDecision({ kind: "refund_decline", id: String(r.id) })}>Decline</Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="disputes" className="space-y-3">
          {disputes.length === 0 && <p className="text-sm text-muted-foreground">No payment disputes.</p>}
          {disputes.map((d) => (
            <div key={String(d.id)} className="border border-border rounded-sm p-3 flex flex-col gap-2 bg-card">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-xs">{String(d.provider_dispute_reference)} · {String(d.provider)}</div>
                <Badge variant="outline">{String(d.status)}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Issued: <span className="font-mono">{String(d.credits_issued)}</span> ·
                Used@open: <span className="font-mono">{String(d.credits_used_at_open)}</span> ·
                Frozen: <span className="font-mono">{String(d.credits_frozen)}</span> ·
                Source: {String(d.source)}
              </div>
              {d.status === "open" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setDecision({ kind: "dispute_won", id: String(d.id) })}>Resolve won</Button>
                  <Button size="sm" variant="outline" onClick={() => setDecision({ kind: "dispute_lost", id: String(d.id) })}>Resolve lost</Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="holds" className="space-y-3">
          {holds.length === 0 && <p className="text-sm text-muted-foreground">No active billing holds.</p>}
          {holds.map((h: { id: string; name: string | null; billing_hold_reason: string | null; billing_hold_applied_at: string | null }) => (
            <div key={h.id} className="border border-border rounded-sm p-3 flex items-center justify-between gap-3 bg-card">
              <div>
                <div className="text-sm font-medium">{h.name ?? h.id}</div>
                <div className="text-xs text-muted-foreground">{h.billing_hold_reason ?? "—"} · since {h.billing_hold_applied_at ?? "—"}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setDecision({ kind: "hold_release", org_id: h.id })}>Release</Button>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!decision} onOpenChange={(o) => !o && (setDecision(null), setReason(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm decision</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground border border-border rounded-sm p-2 bg-muted/30">
            {DEC_007_PAY_009_ADMIN_DISCLAIMER}
          </p>
          <p className="text-xs">Requires AAL2-elevated session. Reason ≥ 20 characters.</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (≥ 20 chars)" rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDecision(null); setReason(""); }}>Cancel</Button>
            <Button disabled={busy || reason.trim().length < 20} onClick={submit}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
