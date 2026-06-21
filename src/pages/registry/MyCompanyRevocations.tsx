/**
 * Batch 16 — Revocation request UI.
 *
 * Captures a revocation request for authority, bank-detail submission
 * or bank verification. Always shows the bank-revocation consequence
 * acknowledgement when the target is bank detail or verification.
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
  PORTAL_REVOCATION_AUTHORITY_ACK,
  PORTAL_REVOCATION_BANK_ACK,
  PORTAL_REVOCATION_TARGETS,
  type PortalRevocationTarget,
} from "@/lib/registry-company-portal-ssot";

export default function MyCompanyRevocations() {
  const { companyId } = useParams();
  const [target, setTarget] = useState<PortalRevocationTarget>("bank_detail");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);

  const consequence =
    target === "authority" ? PORTAL_REVOCATION_AUTHORITY_ACK : PORTAL_REVOCATION_BANK_ACK;

  function submit() {
    if (!ack) {
      toast({ title: "Consequence acknowledgement required", description: consequence, variant: "destructive" });
      return;
    }
    toast({ title: "Revocation requested", description: consequence });
    setReason(""); setAck(false);
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <BackButton fallback={`/registry/my-companies/${companyId ?? ""}`} />
      <h1 className="text-xl font-semibold">Request revocation</h1>

      <Alert>
        <AlertTitle>Consequence</AlertTitle>
        <AlertDescription className="text-xs" data-testid="revocation-consequence">
          {consequence}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Revocation request</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div>
            <Label htmlFor="tgt">Target</Label>
            <select
              id="tgt"
              value={target}
              onChange={(e) => setTarget(e.target.value as PortalRevocationTarget)}
              className="w-full border rounded px-2 py-2 text-xs"
            >
              {PORTAL_REVOCATION_TARGETS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <label className="flex gap-2 items-start">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} data-testid="revocation-ack-check" />
            <span>I acknowledge the consequence shown above.</span>
          </label>
          <Button onClick={submit} disabled={!ack || !reason}>Request revocation</Button>
        </CardContent>
      </Card>
    </div>
  );
}
