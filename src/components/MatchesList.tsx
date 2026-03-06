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
import { Loader2, Search, Eye, Download, CheckCircle2, Info } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { EvidenceChainIndicator } from "@/components/EvidenceChainIndicator";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { downloadCSV } from "@/lib/download-utils";
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

export function MatchesList() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [commoditySearch, setCommoditySearch] = useState("");
  const [sortBy, setSortBy] = useState<"created_at" | "commodity">("created_at");
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [isSettling, setIsSettling] = useState(false);
  const [showSettleDialog, setShowSettleDialog] = useState(false);

  const { data: matches, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["matches", statusFilter, commoditySearch, sortBy],
    queryFn: async () => {
      let query = supabase
        .from("matches")
        .select("*")
        .order(sortBy, { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (commoditySearch) {
        query = query.ilike("commodity", `%${commoditySearch}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Match[];
    },
  });

  // Use ref to avoid stale closure in real-time subscription
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Real-time subscription
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
          console.log('Match change detected:', payload);
          refetchRef.current();
          if (payload.eventType === 'INSERT') {
            toast.success('New match created');
          } else if (payload.eventType === 'UPDATE') {
            toast.info('Match updated');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusBadge = (status: string) => {
    return status === "settled" ? (
      <Badge variant="default">Confirmed</Badge>
    ) : (
      <Badge variant="secondary">Matched</Badge>
    );
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
    const unsettledMatches = matches.filter(m => m.status === "matched");
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

  const unsettledMatches = matches?.filter(m => m.status === "matched") || [];
  const allUnsettledSelected = unsettledMatches.length > 0 && selectedMatches.size === unsettledMatches.length;

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
              <SelectItem value="matched">Matched</SelectItem>
              <SelectItem value="settled">Confirmed</SelectItem>
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
                        disabled={match.status === "settled"}
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
                      <EvidenceChainIndicator matchId={match.id} compact />
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(match.created_at), "MMM dd")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 touch-target"
                      onClick={() => navigate(`/dashboard/matches/${match.id}`)}
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
                    <TableRow key={match.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedMatches.has(match.id)}
                          onCheckedChange={() => toggleMatchSelection(match.id)}
                          disabled={match.status === "settled"}
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
                        <EvidenceChainIndicator matchId={match.id} compact />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{format(new Date(match.created_at), "MMM dd, yyyy")}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/dashboard/matches/${match.id}`)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No matches found. Try adjusting your filters.
          </div>
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
