/**
 * Batch 8 — Public "Submit new-company request" page.
 *
 * Connects to the Batch 7 registry-new-company-request edge function.
 * Users may not directly create a public company record; they submit
 * a request that goes into the admin queue.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const FormSchema = z.object({
  company_name: z.string().trim().min(2, "Enter the company name").max(200),
  country_code: z.string().trim().min(2).max(3),
  registration_number: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export default function NewCompanyRequest() {
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  async function onSubmit() {
    const parsed = FormSchema.safeParse({
      company_name: companyName,
      country_code: countryCode,
      registration_number: registrationNumber || undefined,
      notes: notes || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please correct the form");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-new-company-request", {
        body: parsed.data,
      });
      if (error) throw error;
      const id = (data as { id?: string } | null)?.id ?? null;
      setSubmittedId(id);
      toast.success("Request submitted — it will be reviewed by Izenzo.");
    } catch (err) {
      console.error(err);
      toast.error("Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedId) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <Card>
          <CardContent className="py-6 space-y-3 text-sm">
            <h2 className="text-lg font-semibold">Request received</h2>
            <p>Reference: <span className="font-mono text-xs">{submittedId}</span></p>
            <p>This request will be reviewed by Izenzo. The company will not appear in public search until the review is complete.</p>
            <Button asChild variant="outline"><Link to="/registry/search">Back to search</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Submit a new-company request</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Tell us about the company</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="cn" className="text-xs">Company name</Label>
            <Input id="cn" value={companyName} maxLength={200} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc" className="text-xs">Country</Label>
              <Input id="cc" maxLength={3} value={countryCode}
                     onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label htmlFor="rn" className="text-xs">Registration number (optional)</Label>
              <Input id="rn" maxLength={60} value={registrationNumber}
                     onChange={(e) => setRegistrationNumber(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="nt" className="text-xs">Notes (optional)</Label>
            <Textarea id="nt" maxLength={1000} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button onClick={onSubmit} disabled={submitting} data-testid="submit-new-company-request">
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            New-company requests go through admin review. Companies do not appear in public search until approved.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
