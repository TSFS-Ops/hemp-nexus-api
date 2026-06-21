/**
 * RegistryAlsoFoundPanel
 *
 * Secondary results panel that augments the Trade Desk's live counterparty
 * search with hits from the Business Registry (Batch 8). It is presentational
 * only — it never promotes registry records into the verified lane, never
 * exposes raw bank or personal contact details, always carries the
 * `imported_unverified` disclaimer, and links to the existing public profile
 * and claim flows. No backend, schema or guard changes.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Database, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IMPORTED_UNVERIFIED_NOTICE } from "@/lib/registry-record-model";

interface RegistryResult {
  id: string;
  country_code: string;
  company_name: string;
  registration_number: string | null;
  vat_number: string | null;
  legal_form: string | null;
  registered_address: string | null;
  source_summary: string | null;
  readiness_label: string;
  claim_status: string;
  claim_available: boolean;
  claim_blocked_reason: string | null;
  match_reasons: Array<{ field_label: string; value_raw: string }>;
  profile_link: string;
}

interface Props {
  /** Raw user query from the Trade Desk search bar. */
  query: string;
  /** Whether the user has actually run a search. Prevents pre-search noise. */
  hasSearched: boolean;
  /** Optional parsed query (we only read location to attempt a country code). */
  parsedQuery: { product: string; location: string; role: "buyer" | "seller" } | null;
  /**
   * Count of network results already shown above this panel. Used purely to
   * label the section ("Also found in the Business Registry" vs primary).
   */
  networkResultCount: number;
}

// Conservative, explicit ISO-2 mapping for the most common phrases the
// trader query parser tends to emit. Anything not in this list is sent
// without a country filter — the registry edge function handles that safely.
const COUNTRY_HINTS: Record<string, string> = {
  "south africa": "ZA",
  "za": "ZA",
  "nigeria": "NG",
  "ng": "NG",
  "kenya": "KE",
  "ghana": "GH",
  "egypt": "EG",
  "india": "IN",
  "united kingdom": "GB",
  "uk": "GB",
  "united states": "US",
  "usa": "US",
  "us": "US",
};

function inferCountryCode(location: string | undefined | null): string | undefined {
  if (!location) return undefined;
  const key = location.trim().toLowerCase();
  return COUNTRY_HINTS[key];
}

export function RegistryAlsoFoundPanel({
  query,
  hasSearched,
  parsedQuery,
  networkResultCount,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RegistryResult[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastQueryRef = useRef<string>("");

  useEffect(() => {
    const trimmed = query.trim();
    if (!hasSearched || trimmed.length < 2) {
      setResults([]);
      setWarning(null);
      setError(null);
      lastQueryRef.current = "";
      return;
    }

    // Avoid re-fetching for the identical query.
    const fingerprint = `${trimmed}::${parsedQuery?.location ?? ""}`;
    if (fingerprint === lastQueryRef.current) return;
    lastQueryRef.current = fingerprint;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke(
          "registry-company-search",
          {
            body: {
              query: trimmed,
              country_code: inferCountryCode(parsedQuery?.location),
            },
          },
        );
        if (cancelled) return;
        if (invokeError) throw invokeError;
        const payload = data as {
          results?: RegistryResult[];
          warning?: string | null;
        };
        setResults((payload?.results ?? []).slice(0, 5));
        setWarning(payload?.warning ?? null);
      } catch (err) {
        if (cancelled) return;
        console.error("Registry search failed:", err);
        setError("Registry lookup temporarily unavailable.");
        setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query, hasSearched, parsedQuery?.location]);

  if (!hasSearched || query.trim().length < 2) return null;
  if (!loading && !error && results.length === 0 && !warning) return null;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      data-testid="registry-also-found-panel"
    >
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap px-4 sm:px-5 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-1">
            Business Registry
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
              {networkResultCount > 0
                ? "Also found in the Business Registry"
                : "Found in the Business Registry"}
            </h3>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-600 text-[10px] font-mono tracking-wider uppercase">
              <Database className="w-3 h-3" />
              imported_unverified
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-slate-50/40">
        <p className="text-[11px] text-slate-600">{IMPORTED_UNVERIFIED_NOTICE}</p>
      </div>

      {loading && (
        <div className="px-4 sm:px-5 py-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching the registry…
        </div>
      )}

      {!loading && error && (
        <div className="px-4 sm:px-5 py-4 text-xs text-amber-700">{error}</div>
      )}

      {!loading && warning === "country_not_production_ready" && (
        <div
          className="px-4 sm:px-5 py-3 text-xs text-amber-700"
          data-testid="registry-coverage-warning"
        >
          Coverage for this country has not been approved for operational use. No registry records will be returned until coverage is approved.
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {results.map((r) => (
            <li
              key={r.id}
              className="px-4 sm:px-5 py-3 hover:bg-slate-50/60 transition-colors"
              data-testid="registry-result-row"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={r.profile_link}
                      className="font-medium text-sm text-slate-900 hover:underline truncate"
                    >
                      {r.company_name}
                    </Link>
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      {r.readiness_label}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {r.country_code}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    {r.registration_number && (
                      <span>Reg. {r.registration_number}</span>
                    )}
                    {r.vat_number && <span>VAT {r.vat_number}</span>}
                    {r.legal_form && <span>{r.legal_form}</span>}
                    {r.registered_address && (
                      <span className="truncate max-w-[36ch]">{r.registered_address}</span>
                    )}
                  </div>
                  {r.match_reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {r.match_reasons.slice(0, 4).map((m, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {m.field_label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                    <Link to={r.profile_link}>
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Open profile
                    </Link>
                  </Button>
                  {r.claim_available ? (
                    <Button asChild size="sm" className="h-8 text-xs">
                      <Link to={`/registry/company/${r.id}/claim`}>
                        Claim
                      </Link>
                    </Button>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-[10px] self-center"
                      title={r.claim_blocked_reason ?? undefined}
                    >
                      Claim unavailable
                    </Badge>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && results.length > 0 && (
        <div className="px-4 sm:px-5 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            Registry records are source-backed and not independently vetted by Izenzo.
          </p>
          <Link
            to={`/registry/search?q=${encodeURIComponent(query.trim())}`}
            className="text-[11px] text-slate-600 hover:underline"
          >
            Refine in registry →
          </Link>
        </div>
      )}
    </div>
  );
}
