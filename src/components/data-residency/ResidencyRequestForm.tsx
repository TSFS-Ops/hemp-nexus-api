import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * DATA-009 Phase 2 — submit a residency requirement for Izenzo review.
 * Approval records a policy exception only and does NOT trigger any
 * technical hosting, region migration, backup, export or deletion control.
 */
export function ResidencyRequestForm() {
  const { toast } = useToast();
  const [source, setSource] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [basis, setBasis] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (source.trim().length < 3) {
      toast({ title: "Source required", description: "Describe where this requirement comes from.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("residency-review-request", {
        body: {
          requirement_source: source.trim(),
          requested_region: region.trim() || null,
          requested_country: country.trim() || null,
          legal_basis: basis.trim() || null,
        },
      });
      if (error) throw error;
      toast({
        title: "Residency requirement recorded",
        description: `Review ID ${(data as { review_id?: string })?.review_id ?? "—"}. Izenzo will review separately.`,
      });
      setSource(""); setRegion(""); setCountry(""); setBasis("");
    } catch (e) {
      toast({ title: "Submission failed", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Submit residency requirement</CardTitle>
        <p className="text-xs text-muted-foreground">
          We record your requirement for separate Izenzo review. No region, hosting, backup, export or deletion change is automatically applied.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="src">Requirement source</Label>
          <Input id="src" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. internal compliance memo, regulator letter" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="reg">Requested region (optional)</Label>
            <Input id="reg" value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ctry">Requested country (optional)</Label>
            <Input id="ctry" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="basis">Legal basis (optional)</Label>
          <Textarea id="basis" value={basis} onChange={(e) => setBasis(e.target.value)} rows={3} />
        </div>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit for review"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default ResidencyRequestForm;
