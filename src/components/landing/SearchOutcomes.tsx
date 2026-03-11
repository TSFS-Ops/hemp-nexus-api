/**
 * Four search outcomes — "Search must never end in zero."
 * Swiss-Terminal aesthetic with ledger-line result rows.
 */

import { ArrowRight, FileText, LogIn } from "lucide-react";
import { type DemoSearchResult } from "@/lib/demo-data";

interface SearchOutcomesProps {
  results: DemoSearchResult[];
  isSearching: boolean;
  hasSearched: boolean;
  selectedResults: Set<string>;
  onToggleSelect: (id: string) => void;
  onConfirmIntent: () => void;
  onPublishPoi: () => void;
  onSignIn: () => void;
}

export function SearchOutcomes({
  results,
  isSearching,
  hasSearched,
  selectedResults,
  onToggleSelect,
  onConfirmIntent,
  onPublishPoi,
  onSignIn,
}: SearchOutcomesProps) {
  if (!hasSearched) return null;

  if (isSearching) {
    return (
      <div className="mt-0 border-t border-border">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 border-b border-border shimmer" />
        ))}
      </div>
    );
  }

  if (results.length > 0) {
    return (
      <div className="mt-0">
        {/* Results header */}
        <div className="px-3 py-1.5 border-t border-border bg-accent/30">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            {results.length} counterpart{results.length > 1 ? "ies" : "y"} matched
          </span>
        </div>

        {/* Result rows */}
        {results.map((result) => (
          <button
            key={result.id}
            onClick={() => onToggleSelect(result.id)}
            aria-pressed={selectedResults.has(result.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors
                      focus:outline-none ${
              selectedResults.has(result.id)
                ? "bg-primary/5"
                : "hover:bg-accent/30"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div
                  className={`w-3.5 h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors ${
                    selectedResults.has(result.id)
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/25"
                  }`}
                  aria-hidden="true"
                >
                  {selectedResults.has(result.id) && (
                    <svg className="w-2 h-2 text-primary-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-[12px] font-medium text-foreground">{result.title}</span>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{result.description}</p>
                </div>
              </div>
              <span className="text-[9px] font-mono text-muted-foreground/40 flex-shrink-0">
                {result.id.slice(0, 8)}
              </span>
            </div>
          </button>
        ))}

        {/* Confirm intent action */}
        {selectedResults.size > 0 && (
          <button
            onClick={onConfirmIntent}
            className="w-full h-10 bg-primary text-primary-foreground shadow-inner-metallic
                     font-mono text-[12px] uppercase tracking-widest font-medium
                     transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
          >
            Confirm Intent ({selectedResults.size})
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  // Outcome 3: No direct match → POI pathway ("Never Zero")
  return (
    <div className="mt-0 border-t border-border">
      <div className="px-3 py-1.5 bg-accent/30">
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
          No direct match — Market liquidity pathway
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[12px] font-medium text-foreground mb-1">
              Publish your intent to attract counterparties
            </p>
            <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed max-w-md">
              No counterparty currently matches your criteria. Generate a Proof-of-Intention (POI) to
              signal your position and attract verified liquidity to your trade.
            </p>
            <div className="flex flex-col sm:flex-row items-start gap-2">
              <button
                onClick={onPublishPoi}
                className="inline-flex items-center gap-2 px-4 h-8 bg-primary text-primary-foreground shadow-inner-metallic
                         font-mono text-[11px] uppercase tracking-widest font-medium
                         transition-opacity hover:opacity-90"
              >
                <FileText className="h-3 w-3" />
                Publish Intent
              </button>
              <button
                onClick={onSignIn}
                className="inline-flex items-center gap-2 px-4 h-8 border border-border bg-background
                         font-mono text-[11px] uppercase tracking-widest font-medium text-foreground
                         transition-colors hover:bg-accent"
              >
                <LogIn className="h-3 w-3" />
                Create Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
