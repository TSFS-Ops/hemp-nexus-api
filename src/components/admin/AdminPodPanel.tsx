/**
 * AdminPodPanel — Full admin UI for Proof-of-Delivery management.
 * Covers pod creation, milestone CRUD with dependency sequencing,
 * breach monitoring, and milestone completion workflow.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Milestone, AlertTriangle, CheckCircle, RefreshCw, Plus, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ErrorState } from "@/components/ui/error-state";
import { toast } from "sonner";

interface Pod {
  id: string;
  org_id: string;
  wad_id: string;
  state: string;
  created_at: string;
  finalised_at: string | null;
}

interface PodMilestone {
  id: string;
  pod_id: string;
  name: string;
  status: string;
  due_at: string;
  completed_at: string | null;
  detected_deficiency_at: string | null;
  depends_on: string | null;
}

interface Breach {
  id: string;
  pod_id: string;
  org_id: string;
  milestone_id: string | null;
  reason: string;
  status: string;
  severity: string;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  notification_sent_at: string | null;
  escalated_at: string | null;
}

const POD_STATE_COLOURS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  IN_PROGRESS: "outline",
  FINALISED: "default",
  BREACHED: "destructive",
  CANCELLED: "secondary",
};

const MS_STATUS_COLOURS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  completed: "default",
  deficient: "destructive",
};

export function AdminPodPanel() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [milestones, setMilestones] = useState<PodMilestone[]>([]);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [podRes, msRes, brRes] = await Promise.all([
        supabase.from("pods").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("pod_milestones").select("*").order("due_at", { ascending: true }).limit(500),
        supabase.from("breaches").select("*").order("detected_at", { ascending: false }).limit(100),
      ]);
      if (podRes.error) throw podRes.error;
      if (msRes.error) throw msRes.error;
      if (brRes.error) throw brRes.error;
      setPods((podRes.data as Pod[]) || []);
      setMilestones((msRes.data as PodMilestone[]) || []);
      setBreaches((brRes.data as Breach[]) || []);
    } catch (err) {
      console.error("[AdminPodPanel] fetch failed:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load PoD data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (fetchError) {
    return <ErrorState title="Failed to load PoD data" message={fetchError} type="server" onRetry={fetchData} />;
  }

  const podCounts = pods.reduce((acc, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Proof-of-Delivery (PoD)</h2>
          <p className="text-muted-foreground mt-1">
            Milestone tracking, breach detection, and delivery finalisation
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" /> In Progress
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{podCounts["IN_PROGRESS"] || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" /> Finalised
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{podCounts["FINALISED"] || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Breached
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{podCounts["BREACHED"] || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Milestone className="h-4 w-4" /> Total Milestones
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{milestones.length}</p></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pods">
        <TabsList>
          <TabsTrigger value="pods">PoDs</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="breaches">Breaches</TabsTrigger>
        </TabsList>

        <TabsContent value="pods">
          <PodsTab pods={pods} milestones={milestones} onRefresh={fetchData} />
        </TabsContent>

        <TabsContent value="milestones">
          <MilestonesTab milestones={milestones} pods={pods} onRefresh={fetchData} />
        </TabsContent>

        <TabsContent value="breaches">
          <BreachesTab breaches={breaches} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Pods Tab ─────────────────────────────────────────────── */

