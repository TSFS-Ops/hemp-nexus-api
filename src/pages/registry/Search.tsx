/**
 * Batch 8 — Working public registry search.
 *
 * Queries the registry-company-search edge function and renders matched
 * company records with match-reason labels, readiness, claim
 * availability, and a no-result flow that links to the new-company
 * request workflow built in Batch 7.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { IMPORTED_UNVERIFIED_NOTICE } from "@/lib/registry-record-model";

interface SearchResult {
  id: string;
  country_code: string;
  company_name: string;
  registration_number: string | null;
  local_number: string | null;
  vat_number: string | null;
  legal_form: string | null;
  company_status: string | null;
  registered_address: string | null;
  source_summary: string | null;
  source_generated_date: string | null;
  readiness_label: string;
  claim_status: string;
  claim_available: boolean;
  claim_blocked_reason: string | null;
  match_reasons: Array<{ field_label: string; value_raw: string }>;
  profile_link: string;
}

export default function RegistrySearch() {
  const [query, setQuery] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  async function onSearch() {
    setLoading(true);
    setWarning(null);
    try {
      const { data, error } = await supabase.functions.invoke("registry-company-search", {
        body: {
          query: query || undefined,
          country_code: countryCode || undefined,
          registration_number: registrationNumber || undefined,
          vat_number: vatNumber || undefined,
          legal_form: legalForm || undefined,
          address: address || undefined,
        },
      });
      if (error) throw error;
      const payload = data as { results?: SearchResult[]; warning?: string | null };
      setResults(payload?.results ?? []);
      setWarning(payload?.warning ?? null);
      setSearched(true);
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-1">Company search</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Search by name, registration number, VAT/tax number, address, country or legal form.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Search</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="q" className="text-xs">Company name, trading name or previous name</Label>
            <Input id="q" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="e.g. Greenstone Logistics" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="cc" className="text-xs">Country</Label>
              <Input id="cc" maxLength={3} value={countryCode}
                     onChange={(e) => setCountryCode(e.target.value.toUpperCase())} placeholder="ZA" />
            </div>
            <div>
              <Label htmlFor="rn" className="text-xs">Registration number</Label>
              <Input id="rn" maxLength={60} value={registrationNumber}
                     onChange={(e) => setRegistrationNumber(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vn" className="text-xs">VAT / tax number</Label>
              <Input id="vn" maxLength={60} value={vatNumber}
                     onChange={(e) => setVatNumber(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lf" className="text-xs">Legal form (Ltd, Pty, CC, PLC)</Label>
              <Input id="lf" maxLength={40} value={legalForm}
                     onChange={(e) => setLegalForm(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ad" className="text-xs">Registered address</Label>
              <Input id="ad" maxLength={200} value={address}
                     onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
          <Button onClick={onSearch} disabled={loading} data-testid="registry-search-submit">
            {loading ? "Searching…" : "Search"}
          </Button>
          <p className="text-[11px] text-muted-foreground">{IMPORTED_UNVERIFIED_NOTICE}</p>
        </CardContent>
      </Card>

      {searched && (
        <div className="mt-4 space-y-3">
          {warning === "country_not_production_ready" && (
            <p className="text-xs text-amber-700" data-testid="country-coverage-warning">
              Coverage for this country has not been approved for operational use. No records will be returned until coverage is approved through a recorded business decision.
            </p>
          )}

          {results.length === 0 && (
            <Card data-testid="search-no-results">
              <CardContent className="py-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">No matching companies were found.</p>
                <p className="text-sm">Can't find the company?</p>
                <Button asChild>
                  <Link to="/registry/new-company-request" data-testid="new-company-request-cta">
                    Submit a new-company request
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {results.map((r) => (
            <Card key={r.id} data-testid="search-result-card">
              <CardHeader>
                <CardTitle className="text-base flex items-start justify-between gap-3">
                  <span>{r.company_name}</span>
                  <Badge variant="secondary" className="text-[10px] font-mono">{r.readiness_label}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-muted-foreground">Country:</span> {r.country_code}</div>
                  <div><span className="text-muted-foreground">Legal form:</span> {r.legal_form ?? "—"}</div>
                  <div><span className="text-muted-foreground">Reg. no.:</span> {r.registration_number ?? "—"}</div>
                  <div><span className="text-muted-foreground">VAT/Tax:</span> {r.vat_number ?? "—"}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Address:</span> {r.registered_address ?? "—"}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Source:</span> {r.source_summary ?? "—"}</div>
                </div>
                {r.match_reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1" data-testid="match-reasons">
                    {r.match_reasons.map((m, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{m.field_label}</Badge>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-amber-700">Source-backed record. Not independently verified by Izenzo.</p>
                <div className="flex gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <Link to={r.profile_link} data-testid="open-profile-cta">Open profile</Link>
                  </Button>
                  {r.claim_available ? (
                    <Button asChild size="sm">
                      <Link to={`/registry/company/${r.id}/claim`} data-testid="claim-cta">Claim this company</Link>
                    </Button>
                  ) : (
                    <Badge variant="secondary" className="self-center text-[10px]" data-testid="claim-blocked">
                      {r.claim_blocked_reason ?? "Claim not available for this record."}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
