import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Building2, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

interface OrgProfile {
  id: string;
  name: string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  address: Record<string, string>;
  jurisdictions: string[];
  tax_number: string | null;
  vat_number: string | null;
  authorised_signatory: string | null;
  website: string | null;
  industry: string | null;
}

export function OrgProfileForm() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [newJurisdiction, setNewJurisdiction] = useState("");
  const successTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchOrgProfile();
  }, [user]);

  useEffect(() => {
    return () => {
      if (successTimeout.current) clearTimeout(successTimeout.current);
    };
  }, []);

  const fetchOrgProfile = async () => {
    try {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user?.id ?? "")
        .maybeSingle();

      if (!profileData?.org_id) return;

      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, legal_name, trading_name, registration_number, address, jurisdictions, tax_number, vat_number, authorised_signatory, website, industry")
        .eq("id", profileData.org_id)
        .maybeSingle();

      if (error) throw error;
      setProfile(data as OrgProfile | null);
    } catch (err) {
      console.error("Error loading org profile:", err);
      toast.error("Failed to load organisation profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;

    if (!profile.name.trim()) {
      toast.error("Display name is required");
      return;
    }
    if (profile.name.length > 200) {
      toast.error("Display name must be under 200 characters");
      return;
    }
    if (profile.website) {
      const w = profile.website.trim();
      if (w && !/^https?:\/\//i.test(w)) {
        toast.error("Website must start with https:// or http://");
        return;
      }
    }

    setSaving(true);
    setSaveSuccess(false);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({
          name: profile.name.trim().slice(0, 200),
          legal_name: profile.legal_name?.slice(0, 300) || null,
          trading_name: profile.trading_name?.slice(0, 300) || null,
          registration_number: profile.registration_number?.slice(0, 50) || null,
          address: profile.address as any,
          jurisdictions: profile.jurisdictions.slice(0, 20),
          tax_number: profile.tax_number?.slice(0, 50) || null,
          vat_number: profile.vat_number?.slice(0, 50) || null,
          authorised_signatory: profile.authorised_signatory?.slice(0, 200) || null,
          website: profile.website?.slice(0, 500) || null,
          industry: profile.industry?.slice(0, 100) || null,
        })
        .eq("id", profile.id);

      if (error) throw error;
      setSaveSuccess(true);
      toast.success("Organisation profile saved");
      if (successTimeout.current) clearTimeout(successTimeout.current);
      successTimeout.current = setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error("Error saving org profile:", err);
      toast.error("Failed to save organisation profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addJurisdiction = () => {
    if (!newJurisdiction.trim() || !profile) return;
    setProfile({ ...profile, jurisdictions: [...profile.jurisdictions, newJurisdiction.trim().toUpperCase()] });
    setNewJurisdiction("");
  };

  const removeJurisdiction = (idx: number) => {
    if (!profile) return;
    setProfile({ ...profile, jurisdictions: profile.jurisdictions.filter((_, i) => i !== idx) });
  };

  const updateAddress = (field: string, value: string) => {
    if (!profile) return;
    setProfile({ ...profile, address: { ...profile.address, [field]: value } });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!profile) {
    return <p className="text-muted-foreground py-8 text-center">No organisation found.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Organisation Profile</CardTitle>
          <CardDescription>KYB details for your organisation. Complete these once — they're used across compliance and trade workflows.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Display Name</Label>
              <Input id="org-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} aria-label="Display name" maxLength={200} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="legal-name">Legal Name</Label>
              <Input id="legal-name" value={profile.legal_name ?? ""} onChange={(e) => setProfile({ ...profile, legal_name: e.target.value })} placeholder="Registered legal entity name" aria-label="Legal name" maxLength={300} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trading-name">Trading Name</Label>
              <Input id="trading-name" value={profile.trading_name ?? ""} onChange={(e) => setProfile({ ...profile, trading_name: e.target.value })} placeholder="Trading as..." aria-label="Trading name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-number">Registration Number</Label>
              <Input id="reg-number" value={profile.registration_number ?? ""} onChange={(e) => setProfile({ ...profile, registration_number: e.target.value })} placeholder="Company reg number" aria-label="Registration number" maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax-number">Tax Number</Label>
              <Input id="tax-number" value={profile.tax_number ?? ""} onChange={(e) => setProfile({ ...profile, tax_number: e.target.value })} placeholder="Tax identification number" aria-label="Tax number" maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vat-number">VAT Number</Label>
              <Input id="vat-number" value={profile.vat_number ?? ""} onChange={(e) => setProfile({ ...profile, vat_number: e.target.value })} placeholder="VAT registration (if applicable)" aria-label="VAT number" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signatory">Authorised Signatory</Label>
              <Input id="signatory" value={profile.authorised_signatory ?? ""} onChange={(e) => setProfile({ ...profile, authorised_signatory: e.target.value })} placeholder="Full name of authorised signatory" aria-label="Authorised signatory" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={profile.industry ?? ""} onChange={(e) => setProfile({ ...profile, industry: e.target.value })} placeholder="e.g. Mining, Agriculture" aria-label="Industry" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" value={profile.website ?? ""} onChange={(e) => setProfile({ ...profile, website: e.target.value })} placeholder="https://..." aria-label="Website" maxLength={500} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Street Address</Label>
              <Input value={profile.address?.street ?? ""} onChange={(e) => updateAddress("street", e.target.value)} placeholder="Street address" aria-label="Street address" />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={profile.address?.city ?? ""} onChange={(e) => updateAddress("city", e.target.value)} placeholder="City" aria-label="City" />
            </div>
            <div className="space-y-2">
              <Label>Province / State</Label>
              <Input value={profile.address?.province ?? ""} onChange={(e) => updateAddress("province", e.target.value)} placeholder="Province or state" aria-label="Province" />
            </div>
            <div className="space-y-2">
              <Label>Postal Code</Label>
              <Input value={profile.address?.postal_code ?? ""} onChange={(e) => updateAddress("postal_code", e.target.value)} placeholder="Postal code" aria-label="Postal code" />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Input value={profile.address?.country ?? ""} onChange={(e) => updateAddress("country", e.target.value)} placeholder="Country" aria-label="Country" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jurisdictions of Operation</CardTitle>
          <CardDescription>Add the jurisdiction codes where your organisation operates (e.g. ZA, GB, US).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {profile.jurisdictions.map((j, i) => (
              <Badge key={i} variant="secondary" className="gap-1">
                {j}
                <button onClick={() => removeJurisdiction(i)} className="ml-1 hover:text-destructive" aria-label={`Remove ${j}`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newJurisdiction}
              onChange={(e) => setNewJurisdiction(e.target.value)}
              placeholder="e.g. ZA"
              className="max-w-[120px]"
              onKeyDown={(e) => e.key === "Enter" && addJurisdiction()}
              aria-label="Add jurisdiction"
            />
            <Button variant="outline" size="sm" onClick={addJurisdiction}>Add</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {saveSuccess && (
          <span className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            Saved successfully
          </span>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Saving…" : "Save Organisation Profile"}
        </Button>
      </div>
    </div>
  );
}
