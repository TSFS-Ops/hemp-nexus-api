import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { TruncationBanner } from "@/components/ui/truncation-banner";

const PARTNER_LIMIT = 200;
import { toast } from "sonner";

export function AdminTradingPartnersPanel() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ company_name: "", contact_email: "", jurisdiction: "", description: "", registration_number: "", org_id: "" });
  const [saving, setSaving] = useState(false);
  const deletingRef = useRef(false);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("counterparties").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setPartners(data || []);
    } catch (err) {
      console.error("Failed to fetch trading partners:", err);
      toast.error("Failed to load trading partners");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from("counterparties").update({
          company_name: formData.company_name,
          contact_email: formData.contact_email || null,
          jurisdiction: formData.jurisdiction || null,
          description: formData.description || null,
          registration_number: formData.registration_number || null,
        }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Trading partner updated");
      } else {
        const { error } = await supabase.from("counterparties").insert({
          company_name: formData.company_name,
          contact_email: formData.contact_email || null,
          jurisdiction: formData.jurisdiction || null,
          description: formData.description || null,
          registration_number: formData.registration_number || null,
          org_id: formData.org_id,
        });
        if (error) throw error;
        toast.success("Trading partner created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchPartners();
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
      const { error } = await supabase.from("counterparties").delete().eq("id", id);
      if (error) throw error;
      toast.success("Trading partner removed");
      fetchPartners();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      deletingRef.current = false;
    }
  };

  const openCreate = () => { setEditing(null); setFormData({ company_name: "", contact_email: "", jurisdiction: "", description: "", registration_number: "", org_id: "" }); setDialogOpen(true); };
  const openEdit = (p: any) => { setEditing(p); setFormData({ company_name: p.company_name, contact_email: p.contact_email || "", jurisdiction: p.jurisdiction || "", description: p.description || "", registration_number: p.registration_number || "", org_id: p.org_id }); setDialogOpen(true); };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <TruncationBanner data={partners} limit={PARTNER_LIMIT} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{partners.length} trading partner(s)</p>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add Partner</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Company Name</TableHead><TableHead>Jurisdiction</TableHead><TableHead>Contact</TableHead><TableHead>Verified</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {partners.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-sm">{p.company_name}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{p.jurisdiction || "N/A"}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.contact_email || "N/A"}</TableCell>
                <TableCell><Badge variant={p.verified ? "default" : "secondary"} className="text-xs">{p.verified ? "Yes" : "No"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {partners.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No trading partners found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Trading Partner" : "Add Trading Partner"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Company Name</Label><Input value={formData.company_name} onChange={(e) => setFormData(p => ({ ...p, company_name: e.target.value }))} /></div>
            {!editing && <div className="space-y-2"><Label>Organisation ID</Label><Input value={formData.org_id} onChange={(e) => setFormData(p => ({ ...p, org_id: e.target.value }))} placeholder="UUID" /></div>}
            <div className="space-y-2"><Label>Contact Email</Label><Input type="email" value={formData.contact_email} onChange={(e) => setFormData(p => ({ ...p, contact_email: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Jurisdiction</Label><Input value={formData.jurisdiction} onChange={(e) => setFormData(p => ({ ...p, jurisdiction: e.target.value }))} placeholder="e.g. ZA, KE, NG" /></div>
            <div className="space-y-2"><Label>Registration Number</Label><Input value={formData.registration_number} onChange={(e) => setFormData(p => ({ ...p, registration_number: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={formData.description} onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))} /></div>
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