import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, ArrowLeft, Check, Info, Sparkles, Copy } from "lucide-react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { type DemoSearchResult, getDemoResultsForQuery, calculateSearchMetrics } from "@/lib/demo-data";

export default function Demo() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DemoSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [showIntentDialog, setShowIntentDialog] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  
  // Helper for cross-domain auth links
  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    const authUrl = getAuthUrl();
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Enter a search query");
      return;
    }

    setIsSearching(true);
    setResults([]);
    setSelectedResults(new Set());
    setHasSearched(true);

    await new Promise(resolve => setTimeout(resolve, 800));

    const demoData = getDemoResultsForQuery(query);

    setResults(demoData);
    setIsSearching(false);
    toast.success(`Found ${demoData.length} counterparties`);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const { baselineCount, enrichedCount, totalCount, upliftPct } = calculateSearchMetrics(results);

  const sampleMatchId = `match_${Math.random().toString(36).substring(2, 8)}`;
  const sampleHash = `sha256:${Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('')}...`;
  const sampleTimestamp = new Date().toISOString();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <nav className="border-b border-border bg-background sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
              <div className="h-6 w-6 rounded bg-foreground flex items-center justify-center">
                <span className="text-background font-bold text-[10px]">CM</span>
              </div>
              <span className="font-medium text-sm text-foreground hidden sm:inline">Compliance Matching API</span>
            </Link>
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 text-xs font-medium text-muted-foreground border border-border rounded">
                Sandbox
              </span>
              <AuthLink className="inline-flex items-center justify-center">
                <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90">
                  Get API Key
                </Button>
              </AuthLink>
            </div>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          {/* Demo Notice */}
          <div className="mb-8 p-4 border border-border rounded-lg bg-muted/30">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Demo mode</span> — Results are simulated. No real evidence records are created.{" "}
              <AuthLink className="text-primary hover:underline">Sign up</AuthLink> to generate real proofs.
            </p>
          </div>

          {/* Search */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground mb-2">Counterparty Search</h1>
            <p className="text-muted-foreground mb-6">
              Enter a natural language query to find potential counterparties
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="e.g., buyers for cashew in India"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 h-11"
              />
              <Button 
                onClick={handleSearch} 
                disabled={isSearching} 
                className="h-11 px-6 bg-foreground text-background hover:bg-foreground/90"
              >
                {isSearching ? "Searching..." : "Search"}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-xs text-muted-foreground">Try:</span>
              {["buyers for cashew in India", "copper cathode suppliers", "agricultural exporters"].map((example) => (
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
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border border-border rounded-lg bg-background">
              <div className="flex flex-wrap items-center gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Baseline: </span>
                  <span className="font-medium text-foreground">{baselineCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Discovery Engine: </span>
                  <span className="font-medium text-foreground">+{enrichedCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-medium text-foreground">{totalCount}</span>
                </div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Uplift: </span>
                <span className="font-medium text-foreground">+{upliftPct}%</span>
              </div>
            </div>
          )}

          {/* Loading */}
          {isSearching && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 border border-border rounded-lg">
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
                <h2 className="text-sm font-medium text-foreground">
                  {results.length} results
                </h2>
                {selectedResults.size > 0 && (
                  <Button 
                    onClick={handleDemoConfirmIntent} 
                    size="sm"
                    className="bg-foreground text-background hover:bg-foreground/90"
                  >
                    Confirm Intent ({selectedResults.size})
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {results.map((result, idx) => (
                  <div 
                    key={result.id}
                    onClick={() => toggleSelect(result.id)}
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedResults.has(result.id) 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <div className={`h-9 w-9 rounded flex items-center justify-center text-sm font-medium ${
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
                        <span className="text-xs font-mono text-muted-foreground">
                          {result.score > 1 ? result.score : Math.round(result.score * 100)}%
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-medium text-foreground">{result.title}</h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {result.isEnriched && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground border border-border">
                                    <Sparkles className="h-3 w-3" />
                                    Discovery
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  <p className="text-sm font-medium mb-1">Why surfaced</p>
                                  <p className="text-sm text-muted-foreground">{result.whySurfaced}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <span className="text-xs text-muted-foreground">{result.source}</span>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{result.description}</p>
                        
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
            <div className="text-center py-16 text-muted-foreground">
              <p>No results found. Try a different query.</p>
            </div>
          )}

          {/* Initial state */}
          {!hasSearched && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">Enter a search query to find counterparties</p>
              <p className="text-sm text-muted-foreground">
                Try queries like "buyers for cashew in India" or "copper cathode suppliers"
              </p>
            </div>
          )}
        </div>

        {/* Demo Intent Dialog */}
        <Dialog open={showIntentDialog} onOpenChange={setShowIntentDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Demo: Intent Confirmation Preview</DialogTitle>
              <DialogDescription>
                This shows what a real confirmation would produce
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <p className="text-sm font-medium text-foreground mb-3">
                  In production, Confirm Intent would:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span>Record interest between parties (no payment, no contract)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span>Create a tamper-evident evidence record with SHA-256 hash</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span>Add entries to the chain-linked audit log</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span>Trigger configured webhook notifications</span>
                  </li>
                </ul>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">Sample response</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-2"
                    onClick={() => copyToClipboard(JSON.stringify({
                      id: sampleMatchId,
                      status: "confirmed",
                      created_at: sampleTimestamp,
                      hash: sampleHash,
                      counterparties: selectedResults.size,
                      note: "Intent recorded. No legal obligation created."
                    }, null, 2))}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <pre className="p-4 text-xs text-foreground overflow-x-auto font-mono">
{`{
  "id": "${sampleMatchId}",
  "status": "confirmed",
  "created_at": "${sampleTimestamp}",
  "hash": "${sampleHash}",
  "counterparties": ${selectedResults.size},
  "note": "Intent recorded. No legal obligation created."
}`}
                </pre>
              </div>

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setShowIntentDialog(false)}
                >
                  Continue exploring
                </Button>
                <AuthLink className="flex-1">
                  <Button className="w-full bg-foreground text-background hover:bg-foreground/90">
                    Sign up for real proofs
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </AuthLink>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
