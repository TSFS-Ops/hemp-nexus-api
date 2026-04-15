import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Eye, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const RECORD_LIMIT = 200;

export function AdminAuthorityRecordsPanel() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const updatingRef = useRef(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("authority_records").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setRecords(data || []);
    } catch (err) {
      console.error("Failed to fetch authority records:", err);
      toast.error("Failed to load authority records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const updateStatus = async (id: string, status: string) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    try {
      const { error } = await supabase.from("authority_records").update({
        status,
        verified_at: status === "verified" ? new Date().toISOString() : null,
      }).eq("id", id);
      if (error) throw error;
      toast.success(`Record ${status}`);
      fetchRecords();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      updatingRef.current = false;
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <TruncationBanner data={records} limit={RECORD_LIMIT} />
      <p className="text-sm text-muted-foreground">{records.length} authority-to-bind record(s)</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Person Entity</TableHead><TableHead>Company Entity</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Verified</TableHead><TableHead className="w-32">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.person_entity_id.substring(0, 8)}...</TableCell>
                <TableCell className="font-mono text-xs">{r.company_entity_id.substring(0, 8)}...</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{r.method}</Badge></TableCell>
                <TableCell><Badge variant={r.status === "verified" ? "default" : r.status === "rejected" ? "destructive" : "secondary"} className="text-xs">{r.status}</Badge></TableCell>
                <TableCell className="text-xs">{r.verified_at ? new Date(r.verified_at).toLocaleDateString() : "Pending"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelected(r); setDetailOpen(true); }}><Eye className="h-3.5 w-3.5" /></Button>
                    {r.status === "pending" && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => updateStatus(r.id, "verified")}><CheckCircle className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => updateStatus(r.id, "rejected")}><XCircle className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {records.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No authority records found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Authority Record Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{selected.id}</span></div>
              <div><span className="text-muted-foreground">Person Entity:</span> <span className="font-mono">{selected.person_entity_id}</span></div>
              <div><span className="text-muted-foreground">Company Entity:</span> <span className="font-mono">{selected.company_entity_id}</span></div>
              <div><span className="text-muted-foreground">Method:</span> {selected.method}</div>
              <div><span className="text-muted-foreground">Status:</span> <Badge variant={selected.status === "verified" ? "default" : "secondary"}>{selected.status}</Badge></div>
              <div><span className="text-muted-foreground">Document ID:</span> <span className="font-mono">{selected.document_id || "None"}</span></div>
              <div><span className="text-muted-foreground">Expires:</span> {selected.expires_at ? new Date(selected.expires_at).toLocaleDateString() : "No expiry"}</div>
              <div><span className="text-muted-foreground">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
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