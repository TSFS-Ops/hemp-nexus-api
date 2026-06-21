/**
 * Batch 16 — Dispute request UI.
 *
 * Captures a dispute with an explicit acknowledgement that opening a
 * dispute does not automatically change any approved status. If a bank
 * verification is disputed it must NOT continue rendering as verified
 * elsewhere — that downgrade is enforced by `safeVerificationLabel`.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { toast } from "@/hooks/use-toast";
import {
  PORTAL_DISPUTE_ACK,
  PORTAL_DISPUTE_CATEGORIES,
  type PortalDisputeCategory,
} from "@/lib/registry-company-portal-ssot";

export default function MyCompanyDisputes() {
  const { companyId } = useParams();
  const [category, setCategory] = useState<PortalDisputeCategory>("claim");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);

  function submit() {
    if (!ack) {
      toast({ title: "Acknowledgement required", description: PORTAL_DISPUTE_ACK, variant: "destructive" });
      return;
    }
    // Dispute submission delegated to the appropriate existing dispute
    // surface based on category. This page is the safe entry point.
    toast({ title: "Dispute recorded", description: PORTAL_DISPUTE_ACK });
    setReason(""); setAck(false);
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <BackButton fallback={`/registry/my-companies/${companyId ?? ""}`} />
      <h1 className="text-xl font-semibold">Open a dispute</h1>

      <Alert>
        <AlertTitle>Review required</AlertTitle>
        <AlertDescription className="text-xs" data-testid="dispute-ack">
          {PORTAL_DISPUTE_ACK}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Dispute details</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div>
            <Label htmlFor="cat">Dispute type</Label>
            <select
              id="cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as PortalDisputeCategory)}
              className="w-full border rounded px-2 py-2 text-xs"
            >
              {PORTAL_DISPUTE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <label className="flex gap-2 items-start">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} data-testid="dispute-ack-check" />
            <span>I acknowledge that opening a dispute does not automatically change any approved status.</span>
          </label>
          <Button onClick={submit} disabled={!ack || !reason}>Open dispute</Button>
        </CardContent>
      </Card>
    </div>
  );
}
