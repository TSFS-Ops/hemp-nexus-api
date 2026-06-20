/**
 * Batch 2 — Admin Country Coverage matrix (M011). Read-only display of every
 * country's coverage state per surface. Transitions go through the
 * registry-country-coverage-update edge function.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  COUNTRY_COVERAGE_LABEL,
  canShowAsProductionReady,
  isSeedOnly,
  type CountryCoverageState,
} from "@/lib/registry-country-coverage";

interface CoverageRow {
  country_code: string;
  country_name: string;
  coverage_state: CountryCoverageState;
  registry_data_state: CountryCoverageState;
  claim_company_state: CountryCoverageState;
  authority_verification_state: CountryCoverageState;
  bank_detail_verification_state: CountryCoverageState;
  api_output_state: CountryCoverageState;
  outreach_state: CountryCoverageState;
  demo_readiness_state: CountryCoverageState;
  public_wording_allowed: boolean;
}

export function CountryCoverageMatrix() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("registry_country_coverage" as never)
          .select("country_code, country_name, coverage_state, registry_data_state, claim_company_state, authority_verification_state, bank_detail_verification_state, api_output_state, outreach_state, demo_readiness_state, public_wording_allowed")
          .order("country_name", { ascending: true });
        setRows((data ?? []) as unknown as CoverageRow[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Country coverage</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Seed-only or sample-only countries are framework placeholders and
          must never be presented as a record of truth.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Registry</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>API</TableHead>
                  <TableHead>Outreach</TableHead>
                  <TableHead>Demo</TableHead>
                  <TableHead>Public wording</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.country_code} data-testid={`country-row-${r.country_code}`}>
                    <TableCell className="font-mono text-xs">{r.country_code}</TableCell>
                    <TableCell>{r.country_name}</TableCell>
                    <TableCell><CoverageBadge state={r.coverage_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.registry_data_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.claim_company_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.authority_verification_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.bank_detail_verification_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.api_output_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.outreach_state} /></TableCell>
                    <TableCell><CoverageBadge state={r.demo_readiness_state} /></TableCell>
                    <TableCell className="text-xs">
                      {r.public_wording_allowed && canShowAsProductionReady(r.coverage_state)
                        ? "Allowed"
                        : isSeedOnly(r.coverage_state)
                        ? "Blocked (seed)"
                        : "Not allowed"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoverageBadge({ state }: { state: CountryCoverageState }) {
  const variant: "default" | "outline" | "secondary" =
    state === "production_ready" ? "default"
    : state === "no_coverage" ? "outline"
    : "secondary";
  return <Badge variant={variant} className="text-xs">{COUNTRY_COVERAGE_LABEL[state]}</Badge>;
}
