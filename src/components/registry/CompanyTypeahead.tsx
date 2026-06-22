/**
 * Batch 23 — Registry typeahead company search.
 *
 * A keyboard-accessible combobox that calls the existing
 * registry-company-search edge function with a small limit (8) and a
 * 200ms debounce, and opens the company profile on selection.
 *
 * Safety rails:
 *   • Only the same public-tier fields already returned by
 *     registry-company-search are rendered (company name, country,
 *     registration number, legal form, readiness label, safe match
 *     reasons). No bank, no personal email/phone, no evidence, no
 *     compliance notes, no provider payloads.
 *   • Sample / imported_unverified records are tagged with a
 *     "Sample record" chip so they are never mistaken for source-vetted
 *     records.

 *   • "Show all results" preserves the query and the active Trade
 *     Desk shell base path (Batch 22).
 *   • Wording never asserts verification.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useRegistryBase, rebaseRegistryPath } from "@/lib/use-registry-base";

type MatchReason = { field_label: string; value_raw: string };

interface TypeaheadResult {
  id: string;
  country_code: string;
  company_name: string;
  registration_number: string | null;
  legal_form: string | null;
  readiness_label: string;
  match_reasons: MatchReason[];
  profile_link: string;
}

// Split text on case-insensitive matches of any query token (≥2 chars)
// and wrap matches in <mark>. Defensive against regex metacharacters so a
// user query like "(pty)" cannot break the highlighter.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text) return text;
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map(escapeRegex);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.join("|")})`, "ig");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        data-testid="typeahead-highlight"
        className="rounded-sm bg-amber-100 px-0.5 text-amber-900"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}




// Safe match-reason field labels we are willing to render in the
// dropdown. Anything outside this set is dropped client-side as a
// defence-in-depth measure so unsafe categories cannot leak through
// future edge-function changes.
const SAFE_MATCH_FIELDS = new Set([
  "Company name",
  "Trading name",
  "Previous name",
  "Registration number",
  "Local number",
  "VAT number",
  "Tax number",
  "Legal form",
  "Country",
  "Registered address",
  "Activity",
  "Industry",
  "Officer",
  "Director",
  "Member",
]);

function isSampleReadiness(label: string | null | undefined): boolean {
  if (!label) return false;
  return label === "imported_unverified" || label === "sample_only";
}

export function CompanyTypeahead({
  countryCode,
  initialQuery = "",
}: {
  countryCode?: string;
  initialQuery?: string;
}) {
  const navigate = useNavigate();
  const base = useRegistryBase();
  const inputId = useId();
  const listId = useId();

  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TypeaheadResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [active, setActive] = useState(0);

  const requestSeqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced fetch — stale responses are discarded by sequence number.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "registry-company-search",
          {
            body: {
              query: q,
              country_code: countryCode || undefined,
              limit: 8,
            },
          },
        );
        if (seq !== requestSeqRef.current) return; // stale
        if (error) {
          setResults([]);
          setHasMore(false);
          return;
        }
        const payload = data as {
          results?: TypeaheadResult[];
          next_cursor?: string | null;
        };
        const incoming = (payload?.results ?? []).map((r) => ({
          ...r,
          match_reasons: (r.match_reasons ?? []).filter((m) =>
            SAFE_MATCH_FIELDS.has(m.field_label),
          ),
        }));
        setResults(incoming);
        setHasMore(Boolean(payload?.next_cursor));
        setActive(0);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, countryCode]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function pick(r: TypeaheadResult) {
    setOpen(false);
    navigate(rebaseRegistryPath(r.profile_link, base));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const target = results[active];
      if (target) {
        e.preventDefault();
        pick(target);
      }
    }
  }

  const showPanel =
    open && query.trim().length >= 2 && (loading || results.length > 0 || !loading);

  const showAllHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("q", query.trim());
    if (countryCode) params.set("country", countryCode);
    return `${base}/search?${params.toString()}`;
  }, [base, countryCode, query]);

  return (
    <div ref={containerRef} className="relative" data-testid="company-typeahead">
      <label htmlFor={inputId} className="sr-only">
        Company search
      </label>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && results[active] ? `${listId}-opt-${active}` : undefined
          }
          autoComplete="off"
          placeholder="Search companies by name, number, VAT, or address"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="pl-9"
          data-testid="company-typeahead-input"
        />
        {loading && (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
            aria-hidden
            data-testid="company-typeahead-loading"
          />
        )}
      </div>

      {showPanel && (
        <div
          className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md"
          data-testid="company-typeahead-panel"
        >
          <ul
            id={listId}
            role="listbox"
            aria-label="Company suggestions"
            className="max-h-80 overflow-y-auto py-1"
          >
            {results.length === 0 && !loading && (
              <li
                role="option"
                aria-selected={false}
                aria-disabled
                className="px-3 py-3 text-sm text-muted-foreground"
                data-testid="company-typeahead-no-results"
              >
                <p>No company found for this search.</p>
                <p className="text-xs mt-1">
                  You can{" "}
                  <Link
                    to={`${base}/new-company-request`}
                    className="text-primary underline underline-offset-2"
                    data-testid="company-typeahead-new-request"
                    onClick={() => setOpen(false)}
                  >
                    request a new company record
                  </Link>{" "}
                  for review.
                </p>
              </li>
            )}
            {results.map((r, idx) => {
              const sample = isSampleReadiness(r.readiness_label);
              const isActive = idx === active;
              return (
                <li
                  key={r.id}
                  id={`${listId}-opt-${idx}`}
                  role="option"
                  aria-selected={isActive}
                  data-testid="company-typeahead-option"
                  data-active={isActive ? "true" : "false"}
                  className={[
                    "cursor-pointer px-3 py-2 text-sm",
                    isActive ? "bg-accent text-accent-foreground" : "",
                  ].join(" ")}
                  onMouseEnter={() => setActive(idx)}
                  onMouseDown={(e) => {
                    // mousedown so the input blur doesn't close the panel first
                    e.preventDefault();
                    pick(r);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">
                      {highlightMatch(r.company_name, query)}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono"
                        data-testid="company-typeahead-country"
                      >
                        {r.country_code}
                      </Badge>
                      {sample && (
                        <Badge
                          variant="secondary"
                          className="text-[10px]"
                          data-testid="company-typeahead-sample-chip"
                        >
                          Sample record
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap gap-x-3">
                    {r.registration_number && (
                      <span>Reg. {highlightMatch(r.registration_number, query)}</span>
                    )}
                    {r.legal_form && <span>{highlightMatch(r.legal_form, query)}</span>}
                  </div>
                  {r.match_reasons.length > 0 && (
                    <div
                      className="mt-1 flex flex-wrap gap-1"
                      data-testid="company-typeahead-match-reasons"
                    >
                      {r.match_reasons.map((m, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-[10px] font-normal border-emerald-300 bg-emerald-50 text-emerald-900"
                          data-field={m.field_label}
                          title={m.value_raw}
                        >
                          <span className="font-medium">{m.field_label}:</span>
                          <span className="ml-1 font-mono">
                            {highlightMatch(m.value_raw, query)}
                          </span>
                        </Badge>
                      ))}
                    </div>
                  )}

                </li>
              );
            })}
          </ul>
          {(hasMore || results.length > 0) && (
            <div className="border-t border-border px-3 py-2 text-xs">
              <Link
                to={showAllHref}
                className="text-primary hover:underline"
                data-testid="company-typeahead-show-all"
                onClick={() => setOpen(false)}
              >
                Show all results for "{query.trim()}"
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
