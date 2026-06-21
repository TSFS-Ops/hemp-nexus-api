import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Link2, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, generateIdempotencyKey } from "@/lib/api-client";
import {
  buildProposeRegistryRecordUrl,
  LINK_STATE_COPY,
  type MatchConfidenceBreakdown,
  type MatchableCounterparty,
} from "@/lib/registry-counterparty-link-ssot";

interface Props {
  counterparties: MatchableCounterparty[];
}

interface BackendSuggestion {
  state: "candidate_match" | "counterparty_only" | "registry_only";
  counterparty?: MatchableCounterparty;
  registry?: MatchableCounterparty & { claimStatus?: string; claimAvailable?: boolean };
  score?: number;
  breakdown?: MatchConfidenceBreakdown | null;
}

export function UnifiedRegisterLinkSuggestions({ counterparties }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<BackendSuggestion[]>([]);
  const [proposing, setProposing] = useState<Set<string>>(new Set());
  const idempotencyKeys = useMemo(() => new Map<string, string>(), []);

  const fingerprint = useMemo(
    () => counterparties.slice(0, 5).map((c) => `${c.id}:${c.name}:${c.countryCode ?? ""}:${c.registrationNumber ?? ""}`).join("|"),
    [counterparties],
  );

  useEffect(() => {
    const scoped = counterparties.slice(0, 5).filter((c) => c.name.trim().length >= 2);
    if (scoped.length === 0) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const payloads = await Promise.all(scoped.map((cp) => apiFetch<{ suggestions?: BackendSuggestion[] }>(
          "registry-counterparty-link-suggestions",
          {
            method: "POST",
            body: JSON.stringify({
              counterparty_id: cp.id,
              counterparty_name: cp.name,
              country_code: cp.countryCode ?? undefined,
              registration_number: cp.registrationNumber ?? undefined,
              legal_form: cp.legalForm ?? undefined,
              limit: 5,
            }),
          },
        )));
        if (cancelled) return;
        const merged = payloads.flatMap((p) => p.suggestions ?? [])
          .filter((s) => s.state === "candidate_match" || s.state === "counterparty_only");
        const deduped = Array.from(new Map(merged.map((s) => [
          `${s.state}:${s.counterparty?.id ?? s.counterparty?.name}:${s.registry?.id ?? "none"}`,
          s,
        ])).values());
        setSuggestions(deduped);
      } catch (err) {
        if (!cancelled) {
          console.error("Unified register suggestions failed:", err);
          toast.error("Registry link suggestions are temporarily unavailable.");
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fingerprint]);

  async function proposeLink(s: BackendSuggestion) {
    if (!s.counterparty || !s.registry) return;
    const key = `${s.counterparty.id}:${s.registry.id}`;
    setProposing((prev) => new Set(prev).add(key));
    try {
      if (!idempotencyKeys.has(key)) idempotencyKeys.set(key, generateIdempotencyKey("registry_link_propose"));
      const res = await apiFetch<{ proposal?: { claim_id?: string | null } }>("registry-counterparty-link-propose", {
        method: "POST",
        idempotencyKey: idempotencyKeys.get(key),
        body: JSON.stringify({
          registry_company_record_id: s.registry.id,
          counterparty_id: s.counterparty.id,
          counterparty_name: s.counterparty.name,
          counterparty_country_code: s.counterparty.countryCode ?? undefined,
          counterparty_registration_number: s.counterparty.registrationNumber ?? undefined,
          counterparty_legal_form: s.counterparty.legalForm ?? undefined,
        }),
      });
      toast.success("Link proposal recorded for review.");
      if (res.proposal?.claim_id) navigate(`/registry/claims/${res.proposal.claim_id}`);
    } catch (err) {
      console.error("Could not propose registry link:", err);
      toast.error("Could not record the link proposal.");
    } finally {
      setProposing((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (counterparties.length === 0 && !loading) return null;
  if (suggestions.length === 0 && !loading) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="unified-register-link-suggestions">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400">Unified register</p>
        <h3 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">Company register link suggestions</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">Counterparty search is checking the company register. Link proposals are reviewed by a human before they take effect.</p>
      </div>
      {loading && (
        <div className="px-4 sm:px-5 py-4 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking register matches…
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {suggestions.map((s, idx) => {
          if (s.state === "candidate_match" && s.counterparty && s.registry) {
            const key = `${s.counterparty.id}:${s.registry.id}`;
            return (
              <li key={`cm-${key}-${idx}`} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3 flex-wrap" data-testid="suggestion-candidate-match">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] font-mono">candidate_match</Badge>
                    <span className="text-sm font-medium text-slate-900 truncate">{s.counterparty.name}</span>
                    <span className="text-slate-400">↔</span>
                    <Link to={`/registry/company/${s.registry.id}`} className="text-sm text-slate-700 hover:underline truncate">{s.registry.name}</Link>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{LINK_STATE_COPY.candidate_match.helper}</p>
                  {s.breakdown && (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5" data-testid="match-confidence-breakdown">
                      <Badge variant="outline" className="justify-center text-[10px]">Name {s.breakdown.nameSimilarity}%</Badge>
                      <Badge variant="outline" className="justify-center text-[10px]">Reg. {s.breakdown.registrationNumberMatch}</Badge>
                      <Badge variant="outline" className="justify-center text-[10px]">Country {s.breakdown.countryRule}</Badge>
                      <Badge variant="outline" className="justify-center text-[10px]">Form {s.breakdown.legalFormRule}</Badge>
                    </div>
                  )}
                </div>
                <Button size="sm" className="h-8 text-xs" onClick={() => proposeLink(s)} disabled={proposing.has(key)}>
                  {proposing.has(key) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Link2 className="w-3 h-3 mr-1" />}
                  Propose link {typeof s.score === "number" ? `(${s.score}%)` : ""}
                </Button>
              </li>
            );
          }
          if (s.state === "counterparty_only" && s.counterparty) {
            return (
              <li key={`co-${s.counterparty.id}-${idx}`} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3 flex-wrap" data-testid="suggestion-counterparty-only">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-mono">counterparty_only</Badge>
                    <span className="text-sm font-medium text-slate-900 truncate">{s.counterparty.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{LINK_STATE_COPY.counterparty_only.helper}</p>
                </div>
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link to={buildProposeRegistryRecordUrl(s.counterparty.name, s.counterparty.countryCode)}>
                    <PlusCircle className="w-3 h-3 mr-1" /> Propose registry record
                  </Link>
                </Button>
              </li>
            );
          }
          return null;
        })}
      </ul>
    </div>
  );
}