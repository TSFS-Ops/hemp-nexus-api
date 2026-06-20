/**
 * Batch 4 — M006 / M007 Bank-detail capture and status page (user-facing).
 * Route: /registry/company/:id/bank-details
 *
 * Mandatory user-facing copy (pinned verbatim by check-registry-batch4-wording.mjs):
 * "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry."
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_BANK_DETAIL_STATE_LABEL,
  REGISTRY_BANK_DETAIL_CONSENT_SCOPES,
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  type RegistryBankDetailState,
  type RegistryBankDetailConsentScope,
} from "@/lib/registry-bank-details";

type Row = {
  id: string;
  status: RegistryBankDetailState;
  masked_account_holder: string | null;
  masked_bank_name: string | null;
  masked_account_number: string | null;
  masked_iban: string | null;
  verified_at: string | null;
  expiry_at: string | null;
};

export default function RegistryBankDetails() {
  const { id } = useParams();
  const [authorityId, setAuthorityId] = useState("");
  const [companyReference, setCompanyReference] = useState(id ?? "");
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [holder, setHolder] = useState("");
  const [bankName, setBankName] = useState("");
  // Sensitive identifier fields below — captured ONLY in this controlled form
  // and immediately sent to the audited edge function. Never persisted in
  // local storage; masked previews are what we display on subsequent reads.
  const [acctRaw, setAcctRaw] = useState("");
  const [ibanRaw, setIbanRaw] = useState("");
  const [branchRaw, setBranchRaw] = useState("");
  const [swiftRaw, setSwiftRaw] = useState("");
  const [scopes, setScopes] = useState<Set<RegistryBankDetailConsentScope>>(new Set(["internal_verification","audit_retention"]));
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    const { data } = await supabase
      .from("registry_bank_detail_submissions")
      .select("id, status, masked_account_holder, masked_bank_name, masked_account_number, masked_iban, verified_at, expiry_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setRows((data as Row[] | null) ?? []);
  }
  useEffect(() => { load(); }, []);

  function toggleScope(s: RegistryBankDetailConsentScope) {
    const n = new Set(scopes); n.has(s) ? n.delete(s) : n.add(s); setScopes(n);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-bank-detail-submit", {
        body: {
          authority_request_id: authorityId, company_reference: companyReference, company_name: companyName,
          country_code: countryCode, currency_code: currencyCode, account_holder_name: holder, bank_name: bankName,
          account_number: acctRaw || undefined, iban: ibanRaw || undefined,
          branch_code: branchRaw || undefined, swift_bic: swiftRaw || undefined,
          consent_scopes: Array.from(scopes), acknowledged_captured_not_verified: true,
        },
      });
      if (error) throw error;
      toast.success("Captured (not verified). Status: captured_unverified.");
      setAcctRaw(""); setIbanRaw(""); setBranchRaw(""); setSwiftRaw("");
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setSubmitting(false); }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Bank details</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M006" />
      <Alert>
        <AlertTitle>Captured does not mean verified</AlertTitle>
        <AlertDescription className="text-xs">{REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Submit bank details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Approved authority request ID</Label><Input value={authorityId} onChange={(e) => setAuthorityId(e.target.value)} placeholder="uuid of approved/conditionally_approved authority" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Company reference</Label><Input value={companyReference} onChange={(e) => setCompanyReference(e.target.value)} /></div>
            <div><Label>Company name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
            <div><Label>Country</Label><Input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} placeholder="ZA" /></div>
            <div><Label>Currency</Label><Input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="ZAR" /></div>
            <div><Label>Account holder name</Label><Input value={holder} onChange={(e) => setHolder(e.target.value)} /></div>
            <div><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
            <div><Label>Local account identifier (optional)</Label><Input value={acctRaw} onChange={(e) => setAcctRaw(e.target.value)} placeholder="local identifier" /></div>
            <div><Label>International identifier (optional)</Label><Input value={ibanRaw} onChange={(e) => setIbanRaw(e.target.value)} placeholder="international identifier" /></div>
            <div><Label>Branch/routing (optional)</Label><Input value={branchRaw} onChange={(e) => setBranchRaw(e.target.value)} /></div>
            <div><Label>SWIFT/BIC (optional)</Label><Input value={swiftRaw} onChange={(e) => setSwiftRaw(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Consent scopes</Label>
            {REGISTRY_BANK_DETAIL_CONSENT_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <Checkbox checked={scopes.has(s)} onCheckedChange={() => toggleScope(s)} /> {s.replace(/_/g, " ")}
              </label>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} />
            I acknowledge that captured bank details are not verified bank details.
          </label>
          <Button onClick={submit} disabled={submitting || !ack || !authorityId}>Submit (captured, not verified)</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Your bank-detail submissions</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No submissions.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Bank</th><th>Masked account</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.masked_bank_name}</td>
                    <td>{r.masked_account_number ?? r.masked_iban ?? "—"}</td>
                    <td><Badge>{REGISTRY_BANK_DETAIL_STATE_LABEL[r.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
