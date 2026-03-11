/**
 * Never Zero search outcomes — 4-phase state machine.
 * Refined with entrance animations and sharper transitions.
 */

import { useState, useEffect } from "react";
import { ArrowRight, FileText, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { type DemoSearchResult } from "@/lib/demo-data";

type NeverZeroPhase = "scanning" | "pivot" | "ready";

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
  results, isSearching, hasSearched, selectedResults,
  onToggleSelect, onConfirmIntent, onPublishPoi, onSignIn,
}: SearchOutcomesProps) {
  const [neverZeroPhase, setNeverZeroPhase] = useState<NeverZeroPhase>("scanning");

  useEffect(() => {
    if (!hasSearched || isSearching || results.length > 0) {
      setNeverZeroPhase("scanning");
      return;
    }
    setNeverZeroPhase("pivot");
    const t = setTimeout(() => setNeverZeroPhase("ready"), 300);
    return () => clearTimeout(t);
  }, [hasSearched, isSearching, results.length]);

  if (!hasSearched) return null;

  // Phase 1: Cryptographic scan
  if (isSearching) {
    return (
      <div className="mt-0 border-t border-border">
        <div className="px-3 py-2.5 bg-basalt">
          <span className="text-[9px] font-mono uppercase tracking-widest text-basalt-foreground/60 animate-pulse">
            Scanning verified counterparty registry...
          </span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 border-b border-border shimmer" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    );
  }

  // Results found
  if (results.length > 0) {
    return (
      <div className="mt-0">
        <div className="px-3 py-2 border-t border-border bg-accent/20">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            {results.length} counterpart{results.length > 1 ? "ies" : "y"} matched
          </span>
        </div>

        {results.map((result, i) => (
          <button
            key={result.id}
            onClick={() => onToggleSelect(result.id)}
            aria-pressed={selectedResults.has(result.id)}
            className={`w-full text-left px-3 py-3 border-b border-border transition-all duration-200
                      focus:outline-none animate-fade-up group/row ${
              selectedResults.has(result.id)
                ? "bg-primary/[0.04]"
                : "hover:bg-accent/30"
            }`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-all duration-200 ${
                    selectedResults.has(result.id)
                      ? "bg-primary border-primary scale-100"
                      : "border-muted-foreground/20 group-hover/row:border-muted-foreground/40"
                  }`}
                  aria-hidden="true"
                >
                  {selectedResults.has(result.id) && (
                    <svg className="w-2.5 h-2.5 text-primary-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-[12px] font-medium text-foreground">{result.title}</span>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{result.description}</p>
                </div>
              </div>
              <span className="text-[9px] font-mono text-muted-foreground/30 flex-shrink-0 group-hover/row:text-muted-foreground/50 transition-colors">
                {result.id.slice(0, 8)}
              </span>
            </div>
          </button>
        ))}

        {selectedResults.size > 0 && (
          <button
            onClick={onConfirmIntent}
            className="w-full h-11 bg-primary text-primary-foreground shadow-inner-metallic
                     font-mono text-[11px] uppercase tracking-widest font-medium
                     transition-all hover:opacity-90 active:scale-[0.998]
                     flex items-center justify-center gap-2.5 animate-fade-up"
          >
            Continue in Console ({selectedResults.size})
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  // ─── NEVER ZERO: Phases 2 & 3 ─────────────────────────────────
  return (
    <div
      className={`mt-0 border-t border-border transition-all duration-600 overflow-hidden ${
        neverZeroPhase === "scanning" ? "max-h-0 opacity-0" : "max-h-[700px] opacity-100"
      }`}
    >
      {/* Phase 2: "Liquidity Gap Detected" */}
      <div className="px-4 py-4 border-b border-border">
        <h3 className="text-[15px] font-semibold text-foreground tracking-tighter leading-tight">
          0 Direct Matches. Liquidity Gap Detected.
        </h3>
      </div>

      {/* Phase 3: Market-maker invitation */}
      <div className="p-4 sm:p-5">
        <p className="text-[12px] text-muted-foreground leading-relaxed mb-6 max-w-md">
          No verified counterparties currently hold an active opposing position.
          You are positioned to make the market.
        </p>

        {/* Shadow Order Book */}
        <div className="border border-border mb-6 animate-fade-up delay-150">
          <div className="px-3 py-2 border-b border-border bg-accent/15">
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              Network Activity
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="px-4 py-3">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 block mb-1.5">
                Active buyers in region
              </span>
              <span className="text-[20px] font-mono font-bold text-foreground tracking-tighter">
                14
              </span>
            </div>
            <div className="px-4 py-3">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 block mb-1.5">
                Related commodity intent
              </span>
              <span className="text-[20px] font-mono font-bold text-primary tracking-tighter">
                High
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
            <div className="px-3 py-2.5">
              <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 block mb-0.5">
                Corridor signals
              </span>
              <span className="text-[14px] font-mono font-medium text-foreground">7</span>
            </div>
            <div className="px-3 py-2.5">
              <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 block mb-0.5">
                POI eligible
              </span>
              <span className="text-[14px] font-mono font-medium text-signal-verified">Yes</span>
            </div>
            <div className="px-3 py-2.5">
              <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 block mb-0.5">
                Market hash
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/40">0x4a2b...</span>
            </div>
          </div>
        </div>

        {/* POI Gateway */}
        <button
          onClick={onPublishPoi}
          className="w-full h-11 bg-primary text-primary-foreground shadow-inner-metallic
                   font-mono text-[11px] uppercase tracking-widest font-medium
                   transition-all hover:opacity-90 active:scale-[0.998]
                   flex items-center justify-center gap-2.5 animate-fade-up delay-300"
        >
          <FileText className="h-3.5 w-3.5" />
          Signal Your Intent
        </button>
        <p className="text-[10px] font-mono text-muted-foreground/40 mt-2.5 text-center tracking-wide animate-fade-in delay-400">
          Sign in to publish a governed intent signal. Uses 1 credit.
        </p>
      </div>
    </div>
  );
}
