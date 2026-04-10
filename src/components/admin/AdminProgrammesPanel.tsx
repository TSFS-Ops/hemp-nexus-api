import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Landmark, Users, Target, ArrowRightLeft, FileText, CheckCircle2, Clock, AlertTriangle, Hash } from "lucide-react";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  active: "default",
  reporting: "outline",
  closed: "destructive",
  pending: "secondary",
  eligible: "outline",
  approved: "default",
  suspended: "destructive",
  in_progress: "outline",
  completed: "default",
  overdue: "destructive",
  disputed: "destructive",
  allocation: "secondary",
  commitment: "outline",
  disbursement: "default",
  return: "destructive",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 0 }).format(amount);
}

// ─── Programme List ─────────────────────────────────────────────────

function ProgrammeList({ onSelect }: { onSelect: (id: string) => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: programmes, isLoading } = useQuery({
    queryKey: ["admin-programmes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("programmes").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: { name: string; department: string; fiscal_year: string; budget_allocated: number }) => {
      const { data, error } = await supabase.from("programmes").insert({
        ...values,
        org_id: (await supabase.auth.getUser()).data.user?.user_metadata?.org_id,
        status: "draft",
      }).select().single();
      // Fallback: use edge function if direct insert fails due to missing org_id
      if (error) {
        const { data: fnData, error: fnError } = await supabase.functions.invoke("programmes", {
          method: "POST",
          body: values,
        });
        if (fnError) throw fnError;
        return fnData;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-programmes"] });
      setShowCreate(false);
      toast.success("Programme created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [form, setForm] = useState({ name: "", department: "", fiscal_year: "", budget_allocated: "" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Programmes</h3>
          <Badge variant="secondary">{programmes?.length || 0}</Badge>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Programme</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Programme</DialogTitle></DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({
                  name: form.name,
                  department: form.department,
                  fiscal_year: form.fiscal_year,
                  budget_allocated: parseFloat(form.budget_allocated) || 0,
                });
              }}
            >
              <div><Label>Programme Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} required /></div>
              <div><Label>Fiscal Year</Label><Input value={form.fiscal_year} onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })} placeholder="2025/2026" required /></div>
              <div><Label>Budget Allocated (ZAR)</Label><Input type="number" value={form.budget_allocated} onChange={(e) => setForm({ ...form, budget_allocated: e.target.value })} /></div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create Programme"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !programmes?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No programmes yet. Create one to get started.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {programmes.map((p: any) => (
            <Card key={p.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => onSelect(p.id)}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.department} · {p.fiscal_year}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{formatCurrency(p.budget_allocated)}</span>
                    <Badge variant={STATUS_COLORS[p.status] as any || "secondary"}>{p.status}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Programme Detail ───────────────────────────────────────────────

