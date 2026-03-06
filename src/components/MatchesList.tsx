import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, Eye, Download, CheckCircle2, Info, ChevronLeft, ChevronRight, Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { EmptyState } from "@/components/ui/error-state";
import { MATCH_STATUS, ROUTES } from "@/lib/constants";
import * as MatchState from "@/lib/match-state";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { downloadCSV } from "@/lib/download-utils";
import { useDebounce } from "@/hooks/use-debounce";
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
const MATCH_LIST_COLUMNS = "id, commodity, buyer_id, buyer_name, seller_id, seller_name, quantity_amount, quantity_unit, price_amount, price_currency, status, created_at, settled_at, hash, org_id" as const;

export function MatchesList() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [commoditySearch, setCommoditySearch] = useState("");
  const [sortBy, setSortBy] = useState<"created_at" | "commodity">("created_at");
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [isSettling, setIsSettling] = useState(false);
  const [showSettleDialog, setShowSettleDialog] = useState(false);
  const [page, setPage] = useState(0);

  // Debounce search to avoid firing a query on every keystroke
  const debouncedSearch = useDebounce(commoditySearch, 300);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [statusFilter, debouncedSearch, sortBy]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["matches", statusFilter, debouncedSearch, sortBy, page],
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
      return { matches: data as Match[], totalCount: count ?? 0 };
    },
  });

  const matches = data?.matches;
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Batch-fetch evidence chain status for current page's matches (fixes N+1)
  const matchIds = useMemo(() => matches?.map(m => m.id) ?? [], [matches]);
  const { data: evidenceMap } = useQuery({
    queryKey: ["evidence-chain-batch", matchIds],
    queryFn: async () => {
      if (matchIds.length === 0) return {};
      const { data: events, error } = await supabase
        .from("match_events")
        .select("id, match_id, event_type, payload_hash, previous_event_hash")
        .in("match_id", matchIds)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Group by match_id and compute chain status
      const grouped = new Map<string, typeof events>();
      for (const evt of events ?? []) {
        if (!grouped.has(evt.match_id)) grouped.set(evt.match_id, []);
        grouped.get(evt.match_id)!.push(evt);
      }

      const result: Record<string, { eventCount: number; chainValid: boolean; hasIntentConfirmed: boolean }> = {};
      for (const [mid, evts] of grouped) {
        let valid = true;
        let hasIntent = false;
        for (let i = 0; i < evts.length; i++) {
          const expected = i === 0 ? null : evts[i - 1].payload_hash;
          if (evts[i].previous_event_hash !== expected) valid = false;
          if (evts[i].event_type === "intent.confirmed" || evts[i].event_type === "match.settled") hasIntent = true;
        }
        result[mid] = { eventCount: evts.length, chainValid: valid, hasIntentConfirmed: hasIntent };
      }
      return result;
    },
    enabled: matchIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

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

  const handleBulkSettle = async () => {
    setIsSettling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in");
        return;
      }

      const settlePromises = Array.from(selectedMatches).map((matchId) =>
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match/${matchId}/settle`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        })
      );

      const results = await Promise.allSettled(settlePromises);
      const succeeded = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;

      if (succeeded > 0) {
        toast.success(`Intent confirmed for ${succeeded} match${succeeded > 1 ? 'es' : ''}`);
      }
      if (failed > 0) {
        toast.error(`Failed to confirm intent for ${failed} match${failed > 1 ? 'es' : ''}`);
      }

      setSelectedMatches(new Set());
      setShowSettleDialog(false);
      refetch();
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
    toast.success("CSV exported successfully");
  };

  const unsettledMatches = matches?.filter(m => MatchState.canDo(m.status, "select_for_bulk")) || [];
  const allUnsettledSelected = unsettledMatches.length > 0 && selectedMatches.size === unsettledMatches.length;

  // Inline evidence indicator using batch data (avoids N+1)
  const renderEvidence = (matchId: string) => {
    const status = evidenceMap?.[matchId];
    if (!status || status.eventCount === 0) {
      return <Shield className="h-4 w-4 text-muted-foreground" />;
    }
    const Icon = status.chainValid ? ShieldCheck : ShieldAlert;
    const colorClass = status.chainValid ? "text-green-600" : "text-destructive";
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Icon className={`h-4 w-4 ${colorClass}`} />
          </TooltipTrigger>
          <TooltipContent>
            <p>{status.eventCount} event{status.eventCount !== 1 ? 's' : ''} — {status.chainValid ? 'Chain verified' : 'Chain compromised'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Matches</CardTitle>
            <div className="flex gap-2">
              {selectedMatches.size > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setShowSettleDialog(true)}
                    disabled={isSettling}
                  >
                    {isSettling ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Confirm intent for {selectedMatches.size} match{selectedMatches.size > 1 ? 'es' : ''}
                  </Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Signals your interest so the seller can prepare final terms. This does not create any contract, payment, or legal obligation.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
              <Button variant="outline" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by commodity..."
              value={commoditySearch}
              onChange={(e) => setCommoditySearch(e.target.value)}
              className="pl-10"
              aria-label="Search matches by commodity"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value={MATCH_STATUS.MATCHED}>Matched</SelectItem>
              <SelectItem value={MATCH_STATUS.SETTLED}>Confirmed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Date Created</SelectItem>
              <SelectItem value="commodity">Commodity</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isError ? (
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
                    {getStatusBadge(match.status)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground text-xs">Buyer</span>
                      <p className="truncate">{match.buyer_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Seller</span>
                      <p className="truncate">{match.seller_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Quantity</span>
                      <p>{match.quantity_amount} {match.quantity_unit}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Price</span>
                      <p>{match.price_currency} {match.price_amount.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center gap-2">
                      {renderEvidence(match.id)}
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
                      <TableCell className="hidden lg:table-cell">{match.buyer_name}</TableCell>
                      <TableCell className="hidden lg:table-cell">{match.seller_name}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {match.quantity_amount} {match.quantity_unit}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {match.price_currency} {match.price_amount.toLocaleString()}
                      </TableCell>
                      <TableCell>{getStatusBadge(match.status)}</TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {renderEvidence(match.id)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{format(new Date(match.created_at), "MMM dd, yyyy")}</TableCell>
                      <TableCell className="text-right">
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
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <p className="text-sm text-muted-foreground">
                {totalPages > 1
                  ? `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount} matches`
                  : `${totalCount} match${totalCount !== 1 ? 'es' : ''} total`}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
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
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <EmptyState title="No matches found" message="Try adjusting your filters." />
        )}
        </CardContent>
      </Card>

      <AlertDialog open={showSettleDialog} onOpenChange={setShowSettleDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm intent for multiple matches</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm intent for {selectedMatches.size} match{selectedMatches.size > 1 ? 'es' : ''}?
              <span className="block mt-3 text-foreground font-medium">
                This does not create a contract, payment, or legal obligation. It only records interest so the seller can prepare final terms.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSettling}>Maybe later</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkSettle} disabled={isSettling}>
              {isSettling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Confirming...
                </>
              ) : (
                'Confirm intent'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
