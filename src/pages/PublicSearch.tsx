import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  url?: string;
  source: string;
  score: number;
  isEnriched?: boolean;
  enrichmentReason?: string;
}

// Demo results for unauthenticated users
const DEMO_RESULTS: Record<string, SearchResult[]> = {
  cashew: [
    {
      id: "demo-1",
      title: "Olam Agri International",
      description: "Major cashew processor and exporter based in Singapore with operations across West Africa and India.",
      source: "Verified Trade Registry",
      score: 94,
      isEnriched: true,
      enrichmentReason: "Cross-referenced with export licenses",
    },
    {
      id: "demo-2", 
      title: "Achal Industries",
      description: "Large-scale cashew processing facility in Gujarat, India. ISO certified with annual capacity of 15,000 MT.",
      source: "Industry Database",
      score: 89,
      isEnriched: true,
      enrichmentReason: "Matched compliance records",
    },
    {
      id: "demo-3",
      title: "Kenkko Foods Ltd",
      description: "Established cashew buyer with distribution network across Southeast Asia and Middle East markets.",
      source: "Trade Directory",
      score: 82,
    },
  ],
  copper: [
    {
      id: "demo-4",
      title: "Glencore International AG",
      description: "Global commodity trading and mining company. Major copper cathode trader with worldwide logistics.",
      source: "Verified Trade Registry",
      score: 96,
      isEnriched: true,
      enrichmentReason: "Verified financial standing",
    },
    {
      id: "demo-5",
      title: "Jiangxi Copper Company",
      description: "One of China's largest copper producers. Imports copper concentrate and cathode for smelting operations.",
      source: "Industry Database", 
      score: 91,
      isEnriched: true,
      enrichmentReason: "Cross-referenced with import records",
    },
  ],
  default: [
    {
      id: "demo-6",
      title: "TradeLink Partners",
      description: "Multi-commodity trading house with focus on agricultural products and base metals.",
      source: "Trade Directory",
      score: 85,
    },
    {
      id: "demo-7",
      title: "Global Commodities Ltd",
      description: "Established commodity broker with verified track record in cross-border trade facilitation.",
      source: "Verified Trade Registry",
      score: 78,
      isEnriched: true,
      enrichmentReason: "Verified trade history",
    },
  ],
};

export default function PublicSearch() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const { getAuthUrl } = useCrossDomainUrls();
  const authUrl = getAuthUrl();

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    setHasSearched(true);
    
    // Simulate search delay for demo
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const lowerQuery = query.toLowerCase();
    let matchedResults: SearchResult[] = [];
    
    if (lowerQuery.includes("cashew")) {
      matchedResults = DEMO_RESULTS.cashew;
    } else if (lowerQuery.includes("copper")) {
      matchedResults = DEMO_RESULTS.copper;
    } else {
      matchedResults = DEMO_RESULTS.default;
    }
    
    setResults(matchedResults);
    setIsSearching(false);
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedResults);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedResults(newSelected);
  };

  const handleConfirmIntent = () => {
    toast.info("Sign in to confirm intent", {
      description: "Create an account to save your selections and generate evidence packs.",
      action: {
        label: "Sign in",
        onClick: () => window.location.href = authUrl,
      },
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/30 flex flex-col">
      {/* Main content - centered */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 sm:py-16">
        {/* Brand header */}
        <div className="mb-8 sm:mb-10 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">CM</span>
            </div>
            <span className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Compliance Matching API
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Discover verified counterparties in regulated commodity markets
          </p>
        </div>

        {/* Search card */}
        <div className="w-full max-w-2xl">
          <div className="glass-card rounded-2xl p-6 sm:p-8">
            {/* Search input */}
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="e.g., 'buyers for cashew in India' or 'copper cathode suppliers'"
                aria-label="Search for verified buyers or sellers"
                className="w-full h-14 px-5 text-base bg-white/80 border border-border rounded-xl 
                         placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 
                         focus:ring-primary/30 focus:border-primary/40 transition-all"
              />
            </div>

            {/* Search button - primary brand colour */}
            <button
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
              className="mt-4 w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground 
                       rounded-xl font-medium text-sm transition-colors disabled:opacity-50 
                       disabled:cursor-not-allowed shadow-sm"
            >
              {isSearching ? "Searching..." : "Search Counterparties"}
            </button>

            {/* Results */}
            {hasSearched && (
              <div className="mt-6 space-y-3">
                {isSearching ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div 
                        key={i} 
                        className="h-20 rounded-lg shimmer"
                        style={{ animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                  </div>
                ) : results.length > 0 ? (
                  <>
                    {results.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => toggleSelect(result.id)}
                        className={`w-full text-left p-4 rounded-lg border transition-all ${
                          selectedResults.has(result.id)
                            ? "bg-primary/5 border-primary/20"
                            : "bg-white/40 border-black/[0.04] hover:bg-white/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground truncate">
                              {result.title}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                              {result.description}
                            </p>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-colors ${
                            selectedResults.has(result.id)
                              ? "bg-primary border-primary"
                              : "border-black/20"
                          }`}>
                            {selectedResults.has(result.id) && (
                              <svg className="w-full h-full text-white" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}

                    {/* Confirm Intent button - appears when results selected */}
                    {selectedResults.size > 0 && (
                      <button
                        onClick={handleConfirmIntent}
                        className="mt-4 w-full h-11 bg-neutral-700 hover:bg-neutral-800 text-white 
                                 rounded-lg font-medium text-sm transition-colors"
                      >
                        Confirm Intent ({selectedResults.size})
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No results found. Try a different search term.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Reassurance text */}
          <p className="mt-5 text-center text-xs text-muted-foreground">
            No obligation. No payment. Signals intent only.
          </p>
        </div>
      </main>

      {/* Footer with brand identity */}
      <footer className="py-6 px-4 border-t border-border/50">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">Compliance Matching API</span>
          <div className="flex items-center gap-4">
            <Link to="/docs" className="hover:text-primary transition-colors">
              API Docs
            </Link>
            <span className="text-border">·</span>
            <a href={authUrl} className="hover:text-primary transition-colors">
              Developer Console
            </a>
            <span className="text-border">·</span>
            <Link to="/landing" className="hover:text-primary transition-colors">
              About
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
