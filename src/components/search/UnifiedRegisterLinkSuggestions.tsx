/**
 * UnifiedRegisterLinkSuggestions
 *
 * Bridges the live counterparty search and the Business Registry into a
 * single "register" experience. Renders three kinds of suggestion rows
 * for the human to action — never auto-links:
 *
 *   - candidate_match    → "Propose link" (routes through the claim flow)
 *   - counterparty_only  → "Propose registry record" (pre-fills the
 *                          public new-company-request form)
 *   - registry_only      → "Open profile" (and Claim where available),
 *                          inherited from the existing registry panel
 *
 * Pure presentation — pulls all logic from
 * `src/lib/registry-counterparty-link-ssot.ts`.
 */
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link2, PlusCircle } from "lucide-react";
import {
  buildLinkSuggestions,
  buildProposeLinkUrl,
  buildProposeRegistryRecordUrl,
  LINK_STATE_COPY,
  type MatchableCounterparty,
  type MatchableRegistry,
} from "@/lib/registry-counterparty-link-ssot";

interface Props {
  counterparties: MatchableCounterparty[];
  registry: MatchableRegistry[];
}

export function UnifiedRegisterLinkSuggestions({
  counterparties,
  registry,
}: Props) {
  if (counterparties.length === 0 && registry.length === 0) return null;

  const suggestions = buildLinkSuggestions(counterparties, registry).filter(
    (s) => s.state === "candidate_match" || s.state === "counterparty_only",
  );
  if (suggestions.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      data-testid="unified-register-link-suggestions"
    >
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400">
          Unified register
        </p>
        <h3 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">
          Register link suggestions
        </h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          All link proposals are reviewed by a human before they take effect.
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {suggestions.map((s, idx) => {
          if (s.state === "candidate_match" && s.counterparty && s.registry) {
            return (
              <li
                key={`cm-${idx}`}
                className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3 flex-wrap"
                data-testid="suggestion-candidate-match"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      candidate_match
                    </Badge>
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {s.counterparty.name}
                    </span>
                    <span className="text-slate-400">↔</span>
                    <Link
                      to={`/registry/company/${s.registry.id}`}
                      className="text-sm text-slate-700 hover:underline truncate"
                    >
                      {s.registry.name}
                    </Link>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {LINK_STATE_COPY.candidate_match.helper}
                  </p>
                </div>
                <Button asChild size="sm" className="h-8 text-xs">
                  <Link to={buildProposeLinkUrl(s.registry.id, s.counterparty.name)}>
                    <Link2 className="w-3 h-3 mr-1" />
                    Propose link
                  </Link>
                </Button>
              </li>
            );
          }
          if (s.state === "counterparty_only" && s.counterparty) {
            return (
              <li
                key={`co-${idx}`}
                className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3 flex-wrap"
                data-testid="suggestion-counterparty-only"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      counterparty_only
                    </Badge>
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {s.counterparty.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {LINK_STATE_COPY.counterparty_only.helper}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link
                    to={buildProposeRegistryRecordUrl(
                      s.counterparty.name,
                      s.counterparty.countryCode,
                    )}
                  >
                    <PlusCircle className="w-3 h-3 mr-1" />
                    Propose registry record
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
