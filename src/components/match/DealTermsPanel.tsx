import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileText, Save, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface DealTerm {
  id: string;
  payment_terms: string | null;
  delivery_terms: string | null;
  inspection_terms: string | null;
  penalty_terms: string | null;
  partial_shipment: boolean;
  amendment_notes: string | null;
  version: number;
  status: string;
  created_at: string;
  proposed_by: string | null;
}

interface DealTermsPanelProps {
  matchId: string;
  orgId: string;
}

export function DealTermsPanel({ matchId, orgId }: DealTermsPanelProps) {
  const { user } = useAuth();
  const [terms, setTerms] = useState<DealTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    payment_terms: "",
    delivery_terms: "",
    inspection_terms: "",
    penalty_terms: "",
    partial_shipment: false,
    amendment_notes: "",
  });

  useEffect(() => {
    fetchTerms();
  }, [matchId]);

  const fetchTerms = async () => {
    try {
      const { data, error } = await supabase
        .from("deal_terms")
        .select("*")
        .eq("match_id", matchId)
        .order("version", { ascending: false });

      if (error) throw error;
      setTerms((data as DealTerm[]) || []);
    } catch (err) {
      console.error("Error fetching deal terms:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const latestVersion = terms.length > 0 ? terms[0].version : 0;

      const { error } = await supabase.from("deal_terms").insert({
        match_id: matchId,
        org_id: orgId,
        proposed_by: user?.id,
        payment_terms: form.payment_terms || null,
        delivery_terms: form.delivery_terms || null,
        inspection_terms: form.inspection_terms || null,
        penalty_terms: form.penalty_terms || null,
        partial_shipment: form.partial_shipment,
        amendment_notes: form.amendment_notes || null,
        version: latestVersion + 1,
        status: "proposed",
      });

      if (error) throw error;
      toast.success("Deal terms proposed");
      setShowForm(false);
      setForm({ payment_terms: "", delivery_terms: "", inspection_terms: "", penalty_terms: "", partial_shipment: false, amendment_notes: "" });
      fetchTerms();
    } catch (err: any) {
      toast.error("Failed to save terms", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5" />Deal Terms
        </h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" />{showForm ? "Cancel" : "Propose Terms"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Propose Deal Terms (v{(terms[0]?.version ?? 0) + 1})</CardTitle>
            <CardDescription>Capture the key commercial terms for this deal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Payment Terms</Label>
              <Textarea value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. 30 days net, Letter of Credit, T/T on delivery" aria-label="Payment terms" />
            </div>
            <div className="space-y-2">
              <Label>Delivery Terms</Label>
              <Textarea value={form.delivery_terms} onChange={(e) => setForm({ ...form, delivery_terms: e.target.value })} placeholder="e.g. FOB Cape Town, CIF Rotterdam, within 45 days" aria-label="Delivery terms" />
            </div>
            <div className="space-y-2">
              <Label>Inspection / Quality Terms</Label>
              <Textarea value={form.inspection_terms} onChange={(e) => setForm({ ...form, inspection_terms: e.target.value })} placeholder="e.g. SGS inspection at load port, ISO 9001 certificate required" aria-label="Inspection terms" />
            </div>
            <div className="space-y-2">
              <Label>Penalty / Default Terms</Label>
              <Textarea value={form.penalty_terms} onChange={(e) => setForm({ ...form, penalty_terms: e.target.value })} placeholder="e.g. 1% per week late delivery penalty, force majeure clause" aria-label="Penalty terms" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.partial_shipment} onCheckedChange={(v) => setForm({ ...form, partial_shipment: v })} id="partial-shipment" />
              <Label htmlFor="partial-shipment">Allow partial shipments</Label>
            </div>
            <div className="space-y-2">
              <Label>Amendment Notes</Label>
              <Input value={form.amendment_notes} onChange={(e) => setForm({ ...form, amendment_notes: e.target.value })} placeholder="Reason for this version" aria-label="Amendment notes" />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Submit Terms
            </Button>
          </CardContent>
        </Card>
      )}

      {terms.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No terms proposed yet. Click "Propose Terms" to capture deal conditions.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {terms.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">v{t.version}</Badge>
                    <Badge variant={t.status === "accepted" ? "default" : t.status === "rejected" ? "destructive" : "secondary"}>
                      {t.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />{format(new Date(t.created_at), "dd MMM yyyy HH:mm")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {t.payment_terms && <div><span className="font-medium">Payment:</span> {t.payment_terms}</div>}
                {t.delivery_terms && <div><span className="font-medium">Delivery:</span> {t.delivery_terms}</div>}
                {t.inspection_terms && <div><span className="font-medium">Inspection:</span> {t.inspection_terms}</div>}
                {t.penalty_terms && <div><span className="font-medium">Penalties:</span> {t.penalty_terms}</div>}
                <div><span className="font-medium">Partial Shipments:</span> {t.partial_shipment ? "Allowed" : "Not allowed"}</div>
                {t.amendment_notes && <div className="text-muted-foreground italic">Note: {t.amendment_notes}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
