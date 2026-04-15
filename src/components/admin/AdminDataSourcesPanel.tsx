import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const SOURCE_LIMIT = 200;

export function AdminDataSourcesPanel() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", type: "api", org_id: "", status: "active", config: "{}" });
  const [saving, setSaving] = useState(false);
  const deletingRef = useRef(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("data_sources").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setSources(data || []);
    } catch (err) {
      console.error("Failed to fetch data sources:", err);
      toast.error("Failed to load data sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const configObj = JSON.parse(formData.config);
      if (editing) {
        const { error } = await supabase.from("data_sources").update({ name: formData.name, type: formData.type, status: formData.status, config: configObj }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Data source updated");
      } else {
        const { error } = await supabase.from("data_sources").insert({ name: formData.name, type: formData.type, org_id: formData.org_id, status: formData.status, config: configObj });
        if (error) throw error;
        toast.success("Data source created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchSources();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      const { error } = await supabase.from("data_sources").delete().eq("id", id);
      if (error) throw error;
      toast.success("Data source deleted");
      fetchSources();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      deletingRef.current = false;
    }
  };

  const openCreate = () => { setEditing(null); setFormData({ name: "", type: "api", org_id: "", status: "active", config: "{}" }); setDialogOpen(true); };
  const openEdit = (s: any) => { setEditing(s); setFormData({ name: s.name, type: s.type, org_id: s.org_id, status: s.status, config: JSON.stringify(s.config, null, 2) }); setDialogOpen(true); };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <TruncationBanner data={sources} limit={SOURCE_LIMIT} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{sources.length} data source(s)</p>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add Source</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Last Queried</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium text-sm">{s.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{s.type}</Badge></TableCell>
                <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"} className="text-xs">{s.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.last_queried_at ? new Date(s.last_queried_at).toLocaleDateString() : "Never"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sources.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data sources configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Data Source" : "Create Data Source"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={formData.name} onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="database">Database</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!editing && <div className="space-y-2"><Label>Organisation ID</Label><Input value={formData.org_id} onChange={(e) => setFormData(p => ({ ...p, org_id: e.target.value }))} placeholder="UUID" /></div>}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Config (JSON)</Label><Input value={formData.config} onChange={(e) => setFormData(p => ({ ...p, config: e.target.value }))} className="font-mono text-xs" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}