import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Eye, Download, RefreshCw } from "lucide-react";
import { TruncationBanner } from "@/components/ui/truncation-banner";
import { EmptyState } from "@/components/ui/error-state";
import * as MatchState from "@/lib/match-state";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { format } from "date-fns";
import { toast } from "sonner";
import { EvidenceChainIndicator } from "@/components/EvidenceChainIndicator";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { downloadCSV, timestampedFilename } from "@/lib/download-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AdminMatchesPanel() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  const ADMIN_MATCH_LIMIT = 100;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-matches", statusFilter, typeFilter, search],
    queryFn: async () => {
      let query = supabase
        .from("matches")
        .select("*, organizations(name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(ADMIN_MATCH_LIMIT);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (typeFilter !== "all") {
        query = query.eq("match_type", typeFilter);
      }

      if (search) {
        query = query.or(`commodity.ilike.%${search}%,buyer_name.ilike.%${search}%,seller_name.ilike.%${search}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { matches: data, totalCount: count ?? data?.length ?? 0 };
    },
  });

  const matches = data?.matches;
  const totalCount = data?.totalCount ?? 0;
  const isTruncated = totalCount > ADMIN_MATCH_LIMIT;

  const exportMatches = () => {
    if (!matches || matches.length === 0) {
      toast.error("No matches to export");
      return;
    }

    const headers = [
      "ID", "Org", "Commodity", "Buyer", "Seller", "Quantity", "Unit",
      "Price", "Currency", "Status", "Hash", "Created At", "Settled At"
    ];

    const rows = matches.map(m => [
      m.id,
      (m as any).organisations?.name || m.org_id,
      m.commodity,
      m.buyer_name,
      m.seller_name,
      m.quantity_amount,
      m.quantity_unit,
      m.price_amount,
      m.price_currency,
      m.status,
      m.hash,
      m.created_at,
      m.settled_at || "",
    ]);

    downloadCSV(headers, rows, timestampedFilename("admin-matches", "csv"));
    toast.success("Matches exported successfully");
  };

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState title="Failed to load matches" onRetry={() => refetch()} type="server" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Matches Management</h2>
          <p className="text-muted-foreground mt-2">
            View and manage all matches across organisations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportMatches}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Matches</CardTitle>
          <CardDescription>
            Matches from all organisations. Only "Send Trade Request" creates audit/evidence records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by commodity, buyer, or seller..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                aria-label="Search matches"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="settled">Confirmed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="unilateral">Unilateral</SelectItem>
                <SelectItem value="bilateral">Bilateral</SelectItem>
                <SelectItem value="search">Search</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TruncationBanner data={matches} totalCount={totalCount} limit={ADMIN_MATCH_LIMIT} />

          {isLoading ? (
            <TableSkeleton rows={5} columns={9} />
          ) : matches && matches.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Org</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Commodity</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matches.map((match) => {
                    const matchType = (match as any).match_type || "search";
                    const ageDays = Math.floor((Date.now() - new Date(match.created_at).getTime()) / (24 * 60 * 60 * 1000));
                    const isStale = matchType === "unilateral" && ageDays >= 7 && (match.buyer_id == null || match.seller_id == null);
                    return (
                    <TableRow key={match.id} className={`tr-mechanical ${isStale ? "bg-amber-500/5" : ""}`}>
                      <TableCell className="font-mono text-xs">
                        {((match as any).organisations?.name || match.org_id).substring(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={matchType === "unilateral" ? "warning" : matchType === "bilateral" ? "info" : "default"}
                          label={matchType}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{match.commodity}</TableCell>
                      <TableCell>{match.buyer_name || <span className="text-muted-foreground italic">open</span>}</TableCell>
                      <TableCell>{match.seller_name || <span className="text-muted-foreground italic">open</span>}</TableCell>
                      <TableCell>
                        {match.price_currency ?? ""} {match.price_amount?.toLocaleString() ?? "-"}
                      </TableCell>
                      <TableCell>
                        <MatchStatusBadge status={match.status} />
                      </TableCell>
                      <TableCell>
                        <span className={isStale ? "text-amber-600 font-medium" : "text-muted-foreground"}>
                          {ageDays}d
                        </span>
                      </TableCell>
                      <TableCell>
                        <EvidenceChainIndicator matchId={match.id} compact />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedMatch(match);
                            setShowDetailsDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}

                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No matches found" message="Matches will appear here once trade activity occurs." />
          )}
        </CardContent>
      </Card>

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Match Details</DialogTitle>
            <DialogDescription>
              Complete match information with cryptographic proof
            </DialogDescription>
          </DialogHeader>
          {selectedMatch && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Match ID</label>
                  <p className="font-mono text-sm">{selectedMatch.id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <div className="mt-1">
                    <MatchStatusBadge status={selectedMatch.status} />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Commodity</label>
                  <p className="font-medium">{selectedMatch.commodity}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Value</label>
                  <p>{selectedMatch.price_currency ?? ""} {selectedMatch.price_amount?.toLocaleString() ?? "-"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Buyer</label>
                  <p>{selectedMatch.buyer_name} ({selectedMatch.buyer_id})</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Seller</label>
                  <p>{selectedMatch.seller_name} ({selectedMatch.seller_id})</p>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-muted-foreground">Cryptographic Hash</label>
                <p className="font-mono text-xs bg-muted p-2 rounded break-all">{selectedMatch.hash}</p>
              </div>

              {selectedMatch.terms && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Terms</label>
                  <p className="text-sm">{selectedMatch.terms}</p>
                </div>
              )}

              <div className="pt-4 border-t">
                <label className="text-sm font-medium text-muted-foreground">Evidence Chain</label>
                <div className="mt-2">
                  <EvidenceChainIndicator matchId={selectedMatch.id} />
                </div>
              </div>

              {selectedMatch.settled_at && (
                <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <strong>Intent confirmed</strong> at {format(new Date(selectedMatch.settled_at), "PPpp")}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    This signals serious interest - no contract, payment, or legal obligation.
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
