/**
 * Batch 4 — M005 Authority-to-Act request page (user-facing).
 * Route: /registry/company/:id/authority
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_AUTHORITY_STATE_LABEL,
  REGISTRY_AUTHORITY_BASES,
  type RegistryAuthorityState,
  type RegistryAuthorityBasis,
} from "@/lib/registry-authority";

export default function RegistryAuthority() {
  const { id } = useParams();
  const [companyReference, setCompanyReference] = useState(id ?? "");
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [repName, setRepName] = useState("");
  const [repEmail, setRepEmail] = useState("");
  const [repRole, setRepRole] = useState("");
  const [basis, setBasis] = useState<RegistryAuthorityBasis>("director_or_officer");
  const [emailDomain, setEmailDomain] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<RegistryAuthorityState>("not_started");
  const [declaration, setDeclaration] = useState(false);
  const [consentContact, setConsentContact] = useState(false);
  const [consentEvidence, setConsentEvidence] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function start() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-authority-request", {
        body: { action: "start", company_reference: companyReference, company_name: companyName, country_code: countryCode, representative_name: repName, representative_email: repEmail, representative_role: repRole, authority_basis: basis, company_email_domain: emailDomain || undefined },
      });
      if (error) throw error;
      const d = data as { ok: boolean; authority_request_id: string; status: RegistryAuthorityState };
      setRequestId(d.authority_request_id); setStatus(d.status);
      toast.success("Authority request started");
    } catch (e) { toast.error((e as Error).message); } finally { setSubmitting(false); }
  }

  async function submit() {
    if (!requestId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-authority-request", {
        body: { action: "submit", authority_request_id: requestId, declaration_acknowledged: true, consent_to_contact: true, consent_to_process_evidence: true },
      });
      if (error) throw error;
      setStatus((data as { status: RegistryAuthorityState }).status);
      toast.success("Authority request submitted");
    } catch (e) { toast.error((e as Error).message); } finally { setSubmitting(false); }
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Request authority to act</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Authority to act is recorded separately from any company claim, company-profile
        verification or bank-detail verification.
      </p>
      <ReadinessBanner state="shell_ready" moduleCode="M005" />
      <Card>
        <CardHeader><CardTitle className="text-base">Representative details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Company reference</Label><Input value={companyReference} onChange={(e) => setCompanyReference(e.target.value)} /></div>
          <div><Label>Company name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
          <div><Label>Country code</Label><Input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} placeholder="ZA" /></div>
          <div><Label>Representative name</Label><Input value={repName} onChange={(e) => setRepName(e.target.value)} /></div>
          <div><Label>Representative email</Label><Input value={repEmail} onChange={(e) => setRepEmail(e.target.value)} /></div>
          <div><Label>Role</Label><Input value={repRole} onChange={(e) => setRepRole(e.target.value)} placeholder="Director, CFO, etc." /></div>
          <div>
            <Label>Authority basis</Label>
            <select className="w-full border border-input rounded-md h-10 px-3 text-sm bg-background" value={basis} onChange={(e) => setBasis(e.target.value as RegistryAuthorityBasis)}>
              {REGISTRY_AUTHORITY_BASES.map((b) => <option key={b} value={b}>{b.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div><Label>Company email domain (optional)</Label><Input value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} placeholder="example.com" /></div>
          {!requestId && <Button onClick={start} disabled={submitting}>Start authority request</Button>}
          {requestId && (
            <div className="space-y-2 pt-2 border-t">
              <div className="text-sm">Status: <Badge>{REGISTRY_AUTHORITY_STATE_LABEL[status]}</Badge></div>
              <p className="text-xs text-muted-foreground">
                Authority approval does not verify the company profile or any bank details.
              </p>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm"><Checkbox checked={declaration} onCheckedChange={(v) => setDeclaration(!!v)} /> I declare I am authorised to act for this company within the scope I am about to submit.</label>
                <label className="flex items-start gap-2 text-sm"><Checkbox checked={consentContact} onCheckedChange={(v) => setConsentContact(!!v)} /> Consent to contact for verification purposes.</label>
                <label className="flex items-start gap-2 text-sm"><Checkbox checked={consentEvidence} onCheckedChange={(v) => setConsentEvidence(!!v)} /> Consent to processing of evidence I upload.</label>
              </div>
              <Button onClick={submit} disabled={submitting || !declaration || !consentContact || !consentEvidence}>Submit for review</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
