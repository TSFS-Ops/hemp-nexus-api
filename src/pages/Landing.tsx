import { useState } from "react";
import { DEMO_SEARCH_DELAY_MS } from "@/lib/constants";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { type DemoSearchResult, getDemoResultsForQuery } from "@/lib/demo-data";

export default function Landing() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DemoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    await new Promise(resolve => setTimeout(resolve, DEMO_SEARCH_DELAY_MS));
    setResults(getDemoResultsForQuery(query));
    setIsSearching(false);
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedResults);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedResults(newSelected);
  };

  const handleConfirmIntent = () => {
    toast.info("Sign in to continue", {
      description: "Create an account to confirm your interest and begin the process.",
      action: {
        label: "Sign in",
        onClick: () => {
          if (isPreview) {
            window.location.assign("/auth");
          } else {
            window.location.href = authUrl;
          }
        },
      },
    });
  };

  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    const authUrl = getAuthUrl();
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <PublicHeader />

      {/* Single screen — search is the product */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-xl mx-auto text-center">
          {/* Headline */}
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight mb-3">
            Find a verified counterparty
          </h1>
          <p className="text-base text-muted-foreground mb-8">
            Search, match, and verify counterparties compliantly — with tamper-evident proof at every step.
          </p>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search counterparties, e.g. copper cathode suppliers in Zambia"
              aria-label="Search for verified counterparties"
              className="w-full h-14 pl-5 pr-28 text-base bg-background border border-border rounded-xl 
                       placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 
                       focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-5 bg-foreground text-background 
                       rounded-lg text-sm font-medium transition-colors hover:bg-foreground/90
                       disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSearching ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 border-2 border-background/40 border-t-background rounded-full animate-spin" />
                  <span className="sr-only">Searching</span>
                </span>
              ) : "Search"}
            </button>
          </div>

          {/* Results — appear below search */}
          {hasSearched && (
            <div className="mt-4 text-left max-h-[45vh] overflow-y-auto">
              {isSearching ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded-lg shimmer" />
                  ))}
                </div>
              ) : results.length > 0 ? (
                <div className="space-y-2">
                  {results.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => toggleSelect(result.id)}
                      aria-pressed={selectedResults.has(result.id)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all min-h-[44px]
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        selectedResults.has(result.id)
                          ? "bg-primary/5 border-primary/30"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-foreground text-sm">{result.title}</span>
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
                      onClick={handleConfirmIntent}
                      className="w-full h-11 min-h-[44px] bg-foreground hover:bg-foreground/90 text-background 
                               rounded-lg font-medium text-sm transition-colors mt-2"
                    >
                      I'm interested ({selectedResults.size})
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground py-6">
                  No results found. Try a different search.
                </p>
              )}
            </div>
          )}

          {/* Subtle sign-in prompt */}
          {!hasSearched && (
            <p className="mt-6 text-xs text-muted-foreground">
              No login needed to search.{" "}
              <AuthLink className="underline hover:text-foreground transition-colors">
                Sign in
              </AuthLink>{" "}
              to save matches and confirm intent.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
