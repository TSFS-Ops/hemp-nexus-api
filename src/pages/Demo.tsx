import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Search, Sparkles, TrendingUp, ExternalLink, ArrowRight, 
  Zap, Users, CheckCircle, Info, Globe, Lightbulb, 
  Shield, AlertTriangle, Play, Lock, ArrowLeft
} from "lucide-react";
import { toast } from "sonner";

interface DemoResult {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  score: number;
  isEnriched: boolean;
  enrichmentReason: string | null;
  whySurfaced: string;
}

// Simulated demo data - no real API calls
const DEMO_RESULTS: Record<string, DemoResult[]> = {
  "cashew": [
    {
      id: "demo-1",
      title: "GlobalAgri Trading Co.",
      description: "Leading cashew importer in Southeast Asia with certified supply chains and quality assurance programs.",
      url: "#",
      source: "TradeDirectory",
      score: 0.94,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Direct keyword match for 'cashew buyers' with high trade volume signals",
    },
    {
      id: "demo-2",
      title: "IndiaExport Partners Ltd.",
      description: "Established commodity trading house specializing in nuts and dried fruits exports from India.",
      url: "#",
      source: "B2B Platform",
      score: 0.89,
      isEnriched: true,
      enrichmentReason: "supply_chain_adjacency",
      whySurfaced: "12% Engine: Found via supply chain adjacency analysis - trades related nut commodities",
    },
    {
      id: "demo-3",
      title: "SouthAsia Commodities GmbH",
      description: "German import company with established India trade routes and food safety certifications.",
      url: "#",
      source: "TradeDirectory",
      score: 0.85,
      isEnriched: true,
      enrichmentReason: "regional_heuristic",
      whySurfaced: "12% Engine: Regional trade pattern matching - active in India commodity corridor",
    },
    {
      id: "demo-4",
      title: "Pacific Rim Foods Inc.",
      description: "US-based food distributor expanding into raw nut ingredient sourcing.",
      url: "#",
      source: "Industry Database",
      score: 0.78,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Baseline AI match - company profile mentions cashew procurement interest",
    },
    {
      id: "demo-5",
      title: "EuroNuts Trading BV",
      description: "Netherlands-based trader with focus on sustainable and fair-trade certified nuts.",
      url: "#",
      source: "B2B Platform",
      score: 0.72,
      isEnriched: true,
      enrichmentReason: "semantic_expansion",
      whySurfaced: "12% Engine: Semantic expansion found 'fair-trade nuts' as adjacent category",
    },
  ],
  "copper": [
    {
      id: "demo-6",
      title: "MetalWorks International",
      description: "Major copper cathode supplier with mining operations in Chile and Peru.",
      url: "#",
      source: "Mining Directory",
      score: 0.96,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Direct match - registered copper cathode supplier with verified operations",
    },
    {
      id: "demo-7",
      title: "Pacific Metals Corp",
      description: "Japanese trading company with established copper supply contracts in Asia.",
      url: "#",
      source: "Industry Database",
      score: 0.91,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Baseline match - copper trading division with LME-grade inventory",
    },
    {
      id: "demo-8",
      title: "AfricaMineral Resources",
      description: "Zambian copper mining consortium with direct mine-to-market capabilities.",
      url: "#",
      source: "TradeDirectory",
      score: 0.87,
      isEnriched: true,
      enrichmentReason: "regional_heuristic",
      whySurfaced: "12% Engine: Regional mining hub analysis - Zambia copper belt producer",
    },
  ],
  "default": [
    {
      id: "demo-9",
      title: "GlobalTrade Partners",
      description: "Multi-commodity trading house with operations across emerging markets.",
      url: "#",
      source: "B2B Platform",
      score: 0.82,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Baseline match based on query terms and company profile",
    },
    {
      id: "demo-10",
      title: "TradeLink International",
      description: "B2B marketplace facilitating commodity transactions with compliance support.",
      url: "#",
      source: "Industry Database",
      score: 0.75,
      isEnriched: true,
      enrichmentReason: "semantic_expansion",
      whySurfaced: "12% Engine: Semantic expansion found related trading activity",
    },
  ],
};

