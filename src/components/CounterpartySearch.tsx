import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileText, Info, Loader2, Search, AlertTriangle, SearchX, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SearchHeader } from "@/components/search/SearchHeader";
import { SearchMetricsCard } from "@/components/search/SearchMetricsCard";
import { CounterpartyResultCard } from "@/components/search/CounterpartyResultCard";
import { ResultCardErrorBoundary } from "@/components/search/ResultCardErrorBoundary";
import { SimilarCounterpartiesSheet } from "@/components/search/SimilarCounterpartiesSheet";
import { consumePreAuthState } from "@/lib/pre-auth-state";
import { sanitizeSearchResults, detectDegradation, type DegradationInfo } from "@/lib/sanitize-search-results";
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

/** Persist a bid/offer to the trade_orders table (fire-and-forget) */
async function persistTradeOrder(
  product: string,
  ctx: { side?: "bid" | "offer"; price?: string; volume?: string; location?: string }
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data: profile } = await supabase.from("profiles").select("id, org_id").eq("id", session.user.id).maybeSingle();
    if (!profile?.org_id) return;

    await supabase.from("trade_orders").insert({
      org_id: profile.org_id,
      user_id: profile.id,
      side: ctx.side || "bid",
      product,
      price: ctx.price ? parseFloat(ctx.price) || null : null,
      volume: ctx.volume ? parseFloat(ctx.volume) || null : null,
      location: ctx.location || null,
    } as any);
  } catch (err) {
    console.warn("Failed to persist trade order:", err);
  }
}

