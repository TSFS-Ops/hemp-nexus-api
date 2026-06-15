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
import { apiFetch } from "@/lib/api-client";
import { handleApiError } from "@/lib/api-error-handler";
import { useAuth } from "@/contexts/AuthContext";
import { SearchHeader } from "@/components/search/SearchHeader";
import { SearchMetricsCard } from "@/components/search/SearchMetricsCard";
import { CompactCounterpartyRow } from "@/components/search/CompactCounterpartyRow";
import { ResultCardErrorBoundary } from "@/components/search/ResultCardErrorBoundary";
import { SimilarCounterpartiesSheet } from "@/components/search/SimilarCounterpartiesSheet";
import { consumePreAuthState } from "@/lib/pre-auth-state";
import { sanitizeSearchResults, detectDegradation, type DegradationInfo } from "@/lib/sanitize-search-results";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import {
  ROLE_CONFIRMATION_REQUIRED,
  inferUserSideFromParsedRole,
  detectSideConflict,
  recordRoleConfirmation,
  type TradeSide,
} from "@/lib/role-confirmation";
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
  metadata?: {
    web_discovered?: boolean;
    has_contact?: boolean;
    contact_masked?: boolean;
    verified?: boolean;
    [key: string]: any;
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

/** Persist a trade interest to the trade_orders table */
async function persistTradeOrder(
  product: string,
  ctx: { side?: "buyer" | "seller"; price?: string; volume?: string; location?: string }
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data: profile } = await supabase.from("profiles").select("id, org_id").eq("id", session.user.id).maybeSingle();
    if (!profile?.org_id) return;

    const { error } = await supabase.from("trade_orders").insert({
      org_id: profile.org_id,
      user_id: profile.id,
      side: ctx.side === "seller" ? "offer" : "bid",
      product,
      price: ctx.price ? parseFloat(ctx.price) || null : null,
      volume: ctx.volume ? parseFloat(ctx.volume) || null : null,
      location: ctx.location || null,
    } as any);

    if (error) {
      console.error("Failed to save trade order:", error);
      toast.error("Failed to save trade order", {
        description: "Your trade interest could not be recorded. Please try again.",
      });
    }
  } catch (err) {
    console.error("Failed to save trade order:", err);
    toast.error("Failed to save trade order", {
      description: "An unexpected error occurred. Please try again.",
    });
  }
}

