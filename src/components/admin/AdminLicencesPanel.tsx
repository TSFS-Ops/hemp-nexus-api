import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function AdminLicencesPanel() {
  const [licences, setLicences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ org_id: "", licence_type: "", licence_number: "", issuing_authority: "", issued_at: "", expires_at: "", status: "active" });

  const fetchLicences = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("licences").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    else setLicences(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLicences(); }, [fetchLicences]);

  const handleSave = async () => {
    try {
      if (editing) {
        const { error } = await supabase.from("licences").update({
          licence_type: formData.licence_type,
          licence_number: formData.licence_number,
          issuing_authority: formData.issuing_authority,
          issued_at: formData.issued_at || null,
          expires_at: formData.expires_at || null,
          status: formData.status,
        }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Licence updated");
      } else {
        const { error } = await supabase.from("licences").insert({
          org_id: formData.org_id,
          licence_type: formData.licence_type,
          licence_number: formData.licence_number,
          issuing_authority: formData.issuing_authority,
          issued_at: formData.issued_at || null,
          expires_at: formData.expires_at || null,
          status: formData.status,
        });
        if (error) throw error;
        toast.success("Licence created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchLicences();
    } catch (err) { toast.error((err as Error).message); }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("licences").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Licence removed"); fetchLicences(); }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{licences.length} licence(s)</p>
        <Button size="sm" onClick={() => { setEditing(null); setFormData({ org_id: "", licence_type: "", licence_number: "", issuing_authority: "", issued_at: "", expires_at: "", status: "active" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Licence</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Number</TableHead><TableHead>Authority</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {licences.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-sm font-medium">{l.licence_type || "N/A"}</TableCell>
                <TableCell className="font-mono text-xs">{l.licence_number || "N/A"}</TableCell>
                <TableCell className="text-xs">{l.issuing_authority || "N/A"}</TableCell>
                <TableCell><Badge variant={l.status === "active" ? "default" : "secondary"} className="text-xs">{l.status}</Badge></TableCell>
                <TableCell className="text-xs">{l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "No expiry"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(l); setFormData({ org_id: l.org_id, licence_type: l.licence_type || "", licence_number: l.licence_number || "", issuing_authority: l.issuing_authority || "", issued_at: l.issued_at || "", expires_at: l.expires_at || "", status: l.status || "active" }); setDialogOpen(true); }}><Edit className="h-3.5 w-3.5" /></Button>
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
            <div className="space-y-2"><Label>Licence Type</Label><Input value={formData.licence_type} onChange={(e) => setFormData(p => ({ ...p, licence_type: e.target.value }))} placeholder="e.g. Trade, Export, Import" /></div>
            <div className="space-y-2"><Label>Licence Number</Label><Input value={formData.licence_number} onChange={(e) => setFormData(p => ({ ...p, licence_number: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Issuing Authority</Label><Input value={formData.issuing_authority} onChange={(e) => setFormData(p => ({ ...p, issuing_authority: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Issued At</Label><Input type="date" value={formData.issued_at} onChange={(e) => setFormData(p => ({ ...p, issued_at: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Expires At</Label><Input type="date" value={formData.expires_at} onChange={(e) => setFormData(p => ({ ...p, expires_at: e.target.value }))} /></div>
            </div>
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
