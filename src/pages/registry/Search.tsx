/**
 * Batch 3 — M002 Public Company Search shell. Search UI with filters, but no
 * production records are loaded. Results panel is always an empty state with
 * the readiness banner and country coverage warning.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_SEARCH_RESULT_LABELS,
  type RegistrySearchResultLabel,
} from "@/lib/registry-claims";

export default function RegistrySearch() {
  const [query, setQuery] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function onSearch() {
    setLoading(true);
    setWarning(null);
    try {
      const { data, error } = await supabase.functions.invoke("registry-company-search", {
        body: { query, country_code: countryCode || undefined, registration_number: registrationNumber || undefined },
      });
      if (error) throw error;
      setWarning((data as { warning: string | null } | null)?.warning ?? null);
      setSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Company search</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M002" />

      <Card>
        <CardHeader><CardTitle className="text-base">Search filters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="q" className="text-xs">Company name or trading name</Label>
            <Input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Acme Trading Ltd" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc" className="text-xs">Country</Label>
              <Input id="cc" maxLength={3} value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} placeholder="ZA" />
            </div>
            <div>
              <Label htmlFor="rn" className="text-xs">Registration number</Label>
              <Input id="rn" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
            </div>
          </div>
          <Button onClick={onSearch} disabled={loading} data-testid="registry-search-submit">
            {loading ? "Searching…" : "Search"}
          </Button>
        </CardContent>
      </Card>

      {searched && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Results</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {warning === "country_not_production_ready" && (
              <p className="text-xs text-amber-700" data-testid="country-coverage-warning">
                Coverage for this country is below production-ready status. No records will be returned until coverage is approved through a recorded business decision.
              </p>
            )}
            <p className="text-sm text-muted-foreground" data-testid="search-empty-state">
              No records are loaded in this release. The search shell is operating in safe mode.
            </p>
            <div className="flex flex-wrap gap-1 pt-2">
              {(REGISTRY_SEARCH_RESULT_LABELS as readonly RegistrySearchResultLabel[]).map((l) => (
                <Badge key={l} variant="secondary" className="text-[10px] font-mono">{l}</Badge>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Result label keys above are the only permitted statuses for future production results.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