export default function CounterpartySearch() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = (searchParams.get("q") || "").trim();
  const initialSide = searchParams.get("side") as "buyer" | "seller" | null;
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
  // D-03: explicit role-confirmation gate for selected vs inferred side
  const [showRoleConfirmDialog, setShowRoleConfirmDialog] = useState(false);
  const [roleConfirmBusy, setRoleConfirmBusy] = useState(false);

  // Structured trade interest context from landing page
  const [tradeContext, setTradeContext] = useState<{
    side?: "buyer" | "seller";
    price?: string;
    volume?: string;
    location?: string;
  }>({ side: initialSide || undefined, price: initialPrice, volume: initialVolume, location: initialLocation });

  const [hasAutoSearched, setHasAutoSearched] = useState(false);

  // ── Session-expiry preservation ──────────────────────────────────────
  // The selection set + tradeContext represent real work the user typed
  // before clicking Create Draft Match. Without this, an expiry between
  // selecting and confirming silently throws their picks away. The draft
  // is rehydrated on mount; cleared after a successful create.
  const draftSelection = useDraftPersistence<{
    query: string;
    selected: string[];
    tradeContext: typeof tradeContext;
  }>("counterparty-search-selection", () => ({
    query,
    selected: Array.from(selectedResults),
    tradeContext,
  }));

  useEffect(() => {
    const restored = draftSelection.restoreDraft();
    if (!restored) return;
    if (restored.query && !query) setQuery(restored.query);
    if (restored.tradeContext) setTradeContext(restored.tradeContext);
    if (restored.selected?.length) {
      // Selection IDs are search-result IDs; they will only re-bind once the
      // user re-runs the search. Tell them clearly so they don't think the
      // picks vanished.
      toast.info(
        `Your ${restored.selected.length} previous selection${restored.selected.length > 1 ? "s were" : " was"} saved. Re-run the search to continue.`
      );
    }
    // Run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore pre-auth state on mount (when returning from auth flow)
  useEffect(() => {
    if (authLoading) return;
    const resumed = searchParams.get("resume");
    if (resumed !== "1") return;
    
    const preAuth = consumePreAuthState();
    if (preAuth?.query && !query) {
      setQuery(preAuth.query);
      if (preAuth.side || preAuth.price || preAuth.volume) {
        setTradeContext({ side: preAuth.side, price: preAuth.price, volume: preAuth.volume });
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
      const role = tradeContext.side === "seller" ? "seller" : tradeContext.side === "buyer" ? "buyer" : undefined;
      const data = await apiFetch<any>("search", {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), limit: 20, ...(role ? { role } : {}), ...(tradeContext.location ? { location: tradeContext.location } : {}) }),
      });

      if (controller.signal.aborted) return;

      if (data.ok) {
        // Sanitize results to prevent crashes from malformed API data
        const safeResults = sanitizeSearchResults(data.results);
        setResults(safeResults);
        setMetrics(data.metrics || null);
        setParsedQuery(data.parsedQuery || null);
        setDegradation(detectDegradation(data.metrics));

        if (tradeContext.side) {
          persistTradeOrder(query.trim(), tradeContext);
        }
      } else {
        throw new Error(data.error || "Search failed");
      }
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        setSearchError("Search timed out. The server may be busy. Please try again.");
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

  const inferredUserSide: TradeSide | null = inferUserSideFromParsedRole(parsedQuery?.role ?? null);
  const selectedSide: TradeSide | null = (tradeContext.side as TradeSide | undefined) ?? null;
  const sideConflict = detectSideConflict(selectedSide, inferredUserSide);

  const handleCreateMatchClick = () => {
    if (selectedResults.size === 0) {
      toast.error("Please select at least one trading partner");
      return;
    }
    // D-03: block progression when inferred side conflicts with selected side.
    // The user must explicitly confirm or correct. Feature flag allows
    // emergency rollback only; default is the safe (gated) behaviour.
    if (ROLE_CONFIRMATION_REQUIRED && sideConflict) {
      setShowRoleConfirmDialog(true);
      return;
    }
    setShowDraftDialog(true);
  };

  // D-03: user explicitly confirmed (kept selected side) or corrected (switched
  // to inferred side). Either way write the canonical audit row, then continue.
  const handleRoleConfirm = async (confirmedSide: TradeSide) => {
    if (roleConfirmBusy) return;
    setRoleConfirmBusy(true);
    try {
      await recordRoleConfirmation({
        originalSelectedSide: selectedSide,
        inferredSide: inferredUserSide,
        confirmedSide,
        draftId: null,
        sourceComponent: "CounterpartySearch",
      });
      // If user corrected, propagate the new side into tradeContext + URL so
      // the downstream match payload uses the corrected side.
      if (confirmedSide !== selectedSide) {
        setTradeContext((prev) => ({ ...prev, side: confirmedSide }));
        setSearchParams((prev) => {
          const updated = new URLSearchParams(prev);
          updated.set("side", confirmedSide);
          return updated;
        }, { replace: true });
      }
      setShowRoleConfirmDialog(false);
      setShowDraftDialog(true);
    } catch (err) {
      console.error("Failed to record role confirmation:", err);
      toast.error("Could not record your side confirmation. Please try again.");
    } finally {
      setRoleConfirmBusy(false);
    }
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
                // R1: never send `id` for the counterparty side - search-result IDs are
                // NOT org UUIDs and would either resolve to null (best case) or, if the
                // string happens to collide with a real org UUID, write the WRONG org
                // into the buyer/seller slot. Only send a verified org_id for the
                // creator's own side; leave the counterparty slot empty so the
                // auto_link_engagement_on_signup trigger fills it on signup.
                buyer: tradeContext.side === "seller"
                  ? { name: selectedResult.title }
                  : { name: org?.name || profile.full_name || "Your Organisation", org_id: profile.org_id },
                seller: tradeContext.side === "seller"
                  ? { name: org?.name || profile.full_name || "Your Organisation", org_id: profile.org_id }
                  : { name: selectedResult.title },
                commodity: parsedQuery?.product || query,
                quantity: (() => {
                  const v = tradeContext.volume ? parseFloat(tradeContext.volume) : NaN;
                  return !isNaN(v) && v > 0 ? { amount: v, unit: "MT" } : null;
                })(),
                price: (() => {
                  const p = tradeContext.price ? parseFloat(tradeContext.price) : NaN;
                  return !isNaN(p) && p > 0 ? { amount: p, currency: "USD" } : null;
                })(),
                terms: null,
                metadata: { 
                  searchQuery: query, 
                  parsedQuery,
                  source: selectedResult.source,
                  coherenceScore: selectedResult.coherence?.score,
                  isDraft: (() => {
                    const hasValidPrice = !isNaN(parseFloat(tradeContext.price || "")) && parseFloat(tradeContext.price || "") > 0;
                    const hasValidVolume = !isNaN(parseFloat(tradeContext.volume || "")) && parseFloat(tradeContext.volume || "") > 0;
                    return !hasValidPrice && !hasValidVolume;
                  })(),
                  draftReason: (() => {
                    const hasValidPrice = !isNaN(parseFloat(tradeContext.price || "")) && parseFloat(tradeContext.price || "") > 0;
                    const hasValidVolume = !isNaN(parseFloat(tradeContext.volume || "")) && parseFloat(tradeContext.volume || "") > 0;
                    return !hasValidPrice && !hasValidVolume
                      ? "Created from search - commercial terms to be confirmed during negotiation."
                      : undefined;
                  })(),
                  tradeSide: tradeContext.side || null,
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
        // All selected partners were created/deduped successfully - clear the
        // session-expiry draft so the user isn't prompted to "resume" stale work.
        draftSelection.clearDraft();
      }

      const total = created + duplicates + failed;
      if (failed === 0 && duplicates === 0) {
        if (created === 1 && lastMatchId) {
          toast.success("Draft match created - add commercial terms and documents, then send a trade request.");
          navigate(`/desk/match/${lastMatchId}`);
        } else {
          toast.success(`${created} draft matches created. Add commercial terms in each match before sending a trade request.`);
          navigate("/desk/deals");
        }
      } else if (failed === 0) {
        if (created > 0) {
          toast.success(`${created} new draft match${created > 1 ? "es" : ""} created. ${duplicates} already existed and were skipped.`);
        } else {
          toast.info(`All ${duplicates} match${duplicates > 1 ? "es" : ""} already exist - no duplicates created. View them in your matches.`);
        }
        navigate("/desk/deals");
      } else if (created > 0 || duplicates > 0) {
        const ok = created + duplicates;
        toast.warning(
          `${ok} of ${total} processed (${created} new, ${duplicates} already existed). ${failed} failed: ${failedNames.slice(0, 2).join(", ")}${failedNames.length > 2 ? "…" : ""}. You can retry the failed items.`
        );
        navigate("/desk/deals");
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
          side={tradeContext.side || null}
          onSideChange={(newSide) => {
            setTradeContext((prev) => ({ ...prev, side: newSide }));
            setSearchParams((prev) => {
              const updated = new URLSearchParams(prev);
              updated.set("side", newSide);
              return updated;
            }, { replace: true });
          }}
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
            {tradeContext.volume && !isNaN(parseFloat(tradeContext.volume)) && parseFloat(tradeContext.volume) > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <Badge variant="outline" className="text-[10px] sm:text-xs">
                  {tradeContext.volume} MT
                </Badge>
              </>
            )}
            {tradeContext.price && !isNaN(parseFloat(tradeContext.price)) && parseFloat(tradeContext.price) > 0 && (
              <>
                <span className="text-muted-foreground">@</span>
                <Badge variant="outline" className="text-[10px] sm:text-xs">
                  ${tradeContext.price}
                </Badge>
              </>
            )}
          </div>
        )}

        {/* Metrics Card */}
        {metrics && <SearchMetricsCard metrics={metrics} />}

        {/* Degraded mode banner, web discovery is down */}
        {!isSearching && degradation.isPartiallyDegraded && degradation.message && (
          <Alert className="border-warning/30 bg-warning/5">
            <WifiOff className="h-4 w-4 text-warning" />
            <AlertDescription className="text-xs sm:text-sm text-warning-foreground">
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

        {/* Pre-Search Empty State intentionally removed per design. */}

        {/* Results */}
        {!isSearching && !searchError && results.length > 0 && (() => {
          // Live source-tier chip counts - mirrors the Desk's "Requires Your Attention" header language
          const counts = results.reduce(
            (acc, r) => {
              if (r.source === "verified_registry") acc.verified += 1;
              else if (r.source === "counterparty_registry") acc.registered += 1;
              else if (r.source === "order_book") acc.orderBook += 1;
              else if (r.source === "web_discovery" || r.metadata?.web_discovered) acc.web += 1;
              return acc;
            },
            { verified: 0, registered: 0, orderBook: 0, web: 0 },
          );
          return (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {/* Elegant header - eyebrow + title + live chips */}
              <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap px-4 sm:px-5 py-4 border-b border-slate-100">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-1">
                    Network Results
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                      {results.length} Counterpart{results.length !== 1 ? "ies" : "y"}
                    </h3>
                    {counts.verified > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-mono tracking-wider uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--emerald))]" />
                        {counts.verified} verified
                      </span>
                    )}
                    {counts.registered > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-[10px] font-mono tracking-wider uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                        {counts.registered} registered
                      </span>
                    )}
                    {counts.orderBook > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 text-[10px] font-mono tracking-wider uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                        {counts.orderBook} order book
                      </span>
                    )}
                    {counts.web > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-mono tracking-wider uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {counts.web} web
                      </span>
                    )}
                  </div>
                </div>
                {selectedResults.size > 0 && (
                  <Button
                    onClick={handleCreateMatchClick}
                    disabled={isConfirming}
                    size="sm"
                    className="h-9 text-xs sm:text-sm touch-target bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {isConfirming ? (
                      <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                    )}
                    {isConfirming ? "Creating…" : `Create Draft Match (${selectedResults.size})`}
                  </Button>
                )}
              </div>

              {/* Compact row list - Desk aesthetic */}
              <ul className="divide-y divide-slate-100">
                {results.map((result, idx) => (
                  <ResultCardErrorBoundary key={result.id} companyName={result.title}>
                    <CompactCounterpartyRow
                      result={result}
                      rank={idx + 1}
                      isSelected={selectedResults.has(result.id)}
                      onToggleSelect={toggleSelect}
                      onFindSimilar={setSimilarAnchor}
                      userSide={tradeContext.side}
                    />
                  </ResultCardErrorBoundary>
                ))}
              </ul>

              {results.length >= 5 && (
                <div className="px-4 sm:px-5 py-2.5 border-t border-slate-100 bg-slate-50/50">
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <Info className="h-3 w-3" />
                    Showing top {results.length} results. Refine your query for more specific matches.
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Sticky floating CTA, always visible when trading partners are selected */}
        {!isSearching && results.length > 0 && selectedResults.size > 0 && (
          <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 pb-3 pt-2 bg-gradient-to-t from-background via-background to-transparent">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg">
              <span className="text-xs sm:text-sm text-muted-foreground">
                {selectedResults.size} counterpart{selectedResults.size !== 1 ? "ies" : "y"} selected
              </span>
              <Button
                onClick={handleCreateMatchClick}
                disabled={isConfirming}
                size="sm"
                className="h-9 text-xs sm:text-sm touch-target"
              >
                {isConfirming ? (
                  <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                )}
                {isConfirming ? "Creating…" : `Create Draft Match (${selectedResults.size})`}
              </Button>
            </div>
          </div>
        )}

        {/* D-03 Role-confirmation Dialog: blocks progression when the inferred
            side conflicts with the user's selected side. */}
        <AlertDialog
          open={showRoleConfirmDialog}
          onOpenChange={(open) => { if (!roleConfirmBusy) setShowRoleConfirmDialog(open); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm your side</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  This trade appears to place your organisation as{" "}
                  <strong>{inferredUserSide ?? "-"}</strong>.
                  You currently have <strong>{selectedSide ?? "no side"}</strong> selected.
                </p>
                <p>Please confirm or correct your side before continuing.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <AlertDialogCancel disabled={roleConfirmBusy}>
                Cancel
              </AlertDialogCancel>
              {selectedSide && (
                <Button
                  variant="outline"
                  disabled={roleConfirmBusy}
                  onClick={() => handleRoleConfirm(selectedSide)}
                >
                  Keep {selectedSide}
                </Button>
              )}
              {inferredUserSide && (
                <Button
                  disabled={roleConfirmBusy}
                  onClick={() => handleRoleConfirm(inferredUserSide)}
                >
                  Correct to {inferredUserSide}
                </Button>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Draft Match Confirmation Dialog */}
        <AlertDialog open={showDraftDialog} onOpenChange={setShowDraftDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Create {(() => {
                const vp = parseFloat(tradeContext.price || "");
                const vv = parseFloat(tradeContext.volume || "");
                return (!isNaN(vp) && vp > 0) || (!isNaN(vv) && vv > 0) ? "" : "Draft ";
              })()}Match{selectedResults.size > 1 ? "es" : ""}</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>
                  You are about to create {selectedResults.size} match{selectedResults.size > 1 ? "es" : ""} for <strong>{parsedQuery?.product || query}</strong>.
                </p>
                {(() => {
                  const validPrice = !isNaN(parseFloat(tradeContext.price || "")) && parseFloat(tradeContext.price || "") > 0;
                  const validVolume = !isNaN(parseFloat(tradeContext.volume || "")) && parseFloat(tradeContext.volume || "") > 0;
                  if (validPrice || validVolume) {
                    return (
                      <p>
                        <strong>Commercial terms from your Trade Request will be recorded:</strong>
                        {validVolume && ` Quantity: ${tradeContext.volume} MT`}
                        {validPrice && ` · Price: $${tradeContext.price}`}
                        {tradeContext.side && ` · Side: ${tradeContext.side.toUpperCase()}`}
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
