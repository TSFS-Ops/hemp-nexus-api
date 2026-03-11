import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileText, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DemoModeBanner } from "@/components/EnvironmentIndicator";
import { DemoConfirmDialog } from "@/components/DemoConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { SearchHeader } from "@/components/search/SearchHeader";
import { SearchMetricsCard } from "@/components/search/SearchMetricsCard";
import { CounterpartyResultCard } from "@/components/search/CounterpartyResultCard";
import { SimilarCounterpartiesSheet } from "@/components/search/SimilarCounterpartiesSheet";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  score: number;
  isEnriched: boolean;
  enrichmentReason: string | null;
  whySurfaced: string;
  coherence: {
    score: number;
    passed: boolean;
    factors: string[];
  };
}

interface SearchMetrics {
  baselineCount: number;
  enrichedCount: number;
  upliftPct: number;
  enrichmentReasons: Record<string, number>;
}

interface ParsedQuery {
  product: string;
  location: string;
  role: "buyer" | "seller";
}

// Demo data for anonymous users
const DEMO_RESULTS: SearchResult[] = [
  {
    id: "demo-1",
    title: "GlobalAgri Trading Co.",
    description: "Leading commodity importer in Southeast Asia with certified supply chains and quality assurance programs.",
    url: "#",
    source: "TradeDirectory",
    score: 0.94,
    isEnriched: false,
    enrichmentReason: null,
    whySurfaced: "Direct keyword match with high trade volume signals",
    coherence: { score: 0.92, passed: true, factors: ["Verified business", "Active trading history"] },
  },
  {
    id: "demo-2",
    title: "IndiaExport Partners Ltd.",
    description: "Established commodity trading house specializing in agricultural exports from India.",
    url: "#",
    source: "B2B Platform",
    score: 0.89,
    isEnriched: true,
    enrichmentReason: "supply_chain_adjacency",
    whySurfaced: "12% Engine: Found via supply chain adjacency analysis",
    coherence: { score: 0.88, passed: true, factors: ["Related commodity trades", "Regional expertise"] },
  },
  {
    id: "demo-3",
    title: "SouthAsia Commodities GmbH",
    description: "German import company with established trade routes and food safety certifications.",
    url: "#",
    source: "TradeDirectory",
    score: 0.85,
    isEnriched: true,
    enrichmentReason: "regional_heuristic",
    whySurfaced: "12% Engine: Regional trade pattern matching - active in commodity corridor",
    coherence: { score: 0.85, passed: true, factors: ["Certified importer", "Established routes"] },
  },
  {
    id: "demo-4",
    title: "Pacific Rim Foods Inc.",
    description: "US-based food distributor expanding into raw ingredient sourcing.",
    url: "#",
    source: "Industry Database",
    score: 0.78,
    isEnriched: false,
    enrichmentReason: null,
    whySurfaced: "Baseline AI match - company profile mentions procurement interest",
    coherence: { score: 0.75, passed: true, factors: ["Growing buyer", "Verified business"] },
  },
  {
    id: "demo-5",
    title: "EuroNuts Trading BV",
    description: "Netherlands-based trader with focus on sustainable and fair-trade certified commodities.",
    url: "#",
    source: "B2B Platform",
    score: 0.72,
    isEnriched: true,
    enrichmentReason: "semantic_expansion",
    whySurfaced: "12% Engine: Semantic expansion found related category",
    coherence: { score: 0.70, passed: true, factors: ["Sustainability focus", "Fair-trade certified"] },
  },
];

interface CounterpartySearchProps {
  isDemoMode?: boolean;
}

