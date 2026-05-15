import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const DISPUTE_LIMIT = 200;

interface Dispute {
  id: string;
  match_id: string;
  raised_by_org_id: string;
  raised_by_user_id: string;
  reason: string;
  evidence_notes: string | null;
  status: string;
  resolution_outcome: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

const STATUS_COLOURS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  under_review: "secondary",
  resolved: "default",
  escalated: "destructive",
};

export function AdminDisputesPanel() {
  const queryClient = useQueryClient();
  const [actionDispute, setActionDispute] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: disputes = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disputes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as Dispute[]) || [];
    },
  });

  const handleResolve = async () => {
    if (!actionDispute || !resolution || !outcomeNotes.trim()) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("disputes")
        .update({
          status: resolution,
          resolution_outcome: resolution === "resolved" ? outcomeNotes.trim() : null,
          resolved_at: resolution === "resolved" ? new Date().toISOString() : null,
          resolved_by: resolution === "resolved" ? user?.id : null,
        })
        .eq("id", actionDispute.id);

      if (error) throw error;

      // If escalating, don't set resolution fields
      if (resolution === "escalated") {
        await supabase
          .from("disputes")
          .update({ evidence_notes: `${actionDispute.evidence_notes || ""}\n\n[Escalation note]: ${outcomeNotes.trim()}`.trim() })
          .eq("id", actionDispute.id);
      }

      await supabase.from("admin_audit_logs").insert({
        admin_user_id: user?.id ?? "",
        action: `dispute_${resolution}`,
        target_type: "dispute",
        target_id: actionDispute.id,
        details: {
          match_id: actionDispute.match_id,
          previous_status: actionDispute.status,
          new_status: resolution,
          notes: outcomeNotes.trim(),
        } as any,
      });

      toast.success(`Dispute ${resolution}`);
      setActionDispute(null);
      setResolution("");
      setOutcomeNotes("");
      queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
    } catch (err: any) {
      toast.error("Failed to update dispute", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const statusCounts = disputes.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <TruncationBanner data={disputes} limit={DISPUTE_LIMIT} />
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Dispute Resolution</h3>
          <p className="text-sm text-muted-foreground">
            Review and resolve disputes raised by trading partners. All decisions are audit logged.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["open", "under_review", "escalated", "resolved"].map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground capitalize">{s.replace("_", " ")}</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{statusCounts[s] || 0}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />All Disputes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : disputes.length === 0 ? (
            // Admin disputes empty: a desirable steady state. No CTA - disputes
            // are raised by counterparties, not initiated from this panel.
            <EmptyStateCard
              kicker="Resolution Queue"
              title="No active disputes"
              description="No counterparty disputes are pending review. New filings from trading partners will appear here for adjudication."
              icon={<ShieldAlert className="h-5 w-5" strokeWidth={1.75} />}
            />
          ) : (
            <>
              {/* Mobile card view */}
              <div className="space-y-3 md:hidden">
                {disputes.map((d) => (
                  <div key={d.id} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium line-clamp-2">{d.reason}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                          <span className="font-mono">#{d.id.slice(0, 8)}</span>
                          <span>·</span>
                          <span className="font-mono">match {d.match_id.slice(0, 8)}</span>
                        </div>
                      </div>
                      <Badge variant={STATUS_COLOURS[d.status] || "secondary"} className="shrink-0 text-[10px]">
                        {d.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(d.created_at), "dd MMM yyyy HH:mm")}
                      </span>
                      {(d.status === "open" || d.status === "under_review" || d.status === "escalated") ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 touch-target"
                          onClick={() => { setActionDispute(d); setResolution(""); setOutcomeNotes(""); }}
                        >
                          Resolve
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground truncate">
                          {d.resolution_outcome ? d.resolution_outcome.slice(0, 30) + (d.resolution_outcome.length > 30 ? "…" : "") : "-"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="overflow-x-auto hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Raised</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disputes.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs">{d.id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs">{d.match_id.slice(0, 8)}…</TableCell>
                        <TableCell className="max-w-[250px] truncate">{d.reason}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_COLOURS[d.status] || "secondary"}>{d.status.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{format(new Date(d.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                        <TableCell>
                          {(d.status === "open" || d.status === "under_review" || d.status === "escalated") ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setActionDispute(d); setResolution(""); setOutcomeNotes(""); }}
                            >
                              Resolve
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {d.resolution_outcome ? d.resolution_outcome.slice(0, 30) + (d.resolution_outcome.length > 30 ? "…" : "") : "-"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Resolution dialog */}
      <Dialog open={!!actionDispute} onOpenChange={(open) => { if (!open) setActionDispute(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve Dispute</DialogTitle>
            <DialogDescription>
              Dispute {actionDispute?.id.slice(0, 8)}… on match {actionDispute?.match_id.slice(0, 8)}…
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p className="font-medium">Reason: {actionDispute?.reason}</p>
              {actionDispute?.evidence_notes && (
                <p className="text-muted-foreground">Evidence: {actionDispute.evidence_notes}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Decision</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger><SelectValue placeholder="Select outcome…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">Resolved - dispute closed, settlement may proceed</SelectItem>
                  <SelectItem value="escalated">Escalated - requires Director-level review</SelectItem>
                  <SelectItem value="under_review">Under Review - investigation in progress</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resolution Notes (mandatory)</Label>
              <Textarea
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.target.value)}
                placeholder="Explain the decision and any actions taken…"
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDispute(null)}>Cancel</Button>
            <Button onClick={handleResolve} disabled={submitting || !resolution || !outcomeNotes.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm Decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