export default function Demo() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DemoResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [showIntentDialog, setShowIntentDialog] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    setIsSearching(true);
    setResults([]);
    setSelectedResults(new Set());
    setHasSearched(true);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Return demo data based on query keywords
    const lowerQuery = query.toLowerCase();
    let demoData: DemoResult[];
    
    if (lowerQuery.includes("cashew") || lowerQuery.includes("nut")) {
      demoData = DEMO_RESULTS.cashew;
    } else if (lowerQuery.includes("copper") || lowerQuery.includes("metal") || lowerQuery.includes("cathode")) {
      demoData = DEMO_RESULTS.copper;
    } else {
      demoData = DEMO_RESULTS.default;
    }

    setResults(demoData);
    setIsSearching(false);
    toast.success(`Demo: Found ${demoData.length} example counterparties`);
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

  const handleDemoConfirmIntent = () => {
    if (selectedResults.size === 0) {
      toast.error("Please select at least one counterparty");
      return;
    }
    setShowIntentDialog(true);
  };

  const baselineCount = results.filter(r => !r.isEnriched).length;
  const enrichedCount = results.length;
  const upliftPct = baselineCount > 0 ? Math.round(((enrichedCount - baselineCount) / baselineCount) * 100) : 0;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        {/* Header */}
        <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-4 w-4" />
              <Shield className="h-6 w-6 text-primary" />
              <span className="font-bold text-xl">Compliance Matching API</span>
            </Link>
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                <Play className="h-3 w-3 mr-1" />
                Demo Mode
              </Badge>
              <Link to="/auth">
                <Button size="sm">
                  Sign Up for Full Access
                </Button>
              </Link>
            </div>
          </div>
        </nav>

        <div className="container mx-auto px-4 py-8 max-w-5xl">
          {/* Demo Notice */}
          <Alert className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800 dark:text-amber-200">Demo Mode</AlertTitle>
            <AlertDescription className="text-amber-700 dark:text-amber-300">
              This is a preview using simulated data. No real matches or proofs will be created. 
              <Link to="/auth" className="underline ml-1 font-medium">Sign up</Link> for full access to live search and verified intent records.
            </AlertDescription>
          </Alert>

          <div className="space-y-6">
            {/* Search Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Find Counterparties
                  <Badge variant="outline" className="ml-auto">Demo</Badge>
                </CardTitle>
                <CardDescription>
                  Enter a natural language query to see how counterparty discovery works
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Input
                      placeholder="e.g., 'buyers for cashew in India' or 'copper cathode suppliers'"
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

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground">Try:</span>
                  {[
                    "buyers for cashew in India",
                    "copper cathode suppliers",
                    "hemp fiber wholesalers",
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

            {/* Metrics Card */}
            {results.length > 0 && (
              <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{baselineCount}</div>
                        <div className="text-xs text-muted-foreground">Baseline</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <div className="text-center">
                        <div className="text-2xl font-bold text-primary">{enrichedCount}</div>
                        <div className="text-xs text-muted-foreground">Total Found</div>
                      </div>
                      <Separator orientation="vertical" className="h-10" />
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-green-500" />
                        <div>
                          <div className="text-lg font-bold text-green-600">+{upliftPct}%</div>
                          <div className="text-xs text-muted-foreground">12% Engine Uplift</div>
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary">Demo Data</Badge>
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
                    {results.length} Example Counterparties
                  </h3>
                  {selectedResults.size > 0 && (
                    <Button onClick={handleDemoConfirmIntent} size="sm">
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

                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <Tooltip>
                              <TooltipTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                                <Lightbulb className="h-3 w-3" />
                                <span>Why surfaced</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm">
                                <p>{result.whySurfaced}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Initial State */}
            {!isSearching && !hasSearched && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">Try the Counterparty Search</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                    Enter a natural language query above to see how the 12% Discovery Engine 
                    finds additional matches that standard AI search misses.
                  </p>
                  <Badge variant="secondary">Demo Mode - No account required</Badge>
                </CardContent>
              </Card>
            )}

            {/* Sign Up CTA */}
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-6 text-center">
                <Lock className="h-8 w-8 mx-auto text-primary mb-3" />
                <h3 className="font-semibold mb-2">Ready for Real Matching?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Sign up to run live searches, create verified proofs of intent, and access your audit trail.
                </p>
                <Link to="/auth">
                  <Button>
                    Create Free Account
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Demo Intent Dialog */}
        <Dialog open={showIntentDialog} onOpenChange={setShowIntentDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                This is a Preview Only
              </DialogTitle>
              <DialogDescription className="space-y-4 pt-4">
                <p>
                  In demo mode, no real proofs or matches are created. This preview shows 
                  how the "Confirm Intent" flow works.
                </p>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>What would happen with a real account:</strong>
                    <ul className="list-disc ml-4 mt-2 space-y-1">
                      <li>A timestamped intent record would be created</li>
                      <li>The counterparty would receive a notification</li>
                      <li>A hash-verified audit log entry would be stored</li>
                      <li>An evidence pack would be available for compliance</li>
                    </ul>
                  </AlertDescription>
                </Alert>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setShowIntentDialog(false)} className="flex-1">
                    Back to Demo
                  </Button>
                  <Link to="/auth" className="flex-1">
                    <Button className="w-full">
                      Sign Up for Real Access
                    </Button>
                  </Link>
                </div>
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
