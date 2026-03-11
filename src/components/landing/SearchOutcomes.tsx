/**
 * Four search outcomes for phase one:
 * 1. Direct match found
 * 2. Related / near matches found
 * 3. No direct match → invite POI generation
 * 4. Login required to continue
 *
 * "Search must never end in zero" — Item 8
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
          <div key={i} className="h-16 rounded-md shimmer" />
        ))}
      </div>
    );
  }

  // Outcome 1 & 2: Direct or near matches
  if (results.length > 0) {
    return (
      <div className="mt-4 space-y-2">
        <p className="text-xs text-muted-foreground mb-2">
          {results.length} counterpart{results.length > 1 ? "ies" : "y"} found
        </p>
        {results.map((result) => (
          <button
            key={result.id}
            onClick={() => onToggleSelect(result.id)}
            aria-pressed={selectedResults.has(result.id)}
            className={`w-full text-left px-4 py-3 rounded-md border transition-all
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selectedResults.has(result.id)
                ? "bg-primary/5 border-primary/30"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm text-foreground">{result.title}</span>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{result.description}</p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex-shrink-0 transition-colors ${
                  selectedResults.has(result.id)
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/30"
                }`}
                aria-hidden="true"
              >
                {selectedResults.has(result.id) && (
                  <svg className="w-full h-full text-primary-foreground" viewBox="0 0 20 20" fill="currentColor">
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
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground
                     rounded-md font-medium text-sm transition-colors mt-2 flex items-center justify-center gap-2"
          >
            Confirm Intent ({selectedResults.size})
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // Outcome 3: No direct match → POI invitation
  return (
    <div className="mt-4 border border-border rounded-md p-5 bg-card text-center">
      <FileText className="h-8 w-8 text-primary mx-auto mb-3" />
      <h3 className="text-sm font-semibold text-foreground mb-1">
        No direct match — publish your intent
      </h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto leading-relaxed">
        No counterparty currently matches your criteria. Publish a Proof-of-Intention (POI) to
        signal your interest and attract verified counterparties to your position.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
        <button
          onClick={onPublishPoi}
          className="w-full sm:w-auto px-5 h-10 bg-primary hover:bg-primary/90 text-primary-foreground
                   rounded-md font-medium text-sm transition-colors flex items-center justify-center gap-2"
        >
          <FileText className="h-4 w-4" />
          Publish Intent
        </button>
        <button
          onClick={onSignIn}
          className="w-full sm:w-auto px-5 h-10 border border-input bg-background hover:bg-muted
                   rounded-md font-medium text-sm text-foreground transition-colors flex items-center justify-center gap-2"
        >
          <LogIn className="h-4 w-4" />
          Create Account
        </button>
      </div>
    </div>
  );
}
