/**
 * Four search outcomes — "Search must never end in zero."
 * 1. Direct match found
 * 2. Related / near matches found
 * 3. No direct match → invite POI generation
 * 4. Login required to continue
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
      <div className="space-y-2 mt-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-sm shimmer" />
        ))}
      </div>
    );
  }

  if (results.length > 0) {
    return (
      <div className="mt-4 space-y-2">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
          {results.length} counterpart{results.length > 1 ? "ies" : "y"} found
        </p>
        {results.map((result) => (
          <button
            key={result.id}
            onClick={() => onToggleSelect(result.id)}
            aria-pressed={selectedResults.has(result.id)}
            className={`w-full text-left px-3.5 py-2.5 rounded-sm border transition-all
                      focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              selectedResults.has(result.id)
                ? "bg-primary/5 border-primary/30"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-[13px] text-foreground">{result.title}</span>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{result.description}</p>
              </div>
              <div
                className={`w-4 h-4 rounded-sm border flex-shrink-0 transition-colors flex items-center justify-center ${
                  selectedResults.has(result.id)
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/25"
                }`}
                aria-hidden="true"
              >
                {selectedResults.has(result.id) && (
                  <svg className="w-2.5 h-2.5 text-primary-foreground" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </div>
          </button>
        ))}

        {selectedResults.size > 0 && (
          <button
            onClick={onConfirmIntent}
            className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground
                     rounded-sm font-medium text-[13px] transition-colors mt-2 flex items-center justify-center gap-2"
          >
            Confirm Intent ({selectedResults.size})
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // Outcome 3: No direct match → POI pathway
  return (
    <div className="mt-4 border border-border rounded-sm p-5 bg-card">
      <div className="flex items-start gap-3">
        <FileText className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-[13px] font-semibold text-foreground mb-1">
            No direct match — publish your intent
          </h3>
          <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed max-w-lg">
            No counterparty currently matches your criteria. Publish a Proof-of-Intention (POI) to
            signal your interest and attract verified counterparties to your position.
          </p>
          <div className="flex flex-col sm:flex-row items-start gap-2">
            <button
              onClick={onPublishPoi}
              className="inline-flex items-center gap-2 px-4 h-9 bg-primary hover:bg-primary/90 text-primary-foreground
                       rounded-sm font-medium text-[13px] transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              Publish Intent
            </button>
            <button
              onClick={onSignIn}
              className="inline-flex items-center gap-2 px-4 h-9 border border-border bg-background hover:bg-muted
                       rounded-sm font-medium text-[13px] text-foreground transition-colors"
            >
              <LogIn className="h-3.5 w-3.5" />
              Create Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
