import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const LOG_LIMIT = 200;

export function AdminDocumentAccessPanel() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("document_access_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error("Failed to fetch document access logs:", err);
      toast.error("Failed to load document access logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <TruncationBanner data={logs} limit={LOG_LIMIT} />
      <p className="text-sm text-muted-foreground">{logs.length} access log(s)</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Action</TableHead><TableHead>Document</TableHead><TableHead>Accessor</TableHead><TableHead>Admin</TableHead><TableHead>Date</TableHead><TableHead className="w-16">Detail</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell><Badge variant="outline" className="text-xs">{l.action}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{l.document_id.substring(0, 8)}...</TableCell>
                <TableCell className="font-mono text-xs">{l.accessor_user_id.substring(0, 8)}...</TableCell>
                <TableCell>{l.is_admin_access ? <Badge variant="secondary" className="text-xs">Admin</Badge> : <span className="text-xs text-muted-foreground">User</span>}</TableCell>
                <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(l)}><Eye className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No document access logs.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Access Log Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Action:</span> {selected.action}</div>
              <div><span className="text-muted-foreground">Document:</span> <span className="font-mono">{selected.document_id}</span></div>
              <div><span className="text-muted-foreground">Match:</span> <span className="font-mono">{selected.match_id}</span></div>
              <div><span className="text-muted-foreground">Accessor:</span> <span className="font-mono">{selected.accessor_user_id}</span></div>
              <div><span className="text-muted-foreground">Organisation:</span> <span className="font-mono">{selected.accessor_org_id || "N/A"}</span></div>
              <div><span className="text-muted-foreground">Admin Access:</span> {selected.is_admin_access ? "Yes" : "No"}</div>
              <div><span className="text-muted-foreground">IP:</span> {selected.ip_address || "N/A"}</div>
              <div><span className="text-muted-foreground">Reason:</span> {selected.access_reason || "N/A"}</div>
              <div><span className="text-muted-foreground">Date:</span> {new Date(selected.created_at).toLocaleString()}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}