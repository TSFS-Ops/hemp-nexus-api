import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Search, Sparkles, TrendingUp, ExternalLink, ArrowRight, 
  Zap, Users, CheckCircle, Info, Globe, Lightbulb
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { DemoConfirmDialog } from "@/components/DemoConfirmDialog";

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
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showDemoConfirm, setShowDemoConfirm] = useState(false);

  // Check authentication status
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Demo mode is active if explicitly set via props OR if user is not authenticated
  const isDemoMode = propDemoMode ?? !isAuthenticated;

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

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

  const handleConfirmIntent = async () => {
    if (selectedResults.size === 0) {
      toast.error("Please select at least one counterparty");
      return;
    }

    // If in demo mode, show the demo confirmation dialog
    if (isDemoMode) {
      setShowDemoConfirm(true);
      return;
    }
    
    // Real confirmation for authenticated users
    toast.success(`Selected ${selectedResults.size} counterparties for intent confirmation`);
    // TODO: Navigate to match creation flow
  };

  // Show loading while checking auth status
  if (isAuthenticated === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Demo Mode Banner */}
        {isDemoMode && <DemoModeBanner />}

        {/* Search Header */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Find Counterparties
              {isDemoMode && <Badge variant="outline" className="ml-auto">Demo</Badge>}
            </CardTitle>
            <CardDescription>
              Enter a natural language query to discover potential trading partners
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Input
                  placeholder="e.g., 'buyers for cashew in India' or '100 tons copper cathode suppliers'"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pr-10"
                />
                <Globe className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? (
                  <>
                    <Zap className="h-4 w-4 mr-2 animate-pulse" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </>
                )}
              </Button>
            </div>

            {/* Example queries */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground">Try:</span>
              {[
                "buyers for cashew in India",
                "copper cathode suppliers",
                "hemp fiber wholesalers South Africa",
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => setQuery(example)}
                  className="text-xs text-primary hover:underline"
                >
                  "{example}"
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Parsed Query Display */}
        {parsedQuery && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Searching for:</span>
            <Badge variant="outline">{parsedQuery.product}</Badge>
            {parsedQuery.location && (
              <>
                <span className="text-muted-foreground">in</span>
                <Badge variant="outline">{parsedQuery.location}</Badge>
              </>
            )}
            <span className="text-muted-foreground">as</span>
            <Badge variant={parsedQuery.role === "buyer" ? "default" : "secondary"}>
              {parsedQuery.role === "buyer" ? "Buyer" : "Seller"}
            </Badge>
            {isDemoMode && <Badge variant="secondary" className="ml-2">Demo Data</Badge>}
          </div>
        )}

        {/* Metrics Card */}
        {metrics && (
          <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{metrics.baselineCount}</div>
                    <div className="text-xs text-muted-foreground">Baseline</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{metrics.enrichedCount}</div>
                    <div className="text-xs text-muted-foreground">Total Found</div>
                  </div>
                  <Separator orientation="vertical" className="h-10" />
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-green-500" />
                    <div>
                      <div className="text-lg font-bold text-green-600">+{metrics.upliftPct}%</div>
                      <div className="text-xs text-muted-foreground">12% Engine Uplift</div>
                    </div>
                  </div>
                </div>
                
                {/* Enrichment reasons breakdown */}
                {Object.keys(metrics.enrichmentReasons || {}).length > 0 && (
                  <div className="flex gap-2">
                    {Object.entries(metrics.enrichmentReasons).slice(0, 3).map(([reason, count]) => (
                      <Tooltip key={reason}>
                        <TooltipTrigger>
                          <Badge variant="secondary" className="text-xs">
                            <Sparkles className="h-3 w-3 mr-1" />
                            {count}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs text-sm">{reason}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isSearching && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <div className="flex gap-4">
                    <Skeleton className="h-12 w-12 rounded" />
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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {results.length} {isDemoMode ? "Example" : "Potential"} Counterparties
              </h3>
              {selectedResults.size > 0 && (
                <Button onClick={handleConfirmIntent} size="sm">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Confirm Intent ({selectedResults.size})
                </Button>
              )}
            </div>

            {results.map((result, idx) => (
              <Card 
                key={result.id}
                className={`transition-all cursor-pointer hover:border-primary/50 ${
                  selectedResults.has(result.id) ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => toggleSelect(result.id)}
              >
                <CardContent className="py-4">
                  <div className="flex gap-4">
                    {/* Rank & Selection */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        selectedResults.has(result.id) 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-muted"
                      }`}>
                        {selectedResults.has(result.id) ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {Math.round(result.score * 100)}%
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium truncate">{result.title}</h4>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {result.isEnriched && (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                                  <Sparkles className="h-3 w-3 mr-1" />
                                  12%
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-1">
                                  <p className="font-medium">12% Discovery Engine</p>
                                  <p className="text-sm text-muted-foreground">
                                    {result.enrichmentReason || "Found through advanced discovery heuristics"}
                                  </p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {result.source}
                          </Badge>
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {result.description}
                      </p>

                      {/* Why Surfaced */}
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <Tooltip>
                          <TooltipTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                            <Lightbulb className="h-3 w-3" />
                            <span>Why surfaced</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <p>{result.whySurfaced}</p>
                            {result.coherence?.factors && result.coherence.factors.length > 0 && (
                              <div className="mt-2">
                                <p className="font-medium text-xs">Coherence factors:</p>
                                <ul className="text-xs mt-1 space-y-0.5">
                                  {result.coherence.factors.map((f, i) => (
                                    <li key={i}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                        
                        {result.url && result.url !== "#" && (
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Visit
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isSearching && results.length === 0 && query && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Enter a natural language query above to find potential trading partners. 
              The 12% Discovery Engine will find additional matches beyond standard AI search.
            </AlertDescription>
          </Alert>
        )}

        {/* Initial State */}
        {!isSearching && results.length === 0 && !query && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Find Your Trading Partners</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Use natural language to search for buyers or sellers. Our 12% Discovery Engine 
                finds additional matches that standard AI search misses.
              </p>
              {isDemoMode && (
                <p className="text-xs text-amber-600 mt-4">
                  You're in demo mode - searches will return simulated results
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Demo Confirm Dialog */}
        <DemoConfirmDialog
          open={showDemoConfirm}
          onOpenChange={setShowDemoConfirm}
          selectedCount={selectedResults.size}
          queryContext={parsedQuery ? {
            product: parsedQuery.product,
            location: parsedQuery.location,
            role: parsedQuery.role,
          } : undefined}
        />
      </div>
    </TooltipProvider>
  );
}
