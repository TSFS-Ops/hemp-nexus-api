import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Milestone, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

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
}

interface Breach {
  id: string;
  pod_id: string;
  org_id: string;
  reason: string;
  status: string;
  detected_at: string;
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

  const fetchData = async () => {
    setLoading(true);
    const [podRes, msRes, brRes] = await Promise.all([
      supabase.from("pods").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("pod_milestones").select("*").order("due_at", { ascending: true }).limit(500),
      supabase.from("breaches").select("*").order("detected_at", { ascending: false }).limit(100),
    ]);
    setPods((podRes.data as Pod[]) || []);
    setMilestones((msRes.data as PodMilestone[]) || []);
    setBreaches((brRes.data as Breach[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const podCounts = pods.reduce((acc, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Proof-of-Delivery (PoD)</h2>
          <p className="text-muted-foreground mt-1">
            Milestone tracking, breach detection, and delivery finalisation
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

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
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>WaD</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Finalised</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pods.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">No PoDs created yet</TableCell>
                    </TableRow>
                  ) : pods.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                      <TableCell className="font-mono text-xs">{p.wad_id.slice(0, 8)}…</TableCell>
                      <TableCell><Badge variant={POD_STATE_COLOURS[p.state] || "secondary"}>{p.state}</Badge></TableCell>
                      <TableCell>{format(new Date(p.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                      <TableCell>{p.finalised_at ? format(new Date(p.finalised_at), "dd MMM yyyy HH:mm") : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="milestones">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>PoD</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {milestones.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">No milestones yet</TableCell>
                    </TableRow>
                  ) : milestones.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.id.slice(0, 8)}…</TableCell>
                      <TableCell className="font-mono text-xs">{m.pod_id.slice(0, 8)}…</TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell><Badge variant={MS_STATUS_COLOURS[m.status] || "secondary"}>{m.status}</Badge></TableCell>
                      <TableCell>{format(new Date(m.due_at), "dd MMM yyyy")}</TableCell>
                      <TableCell>{m.completed_at ? format(new Date(m.completed_at), "dd MMM yyyy HH:mm") : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breaches">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
