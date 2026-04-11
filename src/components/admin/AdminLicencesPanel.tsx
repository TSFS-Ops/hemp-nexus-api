import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function AdminLicencesPanel() {
  const [licences, setLicences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ org_id: "", tier: "standard", amount_usd: "0", expires_at: "", status: "active" });
  const [saving, setSaving] = useState(false);
  const deletingRef = useRef(false);

  const fetchLicences = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("licences").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setLicences(data || []);
    } catch (err) {
      console.error("Failed to fetch licences:", err);
      toast.error("Failed to load licences");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLicences(); }, [fetchLicences]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from("licences").update({
          tier: formData.tier,
          amount_usd: Number(formData.amount_usd),
          expires_at: formData.expires_at,
          status: formData.status,
        }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Licence updated");
      } else {
        const { error } = await supabase.from("licences").insert({
          org_id: formData.org_id,
          tier: formData.tier,
          amount_usd: Number(formData.amount_usd),
          expires_at: formData.expires_at,
          status: formData.status,
        });
        if (error) throw error;
        toast.success("Licence created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchLicences();
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
      const { error } = await supabase.from("licences").delete().eq("id", id);
      if (error) throw error;
      toast.success("Licence removed");
      fetchLicences();
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
        <p className="text-sm text-muted-foreground">{licences.length} licence(s)</p>
        <Button size="sm" onClick={() => { setEditing(null); setFormData({ org_id: "", tier: "standard", amount_usd: "0", expires_at: "", status: "active" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Licence</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tier</TableHead><TableHead>Amount (USD)</TableHead><TableHead>Organisation</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {licences.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-sm font-medium">{l.tier}</TableCell>
                <TableCell className="font-mono text-sm">${l.amount_usd.toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{l.org_id.substring(0, 8)}...</TableCell>
                <TableCell><Badge variant={l.status === "active" ? "default" : "secondary"} className="text-xs">{l.status}</Badge></TableCell>
                <TableCell className="text-xs">{new Date(l.expires_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(l); setFormData({ org_id: l.org_id, tier: l.tier, amount_usd: String(l.amount_usd), expires_at: l.expires_at?.substring(0, 10) || "", status: l.status }); setDialogOpen(true); }}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {licences.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No licences found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Licence" : "Add Licence"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editing && <div className="space-y-2"><Label>Organisation ID</Label><Input value={formData.org_id} onChange={(e) => setFormData(p => ({ ...p, org_id: e.target.value }))} placeholder="UUID" /></div>}
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={formData.tier} onValueChange={(v) => setFormData(p => ({ ...p, tier: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Amount (USD)</Label><Input type="number" value={formData.amount_usd} onChange={(e) => setFormData(p => ({ ...p, amount_usd: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Expires At</Label><Input type="date" value={formData.expires_at} onChange={(e) => setFormData(p => ({ ...p, expires_at: e.target.value }))} /></div>
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