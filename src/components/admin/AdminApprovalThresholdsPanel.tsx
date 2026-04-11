import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Edit, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function AdminApprovalThresholdsPanel() {
  const [thresholds, setThresholds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ org_id: "", low_threshold: "10000", high_threshold: "100000" });
  const [saving, setSaving] = useState(false);
  const deletingRef = useRef(false);

  const fetchThresholds = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("approval_thresholds").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setThresholds(data || []);
    } catch (err) {
      console.error("Failed to fetch thresholds:", err);
      toast.error("Failed to load approval thresholds");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThresholds(); }, [fetchThresholds]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from("approval_thresholds").update({
          low_threshold: Number(formData.low_threshold),
          high_threshold: Number(formData.high_threshold),
        }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Threshold updated");
      } else {
        const { error } = await supabase.from("approval_thresholds").insert({
          org_id: formData.org_id,
          low_threshold: Number(formData.low_threshold),
          high_threshold: Number(formData.high_threshold),
        });
        if (error) throw error;
        toast.success("Threshold created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchThresholds();
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
      const { error } = await supabase.from("approval_thresholds").delete().eq("id", id);
      if (error) throw error;
      toast.success("Threshold removed");
      fetchThresholds();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      deletingRef.current = false;
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{thresholds.length} threshold configuration(s)</p>
        <Button size="sm" onClick={() => { setEditing(null); setFormData({ org_id: "", low_threshold: "10000", high_threshold: "100000" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Threshold</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Organisation</TableHead><TableHead>Low Threshold</TableHead><TableHead>High Threshold</TableHead><TableHead>Updated</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {thresholds.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.org_id.substring(0, 8)}...</TableCell>
                <TableCell className="text-sm">{t.low_threshold.toLocaleString()}</TableCell>
                <TableCell className="text-sm">{t.high_threshold.toLocaleString()}</TableCell>
                <TableCell className="text-xs">{new Date(t.updated_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(t); setFormData({ org_id: t.org_id, low_threshold: String(t.low_threshold), high_threshold: String(t.high_threshold) }); setDialogOpen(true); }}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {thresholds.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No approval thresholds configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Threshold" : "Create Threshold"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editing && <div className="space-y-2"><Label>Organisation ID</Label><Input value={formData.org_id} onChange={(e) => setFormData(p => ({ ...p, org_id: e.target.value }))} placeholder="UUID" /></div>}
            <div className="space-y-2"><Label>Low Threshold (USD)</Label><Input type="number" value={formData.low_threshold} onChange={(e) => setFormData(p => ({ ...p, low_threshold: e.target.value }))} /></div>
            <div className="space-y-2"><Label>High Threshold (USD)</Label><Input type="number" value={formData.high_threshold} onChange={(e) => setFormData(p => ({ ...p, high_threshold: e.target.value }))} /></div>
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