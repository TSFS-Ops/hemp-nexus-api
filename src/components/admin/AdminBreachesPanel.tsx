import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, AlertTriangle, CheckCircle, Eye } from "lucide-react";
import { toast } from "sonner";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const BREACH_LIMIT = 200;

export function AdminBreachesPanel() {
  const [breaches, setBreaches] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [resolveNote, setResolveNote] = useState("");
  const resolvingRef = useRef(false);

  const fetchBreaches = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error, count } = await supabase.from("breaches").select("*", { count: "exact" }).order("detected_at", { ascending: false }).limit(BREACH_LIMIT);
      if (error) throw error;
      setBreaches(data || []);
      setTotalCount(count ?? data?.length ?? 0);
    } catch (err) {
      console.error("Failed to fetch breaches:", err);
      toast.error("Failed to load breaches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBreaches(); }, [fetchBreaches]);

  const resolveBreech = async () => {
    if (!selected || !resolveNote || resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("breaches").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
        resolution_note: resolveNote,
      }).eq("id", selected.id);
      if (error) throw error;
      toast.success("Breach resolved");
      setDetailOpen(false);
      setResolveNote("");
      fetchBreaches();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      resolvingRef.current = false;
    }
  };

  const severityColor = (s: string) => s === "critical" ? "destructive" : s === "high" ? "destructive" : "secondary";

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <TruncationBanner data={breaches} totalCount={totalCount} limit={BREACH_LIMIT} />
      <p className="text-sm text-muted-foreground">{breaches.length} breach record(s) | {breaches.filter(b => b.status === "open").length} open</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Severity</TableHead><TableHead>Reason</TableHead><TableHead>Pod</TableHead><TableHead>Status</TableHead><TableHead>Detected</TableHead><TableHead className="w-20">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {breaches.map((b) => (
              <TableRow key={b.id}>
                <TableCell><Badge variant={severityColor(b.severity)} className="text-xs">{b.severity}</Badge></TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{b.reason}</TableCell>
                <TableCell className="font-mono text-xs">{b.pod_id.substring(0, 8)}...</TableCell>
                <TableCell><Badge variant={b.status === "resolved" ? "default" : "secondary"} className="text-xs">{b.status}</Badge></TableCell>
                <TableCell className="text-xs">{new Date(b.detected_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelected(b); setDetailOpen(true); }}><Eye className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {breaches.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No breaches recorded.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Breach Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Severity:</span> <Badge variant={severityColor(selected.severity)}>{selected.severity}</Badge></div>
              <div><span className="text-muted-foreground">Reason:</span> {selected.reason}</div>
              <div><span className="text-muted-foreground">Pod:</span> <span className="font-mono">{selected.pod_id}</span></div>
              <div><span className="text-muted-foreground">Status:</span> {selected.status}</div>
              <div><span className="text-muted-foreground">Detected:</span> {new Date(selected.detected_at).toLocaleString()}</div>
              {selected.resolution_note && <div><span className="text-muted-foreground">Resolution:</span> {selected.resolution_note}</div>}
              {selected.status !== "resolved" && (
                <div className="space-y-2 pt-2 border-t">
                  <Label>Resolution Note (mandatory)</Label>
                  <Input value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="Describe the resolution..." />
                  <Button size="sm" onClick={resolveBreech} disabled={!resolveNote}><CheckCircle className="h-4 w-4 mr-1" />Resolve</Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}