/**
 * AdminRatingAppealsPanel - platform admin queue for counterparty rating appeals.
 *
 * Filed by org admins, resolved by platform admins. Each appeal carries the
 * full snapshot of the rating at filing time so resolutions are auditable
 * even if the score later changes.
 *
 * Resolution actions:
 *   • Mark Reviewing - claim the appeal (sets reviewing_admin_id).
 *   • Uphold       - appeal accepted; admin should follow up with manual
 *                     intervention (e.g. excluding wash-trade signals).
 *   • Dismiss      - appeal rejected with reason.
 *   • Recompute    - kicks compute-counterparty-ratings for the org.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Scale, RefreshCw } from "lucide-react";

type AppealRow = {
  id: string;
  org_id: string;
  filed_by_user_id: string;
  rating_snapshot: any;
  reason: string;
  status: "pending" | "reviewing" | "upheld" | "dismissed" | "recomputed";
  reviewing_admin_id: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_BADGE: Record<AppealRow["status"], string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  reviewing: "bg-blue-50 text-blue-800 border-blue-200",
  upheld: "bg-emerald-50 text-emerald-800 border-emerald-200",
  dismissed: "bg-muted text-muted-foreground border-border",
  recomputed: "bg-purple-50 text-purple-800 border-purple-200",
};

export function AdminRatingAppealsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [active, setActive] = useState<AppealRow | null>(null);
  const [notes, setNotes] = useState("");

  const { data: appeals = [], isLoading } = useQuery({
    queryKey: ["admin-rating-appeals", filter],
    queryFn: async () => {
      let q = supabase
        .from("rating_appeals")
        .select("*")
        .order("created_at", { ascending: false });
      if (filter === "open") q = q.in("status", ["pending", "reviewing"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AppealRow[];
    },
  });

  const resolveMut = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: AppealRow["status"]; notes: string }) => {
      const patch: Partial<AppealRow> = {
        status,
        resolution_notes: notes || null,
        reviewing_admin_id: user?.id ?? null,
      };
      if (status !== "reviewing") {
        (patch as any).resolved_at = new Date().toISOString();
      }
      const { error } = await supabase.from("rating_appeals").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-rating-appeals"] });
      setActive(null);
      setNotes("");
      toast({ title: "Appeal updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const recomputeMut = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.functions.invoke("compute-counterparty-ratings", {
        body: { orgId },
      });
      if (error) throw error;
    },
    onSuccess: (_d, orgId) => {
      toast({ title: "Recomputed", description: `Rating refreshed for org ${orgId.slice(0, 8)}…` });
      qc.invalidateQueries({ queryKey: ["counterparty-rating"] });
    },
    onError: (e: any) => toast({ title: "Recompute failed", description: e.message, variant: "destructive" }),
  });

  const counts = useMemo(() => {
    return {
      pending: appeals.filter((a) => a.status === "pending").length,
      reviewing: appeals.filter((a) => a.status === "reviewing").length,
    };
  }, [appeals]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "all")}>
          <TabsList>
            <TabsTrigger value="open">
              Open <Badge variant="secondary" className="ml-2">{counts.pending + counts.reviewing}</Badge>
            </TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading appeals…
        </div>
      )}

      {!isLoading && appeals.length === 0 && (
        <div className="border border-dashed border-border rounded-sm p-8 text-center text-sm text-muted-foreground">
          <Scale className="h-5 w-5 mx-auto mb-2 opacity-50" />
          No rating appeals {filter === "open" ? "currently open" : "on record"}.
        </div>
      )}

      {!isLoading && appeals.length > 0 && (
        <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
          {appeals.map((a) => (
            <div key={a.id} className="p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="outline" className={STATUS_BADGE[a.status]}>
                      {a.status}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      org {a.org_id.slice(0, 8)}…
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2">{a.reason}</p>
                  {a.rating_snapshot?.band && (
                    <p className="text-xs text-muted-foreground mt-1">
                      At time of filing: <span className="font-mono">{a.rating_snapshot.band}</span>
                      {a.rating_snapshot?.overall_score !== null && a.rating_snapshot?.overall_score !== undefined && (
                        <> · {Math.round(a.rating_snapshot.overall_score)}/100</>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => recomputeMut.mutate(a.org_id)}
                    disabled={recomputeMut.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1.5" /> Recompute
                  </Button>
                  <Button size="sm" onClick={() => { setActive(a); setNotes(a.resolution_notes ?? ""); }}>
                    Review
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => { if (!o) { setActive(null); setNotes(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resolve rating appeal</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-4">
              <div className="text-xs space-y-1 font-mono bg-muted/50 p-3 rounded-sm">
                <div>Org: {active.org_id}</div>
                <div>Filed: {new Date(active.created_at).toLocaleString()}</div>
                <div>Status: {active.status}</div>
              </div>
              <div>
                <p className="text-xs font-medium mb-1 text-muted-foreground">Appellant reason</p>
                <p className="text-sm whitespace-pre-wrap p-3 border border-border rounded-sm bg-card">
                  {active.reason}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium mb-1 text-muted-foreground">Snapshot at filing</p>
                <pre className="text-[11px] font-mono bg-muted/50 p-3 rounded-sm overflow-auto max-h-40">
                  {JSON.stringify(active.rating_snapshot, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium mb-1 text-muted-foreground">Resolution notes (audit trail)</p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Document your reasoning. This is permanently logged."
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {active && active.status === "pending" && (
              <Button
                variant="outline"
                onClick={() => resolveMut.mutate({ id: active.id, status: "reviewing", notes })}
                disabled={resolveMut.isPending}
              >
                Mark Reviewing
              </Button>
            )}
            {active && (
              <>
                <Button
                  variant="outline"
                  onClick={() => resolveMut.mutate({ id: active.id, status: "dismissed", notes })}
                  disabled={resolveMut.isPending || !notes.trim()}
                >
                  Dismiss
                </Button>
                <Button
                  onClick={() => resolveMut.mutate({ id: active.id, status: "upheld", notes })}
                  disabled={resolveMut.isPending || !notes.trim()}
                >
                  Uphold
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