function PodsTab({ pods, milestones, onRefresh }: { pods: Pod[]; milestones: PodMilestone[]; onRefresh: () => void }) {
  const [showAddMilestone, setShowAddMilestone] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>WaD</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Milestones</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Finalised</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pods.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">No PoDs created yet</TableCell>
              </TableRow>
            ) : pods.map((p) => {
              const podMs = milestones.filter(m => m.pod_id === p.id);
              const doneCount = podMs.filter(m => m.status === "completed").length;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs">{p.wad_id.slice(0, 8)}…</TableCell>
                  <TableCell><Badge variant={POD_STATE_COLOURS[p.state] || "secondary"}>{p.state}</Badge></TableCell>
                  <TableCell>
                    <span className="text-sm">{doneCount}/{podMs.length}</span>
                  </TableCell>
                  <TableCell>{format(new Date(p.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell>{p.finalised_at ? format(new Date(p.finalised_at), "dd MMM yyyy HH:mm") : "—"}</TableCell>
                  <TableCell>
                    {p.state === "IN_PROGRESS" && (
                      <Dialog open={showAddMilestone === p.id} onOpenChange={(open) => setShowAddMilestone(open ? p.id : null)}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs">
                            <Plus className="h-3 w-3 mr-1" />
                            Milestone
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Add Milestone to PoD {p.id.slice(0, 8)}…</DialogTitle>
                          </DialogHeader>
                          <AddMilestoneForm
                            podId={p.id}
                            orgId={p.org_id}
                            existingMilestones={podMs}
                            onSuccess={() => { setShowAddMilestone(null); onRefresh(); }}
                          />
                        </DialogContent>
                      </Dialog>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Milestones Tab ───────────────────────────────────────── */

function MilestonesTab({ milestones, pods, onRefresh }: { milestones: PodMilestone[]; pods: Pod[]; onRefresh: () => void }) {
  const [completing, setCompleting] = useState<string | null>(null);

  const completeMilestone = async (ms: PodMilestone) => {
    // Check dependency
    if (ms.depends_on) {
      const dep = milestones.find(m => m.id === ms.depends_on);
      if (dep && dep.status !== "completed") {
        toast.error("Dependency not met", {
          description: `"${dep.name}" must be completed first.`,
        });
        return;
      }
    }

    setCompleting(ms.id);
    try {
      const { data: updated, error } = await supabase
        .from("pod_milestones")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", ms.id)
        .eq("status", "pending")
        .select();

      if (error) throw error;
      if (!updated || updated.length === 0) {
        toast.error("Milestone was not updated", {
          description: "It may have already been completed or access was denied.",
        });
        return;
      }
      toast.success(`Milestone "${ms.name}" completed`);
      onRefresh();
    } catch (err: any) {
      toast.error("Failed to complete milestone", { description: err.message });
    } finally {
      setCompleting(null);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>PoD</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Depends On</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {milestones.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">No milestones yet</TableCell>
              </TableRow>
            ) : milestones.map((m) => {
              const depName = m.depends_on ? milestones.find(d => d.id === m.depends_on)?.name : null;
              const depMet = !m.depends_on || milestones.find(d => d.id === m.depends_on)?.status === "completed";
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.id.slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs">{m.pod_id.slice(0, 8)}…</TableCell>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>
                    {depName ? (
                      <span className="text-xs text-muted-foreground">{depName}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">None</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={MS_STATUS_COLOURS[m.status] || "secondary"}>{m.status}</Badge></TableCell>
                  <TableCell>{format(new Date(m.due_at), "dd MMM yyyy")}</TableCell>
                  <TableCell>{m.completed_at ? format(new Date(m.completed_at), "dd MMM yyyy HH:mm") : "—"}</TableCell>
                  <TableCell>
                    {m.status === "pending" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!depMet || completing === m.id}
                        onClick={() => completeMilestone(m)}
                        title={!depMet ? `Blocked: "${depName}" must be completed first` : "Mark as complete"}
                      >
                        {completing === m.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Play className="h-3 w-3 mr-1" />
                        )}
                        Complete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Breaches Tab ─────────────────────────────────────────── */

function BreachesTab({ breaches }: { breaches: Breach[] }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>PoD</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Detected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breaches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">No breaches recorded</TableCell>
              </TableRow>
            ) : breaches.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.id.slice(0, 8)}…</TableCell>
                <TableCell className="font-mono text-xs">{b.pod_id.slice(0, 8)}…</TableCell>
                <TableCell className="max-w-[300px] truncate">{b.reason}</TableCell>
                <TableCell>
                  <Badge variant={b.status === "open" ? "destructive" : "default"}>{b.status}</Badge>
                </TableCell>
                <TableCell>{format(new Date(b.detected_at), "dd MMM yyyy HH:mm")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Add Milestone Form ───────────────────────────────────── */

function AddMilestoneForm({
  podId,
  orgId,
  existingMilestones,
  onSuccess,
}: {
  podId: string;
  orgId: string;
  existingMilestones: PodMilestone[];
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [dependsOn, setDependsOn] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !dueAt) {
      toast.error("Name and due date are required");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("pod_milestones").insert({
        pod_id: podId,
        name: name.trim(),
        due_at: new Date(dueAt).toISOString(),
        status: "pending",
        depends_on: dependsOn === "none" ? null : dependsOn,
      } as any);
      if (error) throw error;
      toast.success(`Milestone "${name.trim()}" added`);
      onSuccess();
    } catch (err: any) {
      toast.error("Failed to add milestone", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Milestone Name *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vessel Arrival Confirmation" />
      </div>
      <div className="space-y-2">
        <Label>Due Date *</Label>
        <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Depends On (optional)</Label>
        <Select value={dependsOn} onValueChange={setDependsOn}>
          <SelectTrigger>
            <SelectValue placeholder="No dependency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No dependency</SelectItem>
            {existingMilestones.map((ms) => (
              <SelectItem key={ms.id} value={ms.id}>
                {ms.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          If set, this milestone cannot be completed until the dependency is resolved.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={submitting || !name.trim() || !dueAt}>
        {submitting ? "Adding…" : "Add Milestone"}
      </Button>
    </form>
  );
}
