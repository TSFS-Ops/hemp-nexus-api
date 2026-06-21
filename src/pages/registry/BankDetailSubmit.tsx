/**
 * Batch 13B — User-facing bank-detail submission start + form.
 * Routes:
 *   /registry/bank-details                       (start: pick active authority + draft)
 *   /registry/company/:id/bank-details/submit    (start with company context)
 *
 * Flow:
 *   1. Load the user's active authorities and filter to those holding the
 *      `bank_detail_submission` (or `bank_detail_update`) scope.
 *   2. Show authority-gated blocker if none.
 *   3. Country-aware form using REGISTRY_BANK_DETAIL_B13_COUNTRY_REQUIREMENTS.
 *   4. Consent + declaration both required before submit.
 *   5. On submit, calls registry-bank-detail-submit and navigates to the
 *      masked status page; no raw account fields are rendered after submit.
 *
 * Raw bank details are NEVER rendered on this page after submit. Captured
 * details are not verified bank details — captured_unverified is shown as
 * not verified.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES,
  REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING,
  REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS,
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  findMissingBankFields,
  getBankDetailCountryRequirements,
} from "@/lib/registry-bank-details-b13";
import { REGISTRY_BANK_DETAIL_CONSENT_SCOPES } from "@/lib/registry-bank-details";
import {
  REGISTRY_BANK_DETAIL_B13_UI_AUTHORITY_BLOCKER,
  REGISTRY_BANK_DETAIL_B13_UI_DECLARATION,
  REGISTRY_BANK_DETAIL_B13_UI_RAW_BLOCKED_NOTICE,
} from "@/lib/registry-bank-details-b13-ui";

type ActiveAuthority = {
  id: string;
  authority_request_id: string;
  company_reference: string;
  scope_code: string;
  status: string;
  expiry_at: string | null;
};

type CompanyLite = {
  company_reference: string;
  company_name: string;
  country_code: string;
};

export default function BankDetailSubmit() {
  const { id: companyIdParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [authorities, setAuthorities] = useState<ActiveAuthority[]>([]);
  const [companies, setCompanies] = useState<Record<string, CompanyLite>>({});
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string>("");
  const [intendedAction, setIntendedAction] = useState<"submit" | "update">("submit");
  const [form, setForm] = useState<Record<string, string>>({});
  const [holderKind, setHolderKind] = useState<typeof REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS[number]>("company");
  const [isThirdParty, setIsThirdParty] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (!uid) {
          setLoading(false);
          return;
        }
        // Load active authorities scoped to bank-detail actions only.
        const { data: rows } = await supabase
          .from("registry_active_authorities")
          .select("id, authority_request_id, company_reference, scope_code, status, expiry_at")
          .eq("user_id", uid)
          .in("scope_code", ["bank_detail_submission", "bank_detail_update"])
          .eq("status", "active");
        const list = (rows ?? []) as ActiveAuthority[];
        setAuthorities(list);

        const refs = Array.from(new Set(list.map((r) => r.company_reference)));
        if (refs.length) {
          const { data: cos } = await supabase
            .from("registry_company_records")
            .select("company_reference, company_name, country_code")
            .in("company_reference", refs);
          const map: Record<string, CompanyLite> = {};
          for (const c of (cos ?? []) as CompanyLite[]) map[c.company_reference] = c;
          setCompanies(map);
        }

        // Pre-select via ?authority=...
        const preferred = params.get("authority");
        if (preferred && list.some((r) => r.authority_request_id === preferred)) {
          setSelectedAuthorityId(preferred);
        } else if (companyIdParam) {
          const match = list.find((r) => r.company_reference === companyIdParam);
          if (match) setSelectedAuthorityId(match.authority_request_id);
        }
      } catch (err) {
        console.error("BankDetailSubmit load failed", err);
        toast.error("Could not load active authorities");
      } finally {
        setLoading(false);
      }
    })();
  }, [companyIdParam, params]);

  const selectedAuthority = useMemo(
    () => authorities.find((a) => a.authority_request_id === selectedAuthorityId) ?? null,
    [authorities, selectedAuthorityId],
  );
  const selectedCompany = selectedAuthority ? companies[selectedAuthority.company_reference] ?? null : null;
  const countryCode = selectedCompany?.country_code ?? "DEFAULT";
  const requirements = useMemo(() => getBankDetailCountryRequirements(countryCode), [countryCode]);

  const missing = useMemo(() => {
    if (!selectedCompany) return requirements.requiredFields;
    return findMissingBankFields(countryCode, {
      ...form,
      company_reference: selectedCompany.company_reference,
      country_code: countryCode,
    });
  }, [form, selectedCompany, countryCode, requirements]);

  const canSubmit =
    !submitting &&
    !!selectedAuthority &&
    !!selectedCompany &&
    missing.length === 0 &&
    consentAccepted &&
    declarationAccepted;

  const handleField = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!selectedAuthority || !selectedCompany) return;
    try {
      setSubmitting(true);
      const body = {
        authority_request_id: selectedAuthority.authority_request_id,
        company_reference: selectedCompany.company_reference,
        company_name: selectedCompany.company_name,
        country_code: countryCode,
        currency_code: form.currency_code || "ZAR",
        account_type: form.account_type || undefined,
        account_holder_name: form.account_holder_name,
        bank_name: form.bank_name,
        account_number: form.account_number || undefined,
        iban: form.iban || undefined,
        branch_code: form.branch_code || undefined,
        swift_bic: form.swift_bic || undefined,
        bank_code: form.bank_code || undefined,
        routing_number: form.routing_number || undefined,
        sort_code: form.sort_code || undefined,
        branch_name: form.branch_name || undefined,
        bank_country_code: form.bank_country_code || countryCode,
        account_holder_kind: holderKind,
        is_third_party: isThirdParty,
        is_primary_account: true,
        consent_scopes: REGISTRY_BANK_DETAIL_CONSENT_SCOPES,
        b13_consent_scopes: REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES,
        acknowledged_captured_not_verified: true as const,
        declaration_acknowledged: true as const,
        intended_action: intendedAction,
      };
      const { data, error } = await supabase.functions.invoke("registry-bank-detail-submit", { body });
      if (error) throw error;
      const result = data as { ok?: boolean; submission_id?: string; error?: string };
      if (!result.ok || !result.submission_id) {
        throw new Error(result.error ?? "submit_failed");
      }
      toast.success("Bank details submitted for review (not verified).");
      navigate(`/registry/bank-details/${result.submission_id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("submit failed", err);
      toast.error(`Submission failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading active authorities…</div>;
  }

  if (authorities.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <BackButton fallback="/registry" />
        <h1 className="text-xl font-semibold">Submit bank details</h1>
        <Alert>
          <AlertTitle>Authority required</AlertTitle>
          <AlertDescription>{REGISTRY_BANK_DETAIL_B13_UI_AUTHORITY_BLOCKER}</AlertDescription>
        </Alert>
        <p className="text-xs text-muted-foreground">
          Claim approval alone is not sufficient. Request an authority-to-act with the
          <span className="font-mono mx-1">bank_detail_submission</span>
          scope from the company profile.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <BackButton fallback="/registry" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Submit bank details</h1>
        <p className="text-xs text-muted-foreground">{REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">1. Confirm authority and company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Active authority</Label>
            <Select value={selectedAuthorityId} onValueChange={setSelectedAuthorityId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an active authority" />
              </SelectTrigger>
              <SelectContent>
                {authorities.map((a) => {
                  const co = companies[a.company_reference];
                  return (
                    <SelectItem key={a.authority_request_id} value={a.authority_request_id}>
                      {co?.company_name ?? a.company_reference} — {a.scope_code}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {selectedAuthority && (
            <div className="text-xs text-muted-foreground">
              Scope:&nbsp;<Badge variant="outline">{selectedAuthority.scope_code}</Badge>
              {selectedAuthority.expiry_at && (
                <span className="ml-2">Expires {new Date(selectedAuthority.expiry_at).toLocaleDateString()}</span>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label>Action</Label>
            <Select value={intendedAction} onValueChange={(v) => setIntendedAction(v as "submit" | "update")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="submit">First submission</SelectItem>
                <SelectItem value="update">Update existing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">2. Bank details ({countryCode})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...requirements.requiredFields, ...requirements.optionalFields]
            .filter((f) => f !== "company_reference" && f !== "country_code")
            .map((field) => (
              <div key={field} className="space-y-1">
                <Label className="text-xs">
                  {field.replace(/_/g, " ")}
                  {requirements.requiredFields.includes(field) && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  value={form[field] ?? ""}
                  onChange={(e) => handleField(field, e.target.value)}
                  placeholder={field}
                  data-testid={`bd-field-${field}`}
                />
              </div>
            ))}
          <div className="space-y-1">
            <Label className="text-xs">Account holder kind</Label>
            <Select value={holderKind} onValueChange={(v) => setHolderKind(v as typeof holderKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={isThirdParty} onCheckedChange={(c) => setIsThirdParty(c === true)} />
            <span>This is a third-party account (will be flagged for review)</span>
          </label>
          {missing.length > 0 && selectedCompany && (
            <p className="text-xs text-amber-700">
              Missing required: {missing.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">3. Consent and declaration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertTitle>Consent</AlertTitle>
            <AlertDescription className="text-xs">{REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING}</AlertDescription>
          </Alert>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox
              checked={consentAccepted}
              onCheckedChange={(c) => setConsentAccepted(c === true)}
              data-testid="bd-consent"
            />
            <span>I accept the consent wording above.</span>
          </label>
          <Alert>
            <AlertTitle>Declaration</AlertTitle>
            <AlertDescription className="text-xs">{REGISTRY_BANK_DETAIL_B13_UI_DECLARATION}</AlertDescription>
          </Alert>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox
              checked={declarationAccepted}
              onCheckedChange={(c) => setDeclarationAccepted(c === true)}
              data-testid="bd-declaration"
            />
            <span>I accept the declaration above.</span>
          </label>
          <p className="text-[11px] text-muted-foreground">{REGISTRY_BANK_DETAIL_B13_UI_RAW_BLOCKED_NOTICE}</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="bd-submit">
          {submitting ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </div>
  );
}