export default function CounterpartySearch() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = (searchParams.get("q") || "").trim();
  const initialSide = searchParams.get("side") as "bid" | "offer" | null;
  const initialPrice = searchParams.get("price") || "";
  const initialVolume = searchParams.get("volume") || "";
  const initialLocation = searchParams.get("location") || "";

  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [metrics, setMetrics] = useState<SearchMetrics | null>(null);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [similarAnchor, setSimilarAnchor] = useState<SearchResult | null>(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [degradation, setDegradation] = useState<DegradationInfo>({ isPartiallyDegraded: false, webDiscoveryDown: false, message: null });

  // Structured bid/offer context from landing page
  const [bidOfferContext, setBidOfferContext] = useState<{
    side?: "bid" | "offer";
    price?: string;
    volume?: string;
    location?: string;
  }>({ side: initialSide || undefined, price: initialPrice, volume: initialVolume, location: initialLocation });

  const [hasAutoSearched, setHasAutoSearched] = useState(false);

  // Restore pre-auth state on mount (when returning from auth flow)
  useEffect(() => {
    if (authLoading) return;
    const resumed = searchParams.get("resume");
    if (resumed !== "1") return;
    
    const preAuth = consumePreAuthState();
    if (preAuth?.query && !query) {
      setQuery(preAuth.query);
      if (preAuth.side || preAuth.price || preAuth.volume) {
        setBidOfferContext({ side: preAuth.side, price: preAuth.price, volume: preAuth.volume });
      }
      setSearchParams((prev) => {
        const updated = new URLSearchParams(prev);
        updated.set("q", preAuth.query);
        if (preAuth.side) updated.set("side", preAuth.side);
        if (preAuth.price) updated.set("price", preAuth.price);
        if (preAuth.volume) updated.set("volume", preAuth.volume);
        updated.delete("resume");
        return updated;
      }, { replace: true });
    }
  }, [authLoading]);

  // ── FAILURE MODE 3: AbortController for client disconnect / timeout ──
  const abortRef = React.useRef<AbortController | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    // ── FAILURE MODE 4 (client): Oversized input guard ──
    if (query.trim().length > 500) {
      toast.error("Search query is too long (max 500 characters)");
      return;
    }

    // Abort any in-flight search
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set("q", query.trim());
      return updated;
    }, { replace: true });

    setIsSearching(true);
    setResults([]);
    setMetrics(null);
    setSelectedResults(new Set());
    setSearchError(null);
    setHasSearched(true);

    // ── FAILURE MODE 3: 30s client-side timeout ──
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const role = bidOfferContext.side === "offer" ? "seller" : bidOfferContext.side === "bid" ? "buyer" : undefined;
      const { data, error } = await supabase.functions.invoke("search", {
        body: { query: query.trim(), limit: 20, ...(role ? { role } : {}), ...(bidOfferContext.location ? { location: bidOfferContext.location } : {}) },
      });

      // If aborted while waiting, exit silently
      if (controller.signal.aborted) return;

      if (error) throw error;

      if (data.ok) {
        // Sanitize results to prevent crashes from malformed API data
        const safeResults = sanitizeSearchResults(data.results);
        setResults(safeResults);
        setMetrics(data.metrics || null);
        setParsedQuery(data.parsedQuery || null);
        setDegradation(detectDegradation(data.metrics));

        if (bidOfferContext.side) {
          persistTradeOrder(query.trim(), bidOfferContext);
        }
      } else {
        throw new Error(data.error || "Search failed");
      }
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        setSearchError("Search timed out. The server may be busy — please try again.");
        return;
      }
      console.error("Search error:", error);
      const msg = error instanceof Error ? error.message : "Search failed";
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed to fetch")) {
        setSearchError("Network error. Check your connection and try again.");
      } else if (msg.includes("rate") || msg.includes("429")) {
        setSearchError("Too many requests. Please wait a moment before searching again.");
      } else if (msg.includes("Invalid JSON") || msg.includes("too long")) {
        setSearchError(msg);
      } else {
        setSearchError(`${msg}. If this persists, contact support@izenzo.co.za.`);
      }
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
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
      toast.error("Please select at least one trading partner");
      return;
    }
    setShowDraftDialog(true);
  };

  const handleConfirmDraftCreation = async () => {
    setShowDraftDialog(false);
    if (selectedResults.size === 0) return;
    if (isConfirming) return;

    setIsConfirming(true);
    // Generate a batch idempotency key to prevent duplicate match creation on retry
    const batchKey = crypto.randomUUID();
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
        toast.error("No valid trading partners selected");
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
          const idempotencyKey = `match_create_${batchKey}_${selectedResult.id}`;
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
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
                quantity: (() => {
                  const v = bidOfferContext.volume ? parseFloat(bidOfferContext.volume) : NaN;
                  return !isNaN(v) && v > 0 ? { amount: v, unit: "MT" } : null;
                })(),
                price: (() => {
                  const p = bidOfferContext.price ? parseFloat(bidOfferContext.price) : NaN;
                  return !isNaN(p) && p > 0 ? { amount: p, currency: "USD" } : null;
                })(),
                terms: null,
                metadata: { 
                  searchQuery: query, 
                  parsedQuery,
                  source: selectedResult.source,
                  coherenceScore: selectedResult.coherence?.score,
                  isDraft: (() => {
                    const hasValidPrice = !isNaN(parseFloat(bidOfferContext.price || "")) && parseFloat(bidOfferContext.price || "") > 0;
                    const hasValidVolume = !isNaN(parseFloat(bidOfferContext.volume || "")) && parseFloat(bidOfferContext.volume || "") > 0;
                    return !hasValidPrice && !hasValidVolume;
                  })(),
                  draftReason: (() => {
                    const hasValidPrice = !isNaN(parseFloat(bidOfferContext.price || "")) && parseFloat(bidOfferContext.price || "") > 0;
                    const hasValidVolume = !isNaN(parseFloat(bidOfferContext.volume || "")) && parseFloat(bidOfferContext.volume || "") > 0;
                    return !hasValidPrice && !hasValidVolume
                      ? "Created from search - commercial terms to be confirmed during negotiation."
                      : undefined;
                  })(),
                  bidOfferSide: bidOfferContext.side || null,
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
          toast.success("Draft match created - add commercial terms and documents, then send a trade request.");
          navigate(`/dashboard/matches/${lastMatchId}`);
        } else {
          toast.success(`${created} draft matches created. Add commercial terms in each match before sending a trade request.`);
          navigate("/dashboard/matches");
        }
      } else if (failed === 0) {
        if (created > 0) {
          toast.success(`${created} new draft match${created > 1 ? "es" : ""} created. ${duplicates} already existed and were skipped.`);
        } else {
          toast.info(`All ${duplicates} match${duplicates > 1 ? "es" : ""} already exist - no duplicates created. View them in your matches.`);
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
      console.error("Start intent error:", error);
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
            {bidOfferContext.volume && !isNaN(parseFloat(bidOfferContext.volume)) && parseFloat(bidOfferContext.volume) > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <Badge variant="outline" className="text-[10px] sm:text-xs">
                  {bidOfferContext.volume} MT
                </Badge>
              </>
            )}
            {bidOfferContext.price && !isNaN(parseFloat(bidOfferContext.price)) && parseFloat(bidOfferContext.price) > 0 && (
              <>
                <span className="text-muted-foreground">@</span>
                <Badge variant="outline" className="text-[10px] sm:text-xs">
                  ${bidOfferContext.price}
                </Badge>
              </>
            )}
          </div>
        )}

        {/* Metrics Card */}
        {metrics && <SearchMetricsCard metrics={metrics} />}

        {/* Degraded mode banner — web discovery is down */}
        {!isSearching && degradation.isPartiallyDegraded && degradation.message && (
          <Alert className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
            <WifiOff className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs sm:text-sm text-amber-800 dark:text-amber-300">
              {degradation.message}
            </AlertDescription>
          </Alert>
        )}

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

        {/* Error State */}
        {!isSearching && searchError && (
          <Card className="border-destructive/30">
            <CardContent className="py-8 text-center space-y-3">
              <AlertTriangle className="h-10 w-10 mx-auto text-destructive" />
              <div>
                <p className="font-medium text-foreground">Search failed</p>
                <p className="text-sm text-muted-foreground mt-1">{searchError}</p>
              </div>
              <Button variant="outline" onClick={handleSearch}>
                Retry search
              </Button>
            </CardContent>
          </Card>
        )}

        {/* No Results State */}
        {!isSearching && !searchError && hasSearched && results.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center space-y-3">
              <SearchX className="h-10 w-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">No trading partners found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No registered trading partners matched "{query}". Try broadening your query, or use the Bilateral tab to create a match with a known trading partner.
                </p>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Tips: Include a commodity name (e.g. "chrome ore"), a region, or a company name.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pre-Search Empty State */}
        {!isSearching && !searchError && !hasSearched && results.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <Search className="h-10 w-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">Search for trading partners</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  Enter a commodity, region, or company name above to find registered buyers and sellers. 
                  Select one or more results to create a draft match.
                </p>
              </div>
              <div className="text-xs text-muted-foreground max-w-sm mx-auto">
                <p className="font-medium mb-1">Example searches:</p>
                <p>"chrome ore South Africa" · "manganese buyer" · "coal exports Richards Bay"</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {!isSearching && !searchError && results.length > 0 && (
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

        {/* Draft Match Confirmation Dialog */}
        <AlertDialog open={showDraftDialog} onOpenChange={setShowDraftDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Create {(() => {
                const vp = parseFloat(bidOfferContext.price || "");
                const vv = parseFloat(bidOfferContext.volume || "");
                return (!isNaN(vp) && vp > 0) || (!isNaN(vv) && vv > 0) ? "" : "Draft ";
              })()}Match{selectedResults.size > 1 ? "es" : ""}</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>
                  You are about to create {selectedResults.size} match{selectedResults.size > 1 ? "es" : ""} for <strong>{parsedQuery?.product || query}</strong>.
                </p>
                {(() => {
                  const validPrice = !isNaN(parseFloat(bidOfferContext.price || "")) && parseFloat(bidOfferContext.price || "") > 0;
                  const validVolume = !isNaN(parseFloat(bidOfferContext.volume || "")) && parseFloat(bidOfferContext.volume || "") > 0;
                  if (validPrice || validVolume) {
                    return (
                      <p>
                        <strong>Commercial terms from your bid/offer will be recorded:</strong>
                        {validVolume && ` Quantity: ${bidOfferContext.volume} MT`}
                        {validPrice && ` · Price: $${bidOfferContext.price}`}
                        {bidOfferContext.side && ` · Side: ${bidOfferContext.side.toUpperCase()}`}
                        . You can amend these on the match detail page.
                      </p>
                    );
                  }
                  return (
                    <p>
                      <strong>This is a draft.</strong> No commercial terms (quantity, price, currency) will be recorded. You will need to add real commercial terms on the match detail page before confirming intent.
                    </p>
                  );
                })()}
                <p className="text-xs text-muted-foreground">
                  Creating a match does not create any financial obligation or deduct credits.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDraftCreation}>
                Create Draft{selectedResults.size > 1 ? "s" : ""}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Similar Trading Partners Sheet */}
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