function ProgrammeDetail({ programmeId, onBack }: { programmeId: string; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: programme } = useQuery({
    queryKey: ["admin-programme", programmeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("programmes").select("*").eq("id", programmeId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: participants } = useQuery({
    queryKey: ["admin-programme-participants", programmeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("programme_participants")
        .select("*, entities(legal_name, entity_type)")
        .eq("programme_id", programmeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: milestones } = useQuery({
    queryKey: ["admin-programme-milestones", programmeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("programme_milestones")
        .select("*")
        .eq("programme_id", programmeId)
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: fundFlows } = useQuery({
    queryKey: ["admin-programme-fund-flows", programmeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fund_flows")
        .select("*")
        .eq("programme_id", programmeId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const { error } = await supabase.from("programmes").update({ status: newStatus }).eq("id", programmeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-programme", programmeId] });
      queryClient.invalidateQueries({ queryKey: ["admin-programmes"] });
      toast.success("Programme status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!programme) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const completedMilestones = milestones?.filter((m: any) => m.status === "completed").length || 0;
  const overdueMilestones = milestones?.filter((m: any) => m.status === "overdue").length || 0;
  const totalDisbursed = fundFlows?.filter((f: any) => f.flow_type === "disbursement").reduce((s: number, f: any) => s + Number(f.amount), 0) || 0;
  const totalCommitted = fundFlows?.filter((f: any) => f.flow_type === "commitment").reduce((s: number, f: any) => s + Number(f.amount), 0) || 0;

  // Hash chain verification
  let chainValid = true;
  if (fundFlows && fundFlows.length > 0) {
    for (let i = 0; i < fundFlows.length; i++) {
      if (i === 0 && fundFlows[i].previous_hash !== null) { chainValid = false; break; }
      if (i > 0 && fundFlows[i].previous_hash !== fundFlows[i - 1].payload_hash) { chainValid = false; break; }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <h3 className="text-lg font-semibold">{programme.name}</h3>
        <Badge variant={STATUS_COLORS[programme.status] as any || "secondary"}>{programme.status}</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Allocated</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><p className="text-lg font-mono font-semibold">{formatCurrency(programme.budget_allocated)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Committed</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><p className="text-lg font-mono font-semibold">{formatCurrency(totalCommitted)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Disbursed</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><p className="text-lg font-mono font-semibold">{formatCurrency(totalDisbursed)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Milestones</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3">
            <p className="text-lg font-semibold">{completedMilestones}/{milestones?.length || 0}</p>
            {overdueMilestones > 0 && <p className="text-xs text-destructive">{overdueMilestones} overdue</p>}
          </CardContent>
        </Card>
      </div>

      {/* Status Actions */}
      <Card>
        <CardContent className="py-3 px-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-2">Transition:</span>
          {["draft", "active", "reporting", "closed"].filter((s) => s !== programme.status).map((s) => (
            <Button key={s} variant="outline" size="sm" onClick={() => statusMutation.mutate(s)} disabled={statusMutation.isPending}>
              → {s}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Tabs defaultValue="participants">
        <TabsList className="w-max">
          <TabsTrigger value="participants"><Users className="h-3.5 w-3.5 mr-1" /> Participants ({participants?.length || 0})</TabsTrigger>
          <TabsTrigger value="milestones"><Target className="h-3.5 w-3.5 mr-1" /> Milestones ({milestones?.length || 0})</TabsTrigger>
          <TabsTrigger value="fund-flows"><ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Fund Flows ({fundFlows?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="participants" className="mt-3">
          {!participants?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No participants added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {participants.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">{(p as any).entities?.legal_name || p.entity_id?.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant="outline">{p.role}</Badge></TableCell>
                    <TableCell><Badge variant={STATUS_COLORS[p.status] as any || "secondary"}>{p.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.approved_at ? format(new Date(p.approved_at), "dd MMM yyyy") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="milestones" className="mt-3">
          {!milestones?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No milestones defined yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Budget Tranche</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {milestones.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium text-sm">{m.name}</TableCell>
                    <TableCell className="text-xs">{format(new Date(m.due_at), "dd MMM yyyy")}</TableCell>
                    <TableCell className="font-mono text-sm">{formatCurrency(m.budget_tranche)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_COLORS[m.status] as any || "secondary"}>
                        {m.status === "completed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {m.status === "overdue" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {m.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.verified_at ? format(new Date(m.verified_at), "dd MMM yyyy") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="fund-flows" className="mt-3">
          <div className="flex items-center gap-2 mb-3">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Hash Chain Integrity:</span>
            {fundFlows && fundFlows.length > 0 ? (
              chainValid ? (
                <Badge variant="default"><CheckCircle2 className="h-3 w-3 mr-1" /> Valid</Badge>
              ) : (
                <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" /> Broken</Badge>
              )
            ) : (
              <Badge variant="secondary">No entries</Badge>
            )}
          </div>

          {!fundFlows?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No fund flows recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Hash</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fundFlows.map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell><Badge variant={STATUS_COLORS[f.flow_type] as any || "secondary"}>{f.flow_type}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{formatCurrency(f.amount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{f.reference || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={f.payload_hash}>{f.payload_hash?.slice(0, 12)}…</TableCell>
                    <TableCell className="text-xs">{format(new Date(f.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────

export function AdminProgrammesPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <ProgrammeDetail programmeId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return <ProgrammeList onSelect={setSelectedId} />;
}
