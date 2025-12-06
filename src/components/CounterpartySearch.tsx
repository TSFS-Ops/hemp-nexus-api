import { useState } from "react";
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

export default function CounterpartySearch() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    setIsSearching(true);
    setResults([]);
    setMetrics(null);
    setSelectedResults(new Set());

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
    
    toast.success(`Selected ${selectedResults.size} counterparties for intent confirmation`);
    // TODO: Navigate to match creation flow
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Search Header */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Find Counterparties
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
                {results.length} Potential Counterparties
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
                            {result.coherence.factors.length > 0 && (
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
                        
                        {result.url && (
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
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
