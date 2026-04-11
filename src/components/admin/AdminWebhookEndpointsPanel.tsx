import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Edit, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";

export function AdminWebhookEndpointsPanel() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"endpoints" | "deliveries">("endpoints");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ url: "", org_id: "", events: "", active: true });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [epRes, delRes] = await Promise.all([
        supabase.from("webhook_endpoints").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("webhook_deliveries").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (epRes.error) throw epRes.error;
      setEndpoints(epRes.data || []);
      if (delRes.error) console.error("Deliveries fetch error:", delRes.error);
      else setDeliveries(delRes.data || []);
    } catch (err) {
      console.error("Failed to fetch webhook data:", err);
      toast.error("Failed to load webhook endpoints");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    try {
      const eventsArr = formData.events.split(",").map(e => e.trim()).filter(Boolean);
      if (editing) {
        const { error } = await supabase.from("webhook_endpoints").update({ url: formData.url, events: eventsArr }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Endpoint updated");
      } else {
        // Generate a placeholder secret hash for the webhook
        const secretHash = crypto.randomUUID().replace(/-/g, '');
        const { error } = await supabase.from("webhook_endpoints").insert({ url: formData.url, org_id: formData.org_id, events: eventsArr, secret_hash: secretHash });
        if (error) throw error;
        toast.success("Endpoint created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchData();
    } catch (err) { toast.error((err as Error).message); }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Endpoint deleted"); fetchData(); }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant={view === "endpoints" ? "default" : "outline"} onClick={() => setView("endpoints")}>Endpoints ({endpoints.length})</Button>
        <Button size="sm" variant={view === "deliveries" ? "default" : "outline"} onClick={() => setView("deliveries")}>Deliveries ({deliveries.length})</Button>
        {view === "endpoints" && <Button size="sm" className="ml-auto" onClick={() => { setEditing(null); setFormData({ url: "", org_id: "", events: "", active: true }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Endpoint</Button>}
      </div>

      {view === "endpoints" && (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>URL</TableHead><TableHead>Events</TableHead><TableHead>Active</TableHead><TableHead>Organisation</TableHead><TableHead className="w-24">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {endpoints.map((ep) => (
                <TableRow key={ep.id}>
                  <TableCell className="text-xs font-mono max-w-[200px] truncate">{ep.url}</TableCell>
                  <TableCell className="text-xs">{(ep.events || []).length} event(s)</TableCell>
                  <TableCell><Badge variant={ep.active ? "default" : "secondary"} className="text-xs">{ep.active ? "Active" : "Disabled"}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{ep.org_id.substring(0, 8)}...</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(ep); setFormData({ url: ep.url, org_id: ep.org_id, events: (ep.events || []).join(", "), active: ep.active }); setDialogOpen(true); }}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(ep.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {endpoints.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No webhook endpoints configured.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {view === "deliveries" && (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead>Response</TableHead><TableHead>Attempts</TableHead><TableHead>Delivered</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs font-medium">{d.event_type || "N/A"}</TableCell>
                  <TableCell><Badge variant={d.status === "delivered" ? "default" : d.status === "failed" ? "destructive" : "secondary"} className="text-xs">{d.status}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{d.response_status || "N/A"}</TableCell>
                  <TableCell className="text-xs">{d.attempt_count || 0}</TableCell>
                  <TableCell className="text-xs">{new Date(d.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {deliveries.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No deliveries recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Webhook Endpoint" : "Create Webhook Endpoint"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>URL</Label><Input value={formData.url} onChange={(e) => setFormData(p => ({ ...p, url: e.target.value }))} placeholder="https://..." /></div>
            {!editing && <div className="space-y-2"><Label>Organisation ID</Label><Input value={formData.org_id} onChange={(e) => setFormData(p => ({ ...p, org_id: e.target.value }))} placeholder="UUID" /></div>}
            <div className="space-y-2"><Label>Events (comma-separated)</Label><Input value={formData.events} onChange={(e) => setFormData(p => ({ ...p, events: e.target.value }))} placeholder="match.created, deal.sealed" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
