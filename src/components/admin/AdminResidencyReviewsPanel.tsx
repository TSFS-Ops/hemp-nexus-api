import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  RESIDENCY_ADMIN_REASON_MIN_LENGTH,
  RESIDENCY_DECISION_WARNING_COPY,
} from "@/lib/policy/data-residency-policy";

interface ReviewRow {
  id: string;
  org_id: string;
  requirement_source: string;
  requested_region: string | null;
  requested_country: string | null;
  legal_basis: string | null;
  status: string;
  created_at: string;
}

export function AdminResidencyReviewsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<{ id: string; action: "approve" | "decline" } | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("data_residency_reviews")
        .select("id,org_id,requirement_source,requested_region,requested_country,legal_basis,status,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setRows((data ?? []) as ReviewRow[]);
    } catch (e) {
      toast({ title: "Failed to load", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function decide() {
    if (!open) return;
    if (reason.trim().length < RESIDENCY_ADMIN_REASON_MIN_LENGTH) {
      toast({ title: "Reason too short", description: `Provide at least ${RESIDENCY_ADMIN_REASON_MIN_LENGTH} characters.`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fn = open.action === "approve"
        ? "admin-residency-review-approve"
        : "admin-residency-review-decline";
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { review_id: open.id, reason: reason.trim() },
      });
      if (error) throw error;
      toast({ title: `Review ${open.action}d`, description: `Status: ${(data as { status?: string })?.status ?? "ok"}` });
      setOpen(null); setReason("");
      void load();
    } catch (e) {
      toast({ title: "Action failed", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Residency Reviews (DATA-009 Phase 2)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Approval records the policy exception only. It does NOT trigger any technical hosting, region migration, backup, export or deletion control.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No residency reviews recorded.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded border p-3 text-sm">
                <div className="space-y-0.5">
                  <div className="font-mono text-xs">{r.org_id}</div>
                  <div>
                    <Badge variant="outline">{r.status}</Badge>{" "}
                    <span className="text-muted-foreground">{r.requirement_source}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    region: {r.requested_region ?? "—"} · country: {r.requested_country ?? "—"} · {new Date(r.created_at).toLocaleString()}
                  </div>
                  {r.legal_basis && <div className="text-xs">basis: {r.legal_basis}</div>}
                </div>
                {r.status === "review_required" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setReason(""); setOpen({ id: r.id, action: "approve" }); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => { setReason(""); setOpen({ id: r.id, action: "decline" }); }}>Decline</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Dialog open={!!open} onOpenChange={(o) => { if (!o) { setOpen(null); setReason(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{open?.action === "approve" ? "Approve" : "Decline"} residency review</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
              {RESIDENCY_DECISION_WARNING_COPY}
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Reason (minimum ${RESIDENCY_ADMIN_REASON_MIN_LENGTH} characters)`}
              rows={5}
            />
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
              <Button onClick={decide} disabled={submitting || reason.trim().length < RESIDENCY_ADMIN_REASON_MIN_LENGTH}>
                {submitting ? "Submitting…" : open?.action === "approve" ? "Approve" : "Decline"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default AdminResidencyReviewsPanel;
