import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileText, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SearchHeader } from "@/components/search/SearchHeader";
import { SearchMetricsCard } from "@/components/search/SearchMetricsCard";
import { CounterpartyResultCard } from "@/components/search/CounterpartyResultCard";
import { SimilarCounterpartiesSheet } from "@/components/search/SimilarCounterpartiesSheet";
import { consumePreAuthState } from "@/lib/pre-auth-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = (searchParams.get("q") || "").trim();
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [similarAnchor, setSimilarAnchor] = useState<SearchResult | null>(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);

  const [hasAutoSearched, setHasAutoSearched] = useState(false);

  // Restore pre-auth state on mount (when returning from auth flow)
  useEffect(() => {
    if (authLoading) return;
    const resumed = searchParams.get("resume");
    if (resumed !== "1") return;
    
    const preAuth = consumePreAuthState();
    if (preAuth?.query && !query) {
      setQuery(preAuth.query);
      setSearchParams((prev) => {
        const updated = new URLSearchParams(prev);
        updated.set("q", preAuth.query);
        updated.delete("resume");
        return updated;
      }, { replace: true });
    }
  }, [authLoading]);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set("q", query.trim());
      return updated;
    }, { replace: true });

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
      const msg = error instanceof Error ? error.message : "Search failed";
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed to fetch")) {
        toast.error("Network error. Check your connection and try again.");
      } else if (msg.includes("rate") || msg.includes("429")) {
        toast.error("Too many requests. Please wait a moment before searching again.");
      } else {
        toast.error(`${msg}. If this persists, contact support@izenzo.co.za.`);
      }
    } finally {
      setIsSearching(false);
    }
  };

  // Auto-trigger search if URL contains non-empty ?q= on mount
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

  const handleCreateMatchClick = () => {
    if (selectedResults.size === 0) {
      toast.error("Please select at least one counterparty");
      return;
    }
    setShowDraftDialog(true);
  };

  const handleConfirmDraftCreation = async () => {
    setShowDraftDialog(false);
    if (selectedResults.size === 0) return;
    if (isConfirming) return;

    setIsConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in to create a match");
        return;
      }

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
          toast.error("Your account setup is incomplete. Please sign out and sign in again, or contact support at support@izenzo.co.za.");
          return;
        }
        profile = await supabase
          .from("profiles")
          .select("org_id, full_name")
          .eq("id", session.user.id)
          .maybeSingle()
          .then(r => r.data);
        if (!profile) {
          toast.error("Account setup failed. Please contact support at support@izenzo.co.za.");
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
                // No quantity or price — this is a draft match.
                // Commercial terms will be added during negotiation.
                quantity: null,
                price: null,
                terms: null,
                metadata: { 
                  searchQuery: query, 
                  parsedQuery,
                  source: selectedResult.source,
                  coherenceScore: selectedResult.coherence?.score,
                  isDraft: true,
                  draftReason: "Created from search — commercial terms to be confirmed during negotiation.",
                }
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const matchData = await response.json();

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

      if (failedIds.size > 0) {
        setSelectedResults(failedIds);
      } else {
        setSelectedResults(new Set());
      }

      const total = created + duplicates + failed;
      if (failed === 0 && duplicates === 0) {
        if (created === 1 && lastMatchId) {
          toast.success("Draft match created — add commercial terms and documents, then confirm intent.");
          navigate(`/dashboard/matches/${lastMatchId}`);
        } else {
          toast.success(`${created} draft matches created. Add commercial terms in each match before confirming intent.`);
          navigate("/dashboard/matches");
        }
      } else if (failed === 0) {
        if (created > 0) {
          toast.success(`${created} new draft match${created > 1 ? "es" : ""} created. ${duplicates} already existed and were skipped.`);
        } else {
          toast.info(`All ${duplicates} match${duplicates > 1 ? "es" : ""} already exist — no duplicates created. View them in your matches.`);
        }
        navigate("/dashboard/matches");
      } else if (created > 0 || duplicates > 0) {
        const ok = created + duplicates;
        toast.warning(
          `${ok} of ${total} processed (${created} new, ${duplicates} already existed). ${failed} failed: ${failedNames.slice(0, 2).join(", ")}${failedNames.length > 2 ? "…" : ""}. You can retry the failed items.`
        );
        navigate("/dashboard/matches");
      } else {
        toast.error("All match creation attempts failed. Please try again or contact support at support@izenzo.co.za.");
      }
    } catch (error) {
      console.error("Start POI error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create matches. Please try again.");
    } finally {
      setIsConfirming(false);
    }
  };

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
        {/* Search Header */}
        <SearchHeader
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          isSearching={isSearching}
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-sm sm:text-base">
                {results.length} Counterpart{results.length !== 1 ? "ies" : "y"}
              </h3>
              {selectedResults.size > 0 && (
                <div className="flex items-center gap-2">
                  <Button 
                    onClick={handleCreateMatchClick}
                    disabled={isConfirming}
                    size="sm" 
                    className="h-8 sm:h-9 text-xs sm:text-sm touch-target"
                  >
                    {isConfirming ? (
                      <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                    )}
                    {isConfirming ? "Creating…" : `Create Draft Match (${selectedResults.size})`}
                  </Button>
                </div>
              )}
            </div>

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

            {results.length >= 5 && (
              <Alert className="mt-4">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs sm:text-sm">
                  Showing top {results.length} results. Refine your query for more specific matches.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

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
