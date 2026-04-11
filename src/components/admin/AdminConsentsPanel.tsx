import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Edit, Shield } from "lucide-react";
import { toast } from "sonner";

interface Consent {
  id: string;
  org_id: string;
  data_source_id: string;
  scope: Record<string, unknown>;
  granted_at: string;
  granted_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export function AdminConsentsPanel() {
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Consent | null>(null);
  const [formData, setFormData] = useState({ org_id: "", data_source_id: "", scope: "{}", expires_at: "" });

  const fetchConsents = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("consents")
        .select("*")
        .order("granted_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setConsents((data as unknown as Consent[]) || []);
    } catch (err) {
      console.error("Failed to fetch consents:", err);
      toast.error("Failed to load consents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConsents(); }, [fetchConsents]);

  const [saving, setSaving] = useState(false);
  const revokingRef = useRef(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const scopeObj = JSON.parse(formData.scope);
      if (editing) {
        const { error } = await supabase
          .from("consents")
          .update({
            scope: scopeObj,
            expires_at: formData.expires_at || null,
          })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Consent updated");
      } else {
        const { error } = await supabase
          .from("consents")
          .insert({
            org_id: formData.org_id,
            data_source_id: formData.data_source_id,
            scope: scopeObj,
            expires_at: formData.expires_at || null,
          });
        if (error) throw error;
        toast.success("Consent created");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchConsents();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const revokeConsent = async (id: string) => {
    if (revokingRef.current) return;
    revokingRef.current = true;
    try {
      const { error } = await supabase
        .from("consents")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Consent revoked");
      fetchConsents();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      revokingRef.current = false;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormData({ org_id: "", data_source_id: "", scope: "{}", expires_at: "" });
    setDialogOpen(true);
  };

  const openEdit = (c: Consent) => {
    setEditing(c);
    setFormData({
      org_id: c.org_id,
      data_source_id: c.data_source_id,
      scope: JSON.stringify(c.scope, null, 2),
      expires_at: c.expires_at || "",
    });
    setDialogOpen(true);
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{consents.length} consent record(s)</p>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add Consent</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Data Source</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consents.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.org_id.substring(0, 8)}...</TableCell>
                  <TableCell className="font-mono text-xs">{c.data_source_id.substring(0, 8)}...</TableCell>
                  <TableCell className="text-xs">{new Date(c.granted_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "Never"}</TableCell>
                  <TableCell>
                    <Badge variant={c.revoked_at ? "destructive" : "default"} className="text-xs">
                      {c.revoked_at ? "Revoked" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      {!c.revoked_at && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => revokeConsent(c.id)}>
                          <Shield className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {consents.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No consent records found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Consent" : "Create Consent"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <>
                <div className="space-y-2">
                  <Label>Organisation ID</Label>
                  <Input value={formData.org_id} onChange={(e) => setFormData(p => ({ ...p, org_id: e.target.value }))} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>Data Source ID</Label>
                  <Input value={formData.data_source_id} onChange={(e) => setFormData(p => ({ ...p, data_source_id: e.target.value }))} placeholder="UUID" />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Scope (JSON)</Label>
              <Textarea value={formData.scope} onChange={(e) => setFormData(p => ({ ...p, scope: e.target.value }))} rows={4} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Expires At (optional)</Label>
              <Input type="datetime-local" value={formData.expires_at} onChange={(e) => setFormData(p => ({ ...p, expires_at: e.target.value }))} />
            </div>
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
