/**
 * P-5 Batch 3 — Stage 5 funder request form.
 *
 * Funder submits an admin-moderated question. The request goes to Izenzo
 * admin first; it does not go directly to the company. Calls only
 * p5b3SubmitRequest via the rpc wrapper.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  P5B3_REQUEST_CATEGORIES,
  type P5B3RequestCategory,
} from "@/lib/p5-batch3/constants";
import { p5b3SubmitRequest } from "@/lib/p5-batch3/rpc";
import { P5B3FunderShell } from "./components/P5B3FunderShell";

const LABELS: Record<P5B3RequestCategory, string> = {
  commercial: "Commercial",
  financial: "Financial",
  legal: "Legal",
  technical: "Technical",
  esg_impact: "ESG / Impact",
  kyc_kyb: "KYC / KYB",
  evidence: "Evidence",
  governance_compliance: "Governance / Compliance",
  project_readiness: "Project Readiness",
  transaction_terms: "Transaction Terms",
  security_collateral: "Security / Collateral",
  other: "Other",
};

export default function P5Batch3FunderRequests() {
  const { grantId } = useParams();
  const [category, setCategory] = useState<P5B3RequestCategory>("commercial");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!grantId) return;
    if (message.trim().length < 8) {
      toast.error("Please provide a clearer question (min 8 characters).");
      return;
    }
    setBusy(true);
    try {
      await p5b3SubmitRequest({
        p_grant_id: grantId,
        p_category: category,
        p_original_message: message.trim(),
      });
      toast.success("Request submitted to Izenzo for admin review.");
      setMessage("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <P5B3FunderShell
      title="Submit a request"
      description={`Grant ${grantId ?? ""} — admin-moderated questions only.`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admin moderation</CardTitle>
          <CardDescription>
            Requests are reviewed by Izenzo admin before any company sees them. Admin may
            edit external wording for clarity; the original is preserved internally. You
            cannot see other funders' requests and other funders cannot see yours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as P5B3RequestCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {P5B3_REQUEST_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p5b3-funder-msg">Your question or request</Label>
            <Textarea
              id="p5b3-funder-msg"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Please confirm the latest audited revenue figure included in the released pack."
            />
          </div>
          <Button onClick={submit} disabled={busy || message.trim().length < 8 || !grantId}>
            Submit for admin review
          </Button>
        </CardContent>
      </Card>
    </P5B3FunderShell>
  );
}
