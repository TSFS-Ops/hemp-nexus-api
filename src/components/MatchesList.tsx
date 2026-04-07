import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, Eye, Download, CheckCircle2, Info, ChevronLeft, ChevronRight, FileText, AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { EvidenceChainIndicator } from "@/components/EvidenceChainIndicator";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { EmptyState } from "@/components/ui/error-state";
import { BulkConfirmDialog } from "@/components/match/BulkConfirmDialog";
import { MATCH_STATUS, ROUTES } from "@/lib/constants";
import * as MatchState from "@/lib/match-state";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { downloadCSV } from "@/lib/download-utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlListParams } from "@/hooks/use-url-search-params";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Match = Tables<"matches">;

const PAGE_SIZE = 25;

// Columns actually needed for the list view — avoids SELECT *
const MATCH_LIST_COLUMNS = "id, commodity, buyer_id, buyer_name, seller_id, seller_name, quantity_amount, quantity_unit, price_amount, price_currency, status, state, created_at, settled_at, hash, org_id" as const;

/** Returns display name for buyer/seller based on reveal state */
function revealGuard(match: Match, field: "buyer_name" | "seller_name"): string {
  const state = (match as any).state || "discovery";
  const isRevealed = ["counterparty_sighted", "committed", "completed"].includes(state);
  return isRevealed ? (match[field] || "—") : "••••••";
}

const LIST_DEFAULTS = { status: "all", q: "", sort: "created_at", page: "0" };

const BULK_FAILED_KEY = "izenzo_bulk_failed_ids";

