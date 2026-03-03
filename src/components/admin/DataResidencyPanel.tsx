import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Globe, MapPin, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const DATA_REGIONS = [
  { value: "za-south", label: "South Africa (za-south)", flag: "🇿🇦" },
  { value: "eu-west", label: "Europe West (eu-west)", flag: "🇪🇺" },
  { value: "us-east", label: "United States East (us-east)", flag: "🇺🇸" },
  { value: "ap-southeast", label: "Asia Pacific (ap-southeast)", flag: "🌏" },
];

interface OrgResidency {
  id: string;
  name: string;
  data_region: string;
  cross_border_consent: boolean;
}

export function DataResidencyPanel() {
  const [orgs, setOrgs] = useState<OrgResidency[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { fetchOrgs(); }, []);

  const fetchOrgs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, data_region, cross_border_consent")
        .order("name");

      if (error) throw error;
      setOrgs((data as unknown as OrgResidency[]) || []);
    } catch (error) {
      console.error("Error fetching orgs:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateResidency = async (orgId: string, field: string, value: unknown) => {
    try {
      setSaving(orgId);
      const { error } = await supabase
        .from("organizations")
        .update({ [field]: value })
        .eq("id", orgId);

      if (error) throw error;

      setOrgs((prev) =>
        prev.map((o) => (o.id === orgId ? { ...o, [field]: value } : o))
      );
      toast.success("Residency settings updated");
    } catch (error) {
      console.error("Error updating residency:", error);
      toast.error("Failed to update");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Data Residency</h2>
        <p className="text-muted-foreground mt-2">
          Region selectable at onboarding. No cross-border data movement without explicit consent.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Residency Policy
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Data residency is stored per organisation and enforced at the infrastructure level.</p>
          <p>• Cross-border data movement requires explicit consent from the organisation.</p>
          <p>• Minimum retention: 7 years, then cold storage with cryptographic integrity preserved.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {orgs.map((org) => (
          <Card key={org.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {org.name}
                </CardTitle>
                <Badge variant="outline" className="font-mono text-xs">
                  {org.id.substring(0, 8)}…
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data Region</Label>
                  <Select
                    value={org.data_region}
                    onValueChange={(val) => updateResidency(org.id, "data_region", val)}
                  >
                    <SelectTrigger aria-label="Select data region">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_REGIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.flag} {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Cross-Border Consent</Label>
                    <p className="text-xs text-muted-foreground">Allow data transfer across regions</p>
                  </div>
                  <Switch
                    checked={org.cross_border_consent}
                    onCheckedChange={(val) => updateResidency(org.id, "cross_border_consent", val)}
                    disabled={saving === org.id}
                  />
                </div>
              </div>
              {saving === org.id && (
                <div className="flex items-center text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" /> Saving…
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
