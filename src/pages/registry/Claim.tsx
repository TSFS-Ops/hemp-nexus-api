/**
 * Batch 3 — M004 Claim Your Company form (claimant-facing).
 * Shared by /registry/claim and /registry/company/:id/claim.
 */
import { useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { REGISTRY_CLAIM_STATE_LABEL, type RegistryClaimState } from "@/lib/registry-claims";

interface ClaimPrefill {
  company_reference?: string;
  company_name?: string;
  registration_number?: string;
  country_code?: string;
}

export default function RegistryClaim() {
  const { id } = useParams();
  const location = useLocation();
  const prefill = (location.state as { prefill?: ClaimPrefill } | null)?.prefill ?? {};
  const [companyReference, setCompanyReference] = useState(prefill.company_reference ?? id ?? "");
  const [companyName, setCompanyName] = useState(prefill.company_name ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(prefill.registration_number ?? "");
  const [countryCode, setCountryCode] = useState(prefill.country_code ?? "");
  const [claimantName, setClaimantName] = useState("");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [claimantRole, setClaimantRole] = useState("");
  const [relationship, setRelationship] = useState("");
  const [companyDomain, setCompanyDomain] = useState("");

  const [declaration, setDeclaration] = useState(false);
  const [consentContact, setConsentContact] = useState(false);
  const [consentEvidence, setConsentEvidence] = useState(false);

  const [claimId, setClaimId] = useState<string | null>(null);
  const [status, setStatus] = useState<RegistryClaimState>("unclaimed");
  const [submitting, setSubmitting] = useState(false);

  async function start() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-company-claim", {
        body: {
          action: "start",
          company_reference: companyReference,
          company_name: companyName,
          registration_number: registrationNumber || undefined,
          country_code: countryCode,
          claimant_name: claimantName,
          claimant_email: claimantEmail,
          claimant_role: claimantRole,
          company_relationship: relationship,
          company_email_domain: companyDomain || undefined,
        },
      });
      if (error) throw error;
      const res = data as { claim_id: string; status: RegistryClaimState };
      setClaimId(res.claim_id);
      setStatus(res.status);
      toast.success("Claim started");
    } catch (err) {
      toast.error("Could not start claim", { description: String(err) });
    } finally { setSubmitting(false); }
  }

  async function submitClaim() {
    if (!claimId) return;
    if (!declaration || !consentContact || !consentEvidence) {
      toast.error("All declarations and consents are required");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-company-claim", {
        body: {
          action: "submit",
          claim_id: claimId,
          declaration_of_authority: true,
          consent_to_contact: true,
          consent_to_process_evidence: true,
        },
      });
      if (error) throw error;
      const res = data as { status: RegistryClaimState };
      setStatus(res.status);
      toast.success("Claim submitted for review");
    } catch (err) {
      toast.error("Could not submit claim", { description: String(err) });
    } finally { setSubmitting(false); }
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Claim your company</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M004" />

      <Card>
        <CardHeader><CardTitle className="text-base">Claim details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!claimId && (
            <>
              <div><Label className="text-xs">Company identifier / reference</Label><Input value={companyReference} onChange={(e) => setCompanyReference(e.target.value)} /></div>
              <div><Label className="text-xs">Company name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Registration number</Label><Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} /></div>
                <div><Label className="text-xs">Country</Label><Input maxLength={3} value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Your name</Label><Input value={claimantName} onChange={(e) => setClaimantName(e.target.value)} /></div>
                <div><Label className="text-xs">Your email</Label><Input type="email" value={claimantEmail} onChange={(e) => setClaimantEmail(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Your role / title</Label><Input value={claimantRole} onChange={(e) => setClaimantRole(e.target.value)} /></div>
                <div><Label className="text-xs">Relationship to company</Label><Input value={relationship} onChange={(e) => setRelationship(e.target.value)} /></div>
              </div>
              <div><Label className="text-xs">Company email domain (optional)</Label><Input value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} placeholder="acme.com" /></div>
              <Button onClick={start} disabled={submitting} data-testid="claim-start-btn">Start claim</Button>
            </>
          )}

          {claimId && (
            <>
              <div className="text-xs text-muted-foreground">Claim ID: <span className="font-mono">{claimId}</span></div>
              <div>Status: <Badge variant="secondary" data-testid="claim-status-badge">{REGISTRY_CLAIM_STATE_LABEL[status]}</Badge></div>

              {status === "claim_started" && (
                <>
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-semibold">Declarations</p>
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox checked={declaration} onCheckedChange={(v) => setDeclaration(v === true)} data-testid="claim-decl-authority" />
                      <span>I declare that I have authority to claim this company on its behalf.</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox checked={consentContact} onCheckedChange={(v) => setConsentContact(v === true)} data-testid="claim-consent-contact" />
                      <span>I consent to being contacted about this claim.</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox checked={consentEvidence} onCheckedChange={(v) => setConsentEvidence(v === true)} data-testid="claim-consent-evidence" />
                      <span>I consent to my evidence being processed for claim review purposes.</span>
                    </label>
                  </div>
                  <Button onClick={submitClaim} disabled={submitting} data-testid="claim-submit-btn">Submit claim for review</Button>
                </>
              )}

              {status === "claim_submitted" && (
                <p className="text-xs text-muted-foreground">Your claim has been submitted. A reviewer will contact you. Submitting a claim does not confer authority-to-act or profile accuracy on this company.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
