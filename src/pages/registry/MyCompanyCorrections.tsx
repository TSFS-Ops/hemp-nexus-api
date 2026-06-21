/**
 * Batch 16 — Correction request UI.
 *
 * Captures a correction request with an explicit acknowledgement that
 * submissions are reviewed and not automatically applied. No raw bank
 * fields or admin-only notes appear on this page.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  PORTAL_CORRECTION_ACK,
  PORTAL_CORRECTION_CATEGORIES,
  type PortalCorrectionCategory,
} from "@/lib/registry-company-portal-ssot";

export default function MyCompanyCorrections() {
  const { companyId } = useParams();
  const [category, setCategory] = useState<PortalCorrectionCategory>("company_name");
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!ack) {
      toast({ title: "Acknowledgement required", description: PORTAL_CORRECTION_ACK, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { error } = await supabase.from("registry_company_correction_requests").insert([{
        company_reference: companyId ?? "",
        field_path: category,
        proposed_value: proposed,
        rationale: reason,
        requester_user_id: uid,
        status: "submitted",
      }]);
      if (error) throw error;
      toast({ title: "Correction submitted", description: PORTAL_CORRECTION_ACK });
      setProposed(""); setReason(""); setAck(false);
    } catch (e) {
      toast({ title: "Could not submit", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <BackButton fallback={`/registry/my-companies/${companyId ?? ""}`} />
      <h1 className="text-xl font-semibold">Request a correction</h1>

      <Alert>
        <AlertTitle>Review required</AlertTitle>
        <AlertDescription className="text-xs" data-testid="correction-ack">
          {PORTAL_CORRECTION_ACK}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div>
            <Label htmlFor="cat">Field being challenged</Label>
            <select
              id="cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as PortalCorrectionCategory)}
              className="w-full border rounded px-2 py-2 text-xs"
            >
              {PORTAL_CORRECTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="prop">Proposed value</Label>
            <Input id="prop" value={proposed} onChange={(e) => setProposed(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <label className="flex gap-2 items-start">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} data-testid="correction-ack-check" />
            <span>I acknowledge that corrections are reviewed and not automatically applied.</span>
          </label>
          <Button onClick={submit} disabled={!ack || submitting || !reason}>Submit correction</Button>
        </CardContent>
      </Card>
    </div>
  );
}