export default function CounterpartySearch({ isDemoMode: propDemoMode }: CounterpartySearchProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialise query from URL if present (trim whitespace for safety)
  const initialQuery = (searchParams.get("q") || "").trim();
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [showDemoConfirm, setShowDemoConfirm] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [similarAnchor, setSimilarAnchor] = useState<SearchResult | null>(null);

  // Demo mode is active if explicitly set via props OR if user is not authenticated
  const isDemoMode = propDemoMode ?? !isAuthenticated;

  // Track whether auto-search from URL has fired
  const [hasAutoSearched, setHasAutoSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    // Persist query to URL for shareability and refresh resilience
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set("q", query.trim());
      return updated;
    }, { replace: true });

    setIsSearching(true);
    setResults([]);
    setMetrics(null);
    setSelectedResults(new Set());

    // If in demo mode, return simulated data
    if (isDemoMode) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // Parse query for demo
      const lowerQuery = query.toLowerCase();
      const inferredRole = lowerQuery.includes("seller") || lowerQuery.includes("supplier") ? "seller" : "buyer";
      
      setParsedQuery({
        product: query.split(" ").slice(0, 3).join(" "),
        location: lowerQuery.includes("india") ? "India" : lowerQuery.includes("africa") ? "Africa" : "",
        role: inferredRole,
      });

      setResults(DEMO_RESULTS);
      
      const baselineCount = DEMO_RESULTS.filter(r => !r.isEnriched).length;
      setMetrics({
        baselineCount,
        enrichedCount: DEMO_RESULTS.length,
        upliftPct: Math.round(((DEMO_RESULTS.length - baselineCount) / baselineCount) * 100),
        enrichmentReasons: { "supply_chain_adjacency": 1, "regional_heuristic": 1, "semantic_expansion": 1 },
      });

      setIsSearching(false);
      toast.success(`Demo: Found ${DEMO_RESULTS.length} example counterparties`);
      return;
    }

    // Real search for authenticated users
    try {
      const { data, error } = await supabase.functions.invoke("search", {
        body: { query: query.trim(), limit: 20 }
      });

      if (error) throw error;

      if (data.ok) {
        setResults(data.results || []);
        setMetrics(data.metrics || null);
        setParsedQuery(data.parsedQuery || null);
        
        if (data.results?.length === 0) {
          toast.info("No results found. Try a different query.");
        } else {
          toast.success(`Found ${data.results.length} potential counterparties`);
        }
      } else {
        throw new Error(data.error || "Search failed");
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Auto-trigger search if URL contains non-empty ?q= on mount (deep-link restore)
  useEffect(() => {
    if (initialQuery && initialQuery.trim() && !hasAutoSearched && !authLoading && !isSearching) {
      setHasAutoSearched(true);
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const toggleSelect = (id: string) => {
    setSelectedResults(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleStartPOI = async () => {
    if (selectedResults.size === 0) {
      toast.error("Please select at least one counterparty");
      return;
    }

    // If in demo mode, show the demo confirmation dialog
    if (isDemoMode) {
      setShowDemoConfirm(true);
      return;
    }

    // Double-click guard
    if (isConfirming) return;

    setIsConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in to start a POI");
        return;
      }

      // Get user's profile for org info
      let profile = await supabase
        .from("profiles")
        .select("org_id, full_name")
        .eq("id", session.user.id)
        .maybeSingle()
        .then(r => r.data);

      if (!profile) {
        const { error: repairError } = await supabase.rpc("ensure_user_profile", {
          p_user_id: session.user.id,
          p_email: session.user.email ?? "",
        });
        if (repairError) {
          toast.error("Your account setup is incomplete. Please sign out and sign in again, or contact support.");
          return;
        }
        profile = await supabase
          .from("profiles")
          .select("org_id, full_name")
          .eq("id", session.user.id)
          .maybeSingle()
          .then(r => r.data);
        if (!profile) {
          toast.error("Account setup failed. Please contact support.");
          return;
        }
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.org_id)
        .maybeSingle();

      const selectedIds = Array.from(selectedResults);
      const selectedItems = selectedIds
        .map(id => results.find(r => r.id === id))
        .filter(Boolean) as SearchResult[];

      if (selectedItems.length === 0) {
        toast.error("No valid counterparties selected");
        return;
      }

      let created = 0;
      let duplicates = 0;
      let failed = 0;
      let lastMatchId: string | null = null;
      const failedIds: Set<string> = new Set();
      const failedNames: string[] = [];

      for (const selectedResult of selectedItems) {
        try {
          const requestStartedAt = Date.now();
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                buyer: { 
                  id: profile.org_id, 
                  name: org?.name || profile.full_name || "Your Organisation" 
                },
                seller: { 
                  id: selectedResult.id, 
                  name: selectedResult.title 
                },
                commodity: parsedQuery?.product || query,
                quantity: { amount: 1, unit: "lot" },
                price: { amount: 1, currency: "USD" },
                terms: "POI draft — upload documents before confirming intent",
                metadata: { 
                  searchQuery: query, 
                  parsedQuery,
                  source: selectedResult.source,
                  coherenceScore: selectedResult.coherence?.score
                }
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const matchData = await response.json();

          // Primary: check X-Match-Duplicate header (exposed via CORS Access-Control-Expose-Headers)
          // Fallback: if header is stripped by a proxy/CDN, detect via created_at timestamp
          const headerDuplicate = response.headers.get("X-Match-Duplicate") === "true";
          const createdAt = matchData.created_at ? new Date(matchData.created_at).getTime() : Date.now();
          const fallbackDuplicate = !headerDuplicate && createdAt < (requestStartedAt - 2000);
          const isDuplicate = headerDuplicate || fallbackDuplicate;

          if (isDuplicate) {
            duplicates++;
          } else {
            created++;
          }
          lastMatchId = matchData.id;
        } catch (err) {
          console.error(`Failed to create match for ${selectedResult.title}:`, err);
          failed++;
          failedIds.add(selectedResult.id);
          failedNames.push(selectedResult.title);
        }
      }

      // Keep only failed IDs selected for retry (by ID, not name — handles duplicate titles)
      if (failedIds.size > 0) {
        setSelectedResults(failedIds);
      } else {
        setSelectedResults(new Set());
      }

      // Build precise user messaging
      const total = created + duplicates + failed;
      if (failed === 0 && duplicates === 0) {
        // All new
        if (created === 1 && lastMatchId) {
          toast.success("Match created — upload documents, then confirm intent.");
          navigate(`/dashboard/matches/${lastMatchId}`);
        } else {
          toast.success(`${created} matches created. View them in your matches.`);
          navigate("/dashboard/matches");
        }
      } else if (failed === 0) {
        // Some or all duplicates, no failures
        if (created > 0) {
          toast.success(`${created} new match${created > 1 ? "es" : ""} created. ${duplicates} already existed and were skipped.`);
        } else {
          toast.info(`All ${duplicates} match${duplicates > 1 ? "es" : ""} already exist — no duplicates created. View them in your matches.`);
        }
        navigate("/dashboard/matches");
      } else if (created > 0 || duplicates > 0) {
        // Partial failure
        const ok = created + duplicates;
        toast.warning(
          `${ok} of ${total} processed (${created} new, ${duplicates} already existed). ${failed} failed: ${failedNames.slice(0, 2).join(", ")}${failedNames.length > 2 ? "…" : ""}. You can retry the failed items.`
        );
        navigate("/dashboard/matches");
      } else {
        toast.error("All match creation attempts failed. Please try again.");
      }
    } catch (error) {
      console.error("Start POI error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create matches");
    } finally {
      setIsConfirming(false);
    }
  };

  // Show loading while checking auth status
  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 sm:space-y-6">
        {/* Demo Mode Banner */}
        {isDemoMode && <DemoModeBanner />}

        {/* Search Header */}
        <SearchHeader
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          isSearching={isSearching}
          isDemoMode={isDemoMode}
        />

        {/* Parsed Query Display */}
        {parsedQuery && (
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm flex-wrap">
            <span className="text-muted-foreground">Searching:</span>
            <Badge variant="outline" className="text-[10px] sm:text-xs">
              {parsedQuery.product}
            </Badge>
            {parsedQuery.location && (
              <>
                <span className="text-muted-foreground">in</span>
                <Badge variant="outline" className="text-[10px] sm:text-xs">
                  {parsedQuery.location}
                </Badge>
              </>
            )}
            <span className="text-muted-foreground">as</span>
            <Badge 
              variant={parsedQuery.role === "buyer" ? "default" : "secondary"}
              className="text-[10px] sm:text-xs"
            >
              {parsedQuery.role === "buyer" ? "Buyer" : "Seller"}
            </Badge>
            {isDemoMode && (
              <Badge variant="secondary" className="ml-1 text-[10px] sm:text-xs">
                Demo
              </Badge>
            )}
          </div>
        )}

        {/* Metrics Card */}
        {metrics && <SearchMetricsCard metrics={metrics} />}

        {/* Loading State */}
        {isSearching && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="py-3 sm:py-4">
                  <div className="flex gap-3">
                    <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Results */}
        {!isSearching && results.length > 0 && (
          <div className="space-y-3 sm:space-y-4">
            {/* Results header with selection actions */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-sm sm:text-base">
                {results.length} {isDemoMode ? "Example" : ""} Counterparties
              </h3>
              {selectedResults.size > 0 && (
                <div className="flex items-center gap-2">
                  {/* Create Match — starts the POI workflow for selected counterparties */}
                  <Button 
                    onClick={handleStartPOI}
                    disabled={isConfirming}
                    size="sm" 
                    className="h-8 sm:h-9 text-xs sm:text-sm touch-target"
                  >
                    {isConfirming ? (
                      <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                    )}
                    Create Match ({selectedResults.size})
                  </Button>
                </div>
              )}
            </div>

            {/* Result cards */}
            {results.map((result, idx) => (
              <CounterpartyResultCard
                key={result.id}
                result={result}
                rank={idx + 1}
                isSelected={selectedResults.has(result.id)}
                onToggleSelect={toggleSelect}
                onFindSimilar={setSimilarAnchor}
              />
            ))}

            {/* Load More / Info Alert */}
            {results.length >= 5 && (
              <Alert className="mt-4">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs sm:text-sm">
                  {isDemoMode ? (
                    <>
                      <strong>Demo Mode:</strong> Sign in to see real results.
                    </>
                  ) : (
                    <>
                      Showing top {results.length} results. Refine your query for more specific matches.
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Demo Confirm Dialog */}
        <DemoConfirmDialog 
          open={showDemoConfirm} 
          onOpenChange={setShowDemoConfirm}
          selectedCount={selectedResults.size}
        />

        {/* Similar Counterparties Sheet */}
        <SimilarCounterpartiesSheet
          open={!!similarAnchor}
          onOpenChange={(open) => { if (!open) setSimilarAnchor(null); }}
          anchor={similarAnchor}
          allResults={results}
          onSelect={(id) => {
            toggleSelect(id);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
