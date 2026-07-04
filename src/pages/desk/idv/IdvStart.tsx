/**
 * Batch V-UI — User-facing IDV start screen.
 *
 * Routes strictly by (document_issuing_country, document_type) via the
 * shared route table. Nationality, residence, company country and
 * transaction country are NEVER captured here.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  IDV_ROUTE_TABLE,
  resolveIdvRoute,
  type IdvRouteEntry,
} from "@/lib/idv/route-table";
import { IdvStatusWidget } from "@/components/idv/IdvStatusWidget";
import { idvSafeLabel } from "@/components/idv/idv-status-labels";

// Placeholder country codes routed to Manual review required.
const PLACEHOLDER_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "UG", name: "Uganda" },
  { code: "ZM", name: "Zambia" },
  { code: "CI", name: "Côte d'Ivoire" },
];

const COUNTRY_NAMES: Record<string, string> = {
  ZA: "South Africa",
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  UG: "Uganda",
  ZM: "Zambia",
  CI: "Côte d'Ivoire",
};

interface CountryOption {
  code: string;
  name: string;
  live: boolean;
}

function buildCountries(): CountryOption[] {
  const seen = new Set<string>();
  const out: CountryOption[] = [];
  for (const r of IDV_ROUTE_TABLE) {
    if (!seen.has(r.document_country)) {
      seen.add(r.document_country);
      out.push({
        code: r.document_country,
        name: COUNTRY_NAMES[r.document_country] ?? r.document_country,
        live: true,
      });
    }
  }
  for (const p of PLACEHOLDER_COUNTRIES) {
    if (!seen.has(p.code)) {
      out.push({ code: p.code, name: p.name, live: false });
    }
  }
  out.push({ code: "OTHER", name: "Other country", live: false });
  return out;
}

export default function IdvStart() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isResubmit = searchParams.get("resubmit") === "1";
  const resubmitReason = searchParams.get("reason");
  const countries = useMemo(buildCountries, []);
  const [country, setCountry] = useState<string>("");
  const [docType, setDocType] = useState<string>("");
  const [details, setDetails] = useState<string>("");
  const [consent, setConsent] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcomeStatus, setOutcomeStatus] = useState<string | null>(null);

  const docTypes: IdvRouteEntry[] = useMemo(() => {
    if (!country) return [];
    return IDV_ROUTE_TABLE.filter((r) => r.document_country === country);
  }, [country]);

  useEffect(() => {
    setDocType("");
  }, [country]);

  // Batch V-UI: when the user lands here via the resubmit CTA (widget or
  // deep-link), record the resubmission intent server-side exactly once.
  const [resubmitRecorded, setResubmitRecorded] = useState(false);
  useEffect(() => {
    if (!isResubmit || resubmitRecorded) return;
    (async () => {
      try {
        await supabase.functions.invoke("idv-resubmit", {
          body: {
            reason: resubmitReason || "user_initiated",
            source: "start_screen",
          },
        });
      } catch (err) {
        console.error("[IdvStart] resubmit intent failed", err);
      } finally {
        setResubmitRecorded(true);
      }
    })();
  }, [isResubmit, resubmitReason, resubmitRecorded]);

  const chosenRoute = useMemo(() => {
    if (!country || country === "OTHER") return null;
    if (!docType) return null;
    return resolveIdvRoute({ document_country: country, document_type: docType });
  }, [country, docType]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!country) {
      toast.error("Please select the country that issued your ID document");
      return;
    }
    if (!consent) {
      toast.error("Please confirm you have permission to submit this identity check");
      return;
    }
    setSubmitting(true);
    setOutcomeStatus(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        toast.error("Please sign in to submit an identity check");
        return;
      }
      // Provision subject row (uses existing p5scr_subjects schema).
      const { data: provisionRes, error: provisionErr } = await supabase.functions.invoke(
        "idv-subject-provision",
        {
          body: {
            document_country: country,
            document_type: docType || null,
          },
        },
      );
      if (provisionErr) {
        toast.error("Could not start identity verification. Please try again.");
        return;
      }
      const subjectId = (provisionRes as { subject_id?: string } | null)?.subject_id;

      // If unsupported / placeholder / no route, open a manual review case.
      if (!chosenRoute || chosenRoute.kind === "provider_not_available" || !subjectId) {
        if (subjectId) {
          await supabase.functions.invoke("idv-manual-review", {
            body: {
              subject_id: subjectId,
              decision: "blocked_pending_admin_decision",
              reason: "provider_not_available_from_ui",
              decision_reason: "Provider not available for the selected document country / type",
              document_country: country,
              document_type: docType || null,
              provider_status: "provider_not_available",
            },
          });
        }
        setOutcomeStatus("provider_not_available");
        toast.success("Manual review has been opened");
        return;
      }

      // Live route: sandbox verify.
      const { data: verifyRes, error: verifyErr } = await supabase.functions.invoke(
        "idv-verify",
        {
          body: {
            subject_id: subjectId,
            document_country: country,
            document_type: docType,
            details_text: details.slice(0, 1024),
          },
        },
      );
      if (verifyErr) {
        setOutcomeStatus("provider_pending");
        toast.message("Submission received", {
          description: "Your identity check is being processed.",
        });
        return;
      }
      const status = (verifyRes as { internal_status?: string } | null)?.internal_status ?? "provider_pending";
      setOutcomeStatus(status);
      toast.success(idvSafeLabel(status).label);
    } catch (err) {
      console.error("[IdvStart] submit failed", err);
      toast.error("Could not submit identity check. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const chosenIsProviderNotAvailable =
    chosenRoute?.kind === "provider_not_available" ||
    (country && country !== "OTHER" && PLACEHOLDER_COUNTRIES.some((c) => c.code === country)) ||
    country === "OTHER";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Identity verification</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verify the identity of the authorised representative. This is a
          person-only check. Company readiness depends on other requirements.
        </p>
      </div>

      <IdvStatusWidget />

      {isResubmit && (
        <Alert data-testid="idv-resubmit-banner">
          <AlertTitle>{idvSafeLabel(resubmitReason).label}</AlertTitle>
          <AlertDescription>
            {idvSafeLabel(resubmitReason).next_action} Please submit a fresh
            identity check below.
          </AlertDescription>
        </Alert>
      )}



      <Card>
        <CardHeader>
          <CardTitle>New identity check</CardTitle>
          <CardDescription>
            Please select the country that issued your ID document, then choose
            your document type.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={onSubmit} data-testid="idv-start-form">
            <div className="space-y-2">
              <Label htmlFor="idv-country">
                Select the country that issued your ID document
              </Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="idv-country" data-testid="idv-country-select">
                  <SelectValue placeholder="Choose issuing country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name} {c.live ? "" : "(manual review)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="idv-doc-type">Select your document type</Label>
              <Select
                value={docType}
                onValueChange={setDocType}
                disabled={!country || docTypes.length === 0}
              >
                <SelectTrigger id="idv-doc-type" data-testid="idv-doctype-select">
                  <SelectValue
                    placeholder={
                      docTypes.length === 0
                        ? "No live document types for this country"
                        : "Choose document type"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {docTypes.map((r) => (
                    <SelectItem key={r.document_type} value={r.document_type}>
                      {r.user_wording.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chosenIsProviderNotAvailable && (
                <p className="text-sm text-muted-foreground" data-testid="idv-manual-review-notice">
                  Provider not available for this selection. Submitting will
                  open a manual review case.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="idv-details">Enter the details for this document</Label>
              <Textarea
                id="idv-details"
                data-testid="idv-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Enter the required details for the selected document type."
                rows={4}
                maxLength={1024}
              />
              <p className="text-xs text-muted-foreground">
                Do not include ID photos, selfies or biometric data.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="idv-consent"
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                data-testid="idv-consent"
              />
              <Label htmlFor="idv-consent" className="text-sm font-normal leading-snug">
                I confirm that I have permission to submit this identity check.
              </Label>
            </div>

            <div className="flex justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/desk")}
              >
                Back to dashboard
              </Button>
              <Button
                type="submit"
                disabled={submitting || !consent || !country}
                data-testid="idv-submit"
              >
                {submitting ? "Submitting…" : "Submit identity check"}
              </Button>
            </div>
          </form>

          {outcomeStatus && (
            <Alert className="mt-6" data-testid="idv-outcome">
              <AlertTitle>{idvSafeLabel(outcomeStatus).label}</AlertTitle>
              <AlertDescription>
                {idvSafeLabel(outcomeStatus).next_action}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