export function MatchesList() {
  const navigate = useNavigate();
  const { params, setParam } = useUrlListParams(LIST_DEFAULTS);
  const statusFilter = params.status;
  const commoditySearch = params.q;
  // Validate sort — only allow known columns to prevent query errors
  const VALID_SORTS = ["created_at", "commodity"] as const;
  const sortBy = (VALID_SORTS as readonly string[]).includes(params.sort)
    ? (params.sort as "created_at" | "commodity")
    : "created_at";
  // Validate page — clamp to non-negative integer
  const rawPage = parseInt(params.page, 10);
  const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;

  // Restore failed IDs from session storage (survives session-expiry redirect)
  const [restoredFailedIds] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem(BULK_FAILED_KEY);
      if (saved) {
        sessionStorage.removeItem(BULK_FAILED_KEY);
        const ids = JSON.parse(saved) as string[];
        if (Array.isArray(ids) && ids.length > 0) return ids;
      }
    } catch { /* ignore */ }
    return [];
  });
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(
    () => new Set(restoredFailedIds)
  );

  // Notify user if failed IDs were restored from a previous session
  useEffect(() => {
    if (restoredFailedIds.length > 0) {
      toast.info(
        `${restoredFailedIds.length} previously failed match${restoredFailedIds.length > 1 ? "es" : ""} re-selected for retry.`,
        { duration: 8000 }
      );
    }
  }, [restoredFailedIds]);
  const [isSettling, setIsSettling] = useState(false);
  const [showSettleDialog, setShowSettleDialog] = useState(false);

  // Emergency-save failed IDs on session expiry so they survive re-auth
  useEffect(() => {
    const handler = () => {
      if (selectedMatches.size > 0) {
        sessionStorage.setItem(BULK_FAILED_KEY, JSON.stringify(Array.from(selectedMatches)));
      }
    };
    window.addEventListener("izenzo:session-expiry", handler);
    return () => window.removeEventListener("izenzo:session-expiry", handler);
  }, [selectedMatches]);

  // Debounce search to avoid firing a query on every keystroke
  const debouncedSearch = useDebounce(commoditySearch, 300);

  const [paginationError, setPaginationError] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["matches", statusFilter, debouncedSearch, sortBy, page],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("matches")
        .select(MATCH_LIST_COLUMNS, { count: "exact" })
        .order(sortBy, { ascending: false })
        .range(from, to);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (debouncedSearch) {
        query = query.ilike("commodity", `%${debouncedSearch}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      setPaginationError(false);
      return { matches: data as Match[], totalCount: count ?? 0 };
    },
  });

  // Fetch match IDs that have active disputes (for inline indicator)
  const { data: disputeMatchIds } = useQuery({
    queryKey: ["dispute-match-ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disputes")
        .select("match_id")
        .in("status", ["open", "escalated", "under_review"]);
      if (error) return new Set<string>();
      return new Set((data || []).map((d) => d.match_id));
    },
    staleTime: 30_000,
  });

  const activeDisputeIds = disputeMatchIds ?? new Set<string>();

  // Detect pagination fetch failure when stale placeholder data is still showing
  useEffect(() => {
    if (isError && isPlaceholderData) {
      setPaginationError(true);
      toast.error("Could not load the requested page. The data shown below is from a previous page.", { duration: 6000 });
    } else if (!isError) {
      setPaginationError(false);
    }
  }, [isError, isPlaceholderData]);

  const matches = data?.matches;
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Evidence chain status is now rendered per-match by EvidenceChainIndicator (hardened component)

  // Use ref to avoid stale closure in real-time subscription
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Real-time subscription — scoped to org via RLS (server filters by policy)
  useEffect(() => {
    const channel = supabase
      .channel('matches-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches'
        },
        (payload) => {
          refetchRef.current();
          if (payload.eventType === 'INSERT') {
            toast.success('New match created');
          }
          // Removed UPDATE toast — at 100x scale this creates toast storms
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusBadge = (status: string) => {
    return <MatchStatusBadge status={status} />;
  };

  const toggleMatchSelection = (matchId: string) => {
    setSelectedMatches((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(matchId)) {
        newSet.delete(matchId);
      } else {
        newSet.add(matchId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (!matches) return;
    const unsettledMatches = matches.filter(m => MatchState.canDo(m.status, "select_for_bulk"));
    if (selectedMatches.size === unsettledMatches.length && unsettledMatches.length > 0) {
      setSelectedMatches(new Set());
    } else {
      setSelectedMatches(new Set(unsettledMatches.map(m => m.id)));
    }
  };

  // Generate a stable batch key once when user initiates action.
  // This persists across the sequential loop so retrying the same batch
  // with the same match IDs produces the same per-match keys.
  const [bulkBatchKey, setBulkBatchKey] = useState<string | null>(null);

  const handleBulkSettle = async () => {
    if (isSettling) return; // double-click guard
    setIsSettling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be signed in");
        return;
      }

      // Filter: only attempt settle on matches still in 'matched' status
      const eligibleIds = Array.from(selectedMatches).filter(id => {
        const m = matches?.find(match => match.id === id);
        return m && MatchState.canDo(m.status, "select_for_bulk");
      });

      if (eligibleIds.length === 0) {
        toast.info("All selected matches have already been confirmed. No action needed.");
        setSelectedMatches(new Set());
        setShowSettleDialog(false);
        return;
      }

      // Stable batch key: generated once per user-initiated action.
      // If this is a retry of the same selection, reuse the existing key.
      const batchKey = bulkBatchKey ?? crypto.randomUUID();
      if (!bulkBatchKey) setBulkBatchKey(batchKey);

      let succeeded = 0;
      let failed = 0;
      const failedIds: string[] = [];
      const errors: string[] = [];

      // Sequential to avoid race conditions on balance
      for (const matchId of eligibleIds) {
        try {
          // Stable per-match key: same batch + same matchId = same key on retry
          const idempotencyKey = `bulk_settle_${batchKey}_${matchId}`;
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match/${matchId}/settle`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
          });

          if (res.ok) {
            // Check if this was an idempotent replay (already settled)
            const body = await res.json();
            const state = body?.state || body?.status;
            if (state === "intent_declared" || state === "settled") {
              // Could be genuinely new or idempotent — either way, success
              succeeded++;
            } else {
              succeeded++;
            }
          } else {
            failed++;
            failedIds.push(matchId);
            try {
              const body = await res.json();
              const msg = body?.error || body?.message || `HTTP ${res.status}`;
              if (!errors.includes(msg)) errors.push(msg);
            } catch {
              errors.push(`HTTP ${res.status}`);
            }
          }
        } catch {
          failed++;
          failedIds.push(matchId);
          errors.push("Network error");
        }
      }

      // Precise messaging
      if (succeeded > 0 && failed === 0) {
        toast.success(`Intent confirmed for ${succeeded} match${succeeded > 1 ? "es" : ""}. ${(succeeded * 500).toLocaleString()} credits deducted.`);
      } else if (succeeded > 0 && failed > 0) {
        toast.warning(
          `${succeeded} of ${eligibleIds.length} confirmed. ${failed} failed: ${errors[0] || "Unknown error"}. Failed matches remain selected for retry.`
        );
      } else {
        toast.error(`All ${failed} confirmations failed: ${errors[0] || "Unknown error"}`);
      }

      // Keep only failed IDs selected for retry (batch key persists for retry)
      if (failedIds.length > 0) {
        setSelectedMatches(new Set(failedIds));
      } else {
        setSelectedMatches(new Set());
        setBulkBatchKey(null); // Reset batch key on full success
      }
      refetch();
      // Only close dialog after processing is complete
      setShowSettleDialog(false);
    } catch (error: any) {
      console.error("Error confirming intent:", error);
      toast.error("Failed to confirm intent");
    } finally {
      setIsSettling(false);
    }
  };

  const exportToCSV = () => {
    if (!matches || matches.length === 0) {
      toast.error("No matches to export");
      return;
    }

    const headers = [
      "ID", "Commodity", "Buyer ID", "Buyer Name", "Seller ID", "Seller Name",
      "Quantity", "Unit", "Price", "Currency", "Status", "Created At", "Settled At", "Hash",
    ];

    const rows = matches.map(m => [
      m.id, m.commodity, m.buyer_id, m.buyer_name, m.seller_id, m.seller_name,
      m.quantity_amount, m.quantity_unit, m.price_amount, m.price_currency,
      m.status, m.created_at, m.settled_at || "", m.hash,
    ]);

    downloadCSV(headers, rows, `matches-${new Date().toISOString().split('T')[0]}.csv`);

    // Explicit scope disclosure
    if (totalPages > 1) {
      toast.success(
        `Exported ${matches.length} matches from the current page (page ${page + 1} of ${totalPages}). To export all ${totalCount} matches, navigate to each page and export separately.`,
        { duration: 6000 }
      );
    } else {
      toast.success(`Exported all ${matches.length} matches to CSV`);
    }
  };

  const unsettledMatches = matches?.filter(m => MatchState.canDo(m.status, "select_for_bulk")) || [];
  const allUnsettledSelected = unsettledMatches.length > 0 && selectedMatches.size === unsettledMatches.length;

  // Evidence rendering now delegated to EvidenceChainIndicator (handles timeout, auth, 402, parse errors)

  return (
    <>
      <Card>
        <CardHeader className="px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle>Matches</CardTitle>
            <div className="flex flex-wrap gap-2">
              {selectedMatches.size > 0 && (
                <Button
                  size="sm"
                  onClick={() => setShowSettleDialog(true)}
                  disabled={isSettling}
                >
                  {isSettling ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                  )}
                  Confirm ({selectedMatches.size})
                </Button>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={exportToCSV}>
                      <Download className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Export CSV {totalPages > 1 ? "(this page)" : ""}</span>
                    </Button>
                  </TooltipTrigger>
                  {totalPages > 1 && (
                    <TooltipContent>
                      <p>Exports the {PAGE_SIZE} matches currently shown (page {page + 1} of {totalPages})</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by commodity..."
              value={commoditySearch}
              onChange={(e) => setParam("q", e.target.value)}
              className="pl-10"
              aria-label="Search matches by commodity"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setParam("status", v)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value={MATCH_STATUS.MATCHED}>Matched</SelectItem>
              <SelectItem value={MATCH_STATUS.SETTLED}>Confirmed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setParam("sort", v)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Date Created</SelectItem>
              <SelectItem value="commodity">Commodity</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-[400px]">
        {isError && !paginationError ? (
          <ErrorState 
            type="server" 
            message={error?.message || "Failed to load matches"} 
            onRetry={() => refetch()} 
            variant="inline"
          />
        ) : isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : matches && matches.length > 0 ? (
          <>
            {paginationError && (
              <div className="flex items-center gap-3 p-3 mb-4 rounded-md border border-destructive/30 bg-destructive/5 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-foreground flex-1">
                  Could not load the requested page. The data below is from a previous page and may not reflect the current view.
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0 gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}
            {/* Mobile card view for <768px */}
            <div className="space-y-3 md:hidden">
              {matches.map((match) => (
                <Card key={match.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedMatches.has(match.id)}
                        onCheckedChange={() => toggleMatchSelection(match.id)}
                          disabled={!MatchState.canDo(match.status, "select_for_bulk")}
                       />
                      <span className="font-medium text-sm">{match.commodity}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {activeDisputeIds.has(match.id) && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <ShieldAlert className="h-4 w-4 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent>Active dispute on this match</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {getStatusBadge(match.status)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground text-xs">Buyer</span>
                      <p className="truncate">{revealGuard(match, "buyer_name")}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Seller</span>
                      <p className="truncate">{revealGuard(match, "seller_name")}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Quantity</span>
                      <p>{match.quantity_amount ?? "—"} {match.quantity_unit ?? ""}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Price</span>
                      <p>{match.price_currency} {match.price_amount?.toLocaleString() ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center gap-2">
                      <EvidenceChainIndicator matchId={match.id} compact />
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(match.created_at), "MMM dd")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 touch-target"
                      onClick={() => navigate(`${ROUTES.DASHBOARD_MATCHES}/${match.id}`)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {/* Desktop table view for ≥768px */}
            <div className="rounded-md border hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead className="w-12">
                       <Checkbox
                         checked={allUnsettledSelected}
                         onCheckedChange={toggleSelectAll}
                         disabled={unsettledMatches.length === 0}
                       />
                     </TableHead>
                     <TableHead>Commodity</TableHead>
                     <TableHead className="hidden lg:table-cell">Buyer</TableHead>
                     <TableHead className="hidden lg:table-cell">Seller</TableHead>
                     <TableHead>Quantity</TableHead>
                     <TableHead>Price</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead className="hidden xl:table-cell">Evidence</TableHead>
                     <TableHead className="hidden lg:table-cell">Created</TableHead>
                     <TableHead className="text-right">Actions</TableHead>
                   </TableRow>
                </TableHeader>
                <TableBody>
                  {matches.map((match) => (
                    <TableRow key={match.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`${ROUTES.DASHBOARD_MATCHES}/${match.id}`)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedMatches.has(match.id)}
                          onCheckedChange={() => toggleMatchSelection(match.id)}
                          disabled={!MatchState.canDo(match.status, "select_for_bulk")}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{match.commodity}</TableCell>
                      <TableCell className="hidden lg:table-cell">{revealGuard(match, "buyer_name")}</TableCell>
                      <TableCell className="hidden lg:table-cell">{revealGuard(match, "seller_name")}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {match.quantity_amount ?? "—"} {match.quantity_unit ?? ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {match.price_currency} {match.price_amount?.toLocaleString() ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {activeDisputeIds.has(match.id) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                                </TooltipTrigger>
                                <TooltipContent>Active dispute</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {getStatusBadge(match.status)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <EvidenceChainIndicator matchId={match.id} compact />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{format(new Date(match.created_at), "MMM dd, yyyy")}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const row = [
                                    match.id, match.commodity, match.buyer_id, match.buyer_name,
                                    match.seller_id, match.seller_name, match.quantity_amount,
                                    match.quantity_unit, match.price_amount, match.price_currency,
                                    match.status, match.created_at, match.settled_at || "", match.hash,
                                  ];
                                  const headers = [
                                    "ID", "Commodity", "Buyer ID", "Buyer Name", "Seller ID", "Seller Name",
                                    "Quantity", "Unit", "Price", "Currency", "Status", "Created At", "Settled At", "Hash",
                                  ];
                                  downloadCSV(headers, [row], `match-${match.id.slice(0, 8)}.csv`);
                                  toast.success("Match exported");
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download this match as CSV</TooltipContent>
                          </Tooltip>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`${ROUTES.DASHBOARD_MATCHES}/${match.id}`)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className={`flex items-center justify-between mt-4 pt-3 border-t border-border transition-opacity ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                {isFetching && !isLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                <p className="text-sm text-muted-foreground">
                  {totalPages > 1
                    ? `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount} matches`
                    : `${totalCount} match${totalCount !== 1 ? 'es' : ''} total`}
                </p>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setParam("page", String(page - 1))}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm font-medium text-foreground px-2">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setParam("page", String(page + 1))}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : statusFilter !== "all" || debouncedSearch ? (
          <EmptyState
            title="No matches found"
            message="Try adjusting your search or filters."
            icon={<Search className="h-10 w-10" />}
            action={{ label: "Clear filters", onClick: () => { setParam("status", "all"); setParam("q", ""); } }}
          />
        ) : (
          <div className="text-center py-16 px-4">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <FileText className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-semibold text-lg text-foreground mb-2">No matches yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6 leading-relaxed">
              Matches appear here when you create one from search results. Search for a counterparty, select them, and click "Create Match" to begin.
            </p>
            <Button onClick={() => navigate(ROUTES.DASHBOARD_SEARCH)} className="gap-2">
              <Search className="h-4 w-4" />
              Search counterparties
            </Button>
          </div>
        )}
        </div>
        </CardContent>
      </Card>

      <BulkConfirmDialog
        open={showSettleDialog}
        onOpenChange={setShowSettleDialog}
        matchCount={selectedMatches.size}
        isSettling={isSettling}
        onConfirm={handleBulkSettle}
      />
    </>
  );
}
