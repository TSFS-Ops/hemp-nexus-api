import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, ArrowLeft, Check, Info, ExternalLink } from "lucide-react";
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
      whySurfaced: "Discovery engine: Found via supply chain adjacency - trades related commodities",
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
      whySurfaced: "Discovery engine: Regional trade pattern matching - India commodity corridor",
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
      whySurfaced: "Baseline match - company profile mentions cashew procurement interest",
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
      whySurfaced: "Discovery engine: Semantic expansion found 'fair-trade nuts' as adjacent category",
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
      whySurfaced: "Discovery engine: Regional mining hub analysis - Zambia copper belt producer",
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
      whySurfaced: "Discovery engine: Semantic expansion found related trading activity",
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
      toast.error("Enter a search query");
      return;
    }

    setIsSearching(true);
    setResults([]);
    setSelectedResults(new Set());
    setHasSearched(true);

    await new Promise(resolve => setTimeout(resolve, 1200));

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
    toast.success(`Found ${demoData.length} counterparties (simulated)`);
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
      toast.error("Select at least one counterparty");
      return;
    }
    setShowIntentDialog(true);
  };

  const baselineCount = results.filter(r => !r.isEnriched).length;
  const enrichedCount = results.length;
  const upliftPct = baselineCount > 0 ? Math.round(((enrichedCount - baselineCount) / baselineCount) * 100) : 0;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <nav className="border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 sm:gap-3 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
              <div className="h-6 w-6 rounded bg-foreground flex items-center justify-center">
                <span className="text-background font-bold text-[10px]">CM</span>
              </div>
              <span className="font-medium text-sm text-foreground hidden sm:inline">Compliance Match</span>
            </Link>
            <div className="flex items-center gap-2 sm:gap-4">
              <span className="px-2 py-1 text-xs font-medium rounded bg-muted text-muted-foreground border border-border">
                Sandbox
              </span>
              <Link to="/auth">
                <button className="px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors">
                  Sign up
                </button>
              </Link>
            </div>
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Sandbox Notice */}
          <div className="mb-6 p-3 sm:p-4 bg-muted/40 border border-border rounded-md">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Sandbox mode</span> — Results are simulated.
              <Link to="/auth" className="text-primary hover:underline ml-1">Create an account</Link> for production access.
            </p>
          </div>

          <div className="space-y-6">
            {/* Search */}
            <div className="border border-border rounded-lg bg-card p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-foreground mb-1">Counterparty Search</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Enter a natural language query to find potential counterparties
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="e.g., buyers for cashew in India"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1"
                />
                <Button onClick={handleSearch} disabled={isSearching} className="bg-foreground text-background hover:bg-foreground/90 w-full sm:w-auto">
                  {isSearching ? "Searching..." : "Search"}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">Examples:</span>
                {["buyers for cashew in India", "copper cathode suppliers", "hemp fibre wholesalers"].map((example) => (
                  <button
                    key={example}
                    onClick={() => setQuery(example)}
                    className="text-xs text-primary hover:underline"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            {/* Metrics */}
            {results.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 sm:p-4 bg-muted/40 border border-border rounded-md">
                <div className="flex flex-wrap items-center gap-4 sm:gap-8 text-sm">
                  <div>
                    <span className="text-muted-foreground">Baseline: </span>
                    <span className="font-semibold text-foreground">{baselineCount}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">With discovery: </span>
                    <span className="font-semibold text-foreground">{enrichedCount}</span>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Uplift: </span>
                  <span className="font-semibold text-foreground">+{upliftPct}%</span>
                </div>
              </div>
            )}

            {/* Loading */}
            {isSearching && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 border border-border rounded-md">
                    <div className="flex gap-4">
                      <Skeleton className="h-10 w-10 rounded" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Results */}
            {!isSearching && results.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">
                    {results.length} results
                  </h3>
                  {selectedResults.size > 0 && (
                    <Button 
                      onClick={handleDemoConfirmIntent} 
                      size="sm"
                      className="bg-foreground text-background hover:bg-foreground/90"
                    >
                      Confirm intent ({selectedResults.size})
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {results.map((result, idx) => (
                    <div 
                      key={result.id}
                      onClick={() => toggleSelect(result.id)}
                      className={`p-4 rounded-md border cursor-pointer transition-colors ${
                        selectedResults.has(result.id) 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-border/80 hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center gap-1">
                          <div className={`h-8 w-8 rounded flex items-center justify-center text-sm font-medium ${
                            selectedResults.has(result.id) 
                              ? "bg-primary text-primary-foreground" 
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {selectedResults.has(result.id) ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              idx + 1
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {Math.round(result.score * 100)}%
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-medium text-foreground">{result.title}</h4>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {result.isEnriched && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground border border-border">
                                      +12%
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="text-sm">{result.whySurfaced}</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <span className="text-xs text-muted-foreground">{result.source}</span>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground">{result.description}</p>
                          
                          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                            <Info className="h-3 w-3" />
                            <span>{result.whySurfaced}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!isSearching && hasSearched && results.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No results found. Try a different query.</p>
              </div>
            )}
          </div>
        </div>

        {/* Demo Intent Dialog */}
        <Dialog open={showIntentDialog} onOpenChange={setShowIntentDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Sandbox: Intent Confirmation</DialogTitle>
              <DialogDescription>
                This is a preview of the confirmation flow
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted/40 border border-border rounded-md">
                <p className="text-sm text-muted-foreground mb-2">
                  In production, clicking Confirm Intent would:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Create a timestamped proof-of-intent record</li>
                  <li>• Generate a cryptographic hash for the event chain</li>
                  <li>• Add entries to your audit log</li>
                  <li>• Trigger configured webhook notifications</li>
                </ul>
              </div>

              <div className="border border-border rounded-md overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b border-border">
                  <span className="text-xs font-mono text-muted-foreground">Sample response</span>
                </div>
                <pre className="p-4 text-xs text-foreground overflow-x-auto">
                  <code>{JSON.stringify({
                    id: "match_demo_abc123",
                    status: "confirmed",
                    confirmed_at: new Date().toISOString(),
                    hash: "sha256:f4b2a1c3d5e6...",
                    counterparties: selectedResults.size,
                    sandbox: true
                  }, null, 2)}</code>
                </pre>
              </div>

              <p className="text-xs text-muted-foreground">
                No real records are created in sandbox mode.
              </p>
            </div>

            <div className="flex gap-3">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => setShowIntentDialog(false)}
              >
                Close
              </Button>
              <Link to="/auth" className="flex-1">
                <Button className="w-full bg-foreground text-background hover:bg-foreground/90">
                  Create account
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}