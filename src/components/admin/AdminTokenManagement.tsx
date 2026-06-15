import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Coins, Plus, RefreshCw, Search, AlertCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { invalidateAllCreditBalanceQueries } from "@/lib/credit-balance-invalidation";

interface Organisation {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface TokenBalance {
  id: string;
  org_id: string;
  balance: number;
  minimum_required: number;
  updated_at: string;
  organisation?: Organisation;
}

export function AdminTokenManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<TokenBalance | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data: balances = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-token-balances"],
    queryFn: async () => {
      const [orgsRes, tokensRes] = await Promise.all([
        supabase.from("organizations").select("id, name, status, created_at"),
        supabase.from("token_balances").select("*"),
      ]);
      
      if (orgsRes.error) throw orgsRes.error;
      if (tokensRes.error) throw tokensRes.error;

      return (tokensRes.data || []).map((balance) => ({
        ...balance,
        organisation: orgsRes.data?.find((org) => org.id === balance.org_id),
      })) as TokenBalance[];
    },
  });

  /**
   * Admin manual top-up.
   *
   * As of Stage C (2026-05-01), atomic_token_credit is service-role-only.
   * The admin top-up flow now goes through the admin-credit-org edge function,
   * which:
   *   1. Verifies the caller is platform_admin (server-side, via has_role).
   *   2. Caps credits at 10,000 per call.
   *   3. Calls atomic_token_credit under service-role.
   *   4. Writes admin_audit_logs for every attempt (success and failure).
   *
   * The client therefore no longer writes to token_ledger or admin_audit_logs
   * directly - the edge function and atomic_token_credit own those writes.
   */
  const handleTopUp = async () => {
    if (!selectedOrg || !topUpAmount) return;

    const amount = parseInt(topUpAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid positive amount");
      return;
    }
    if (amount > 10_000) {
      toast.error("Per-call cap is 10,000 credits. Split into multiple top-ups.");
      return;
    }

    try {
      setSubmitting(true);

      const { data, error } = await supabase.functions.invoke("admin-credit-org", {
        body: {
          org_id: selectedOrg.org_id,
          credits: amount,
          reason: "admin_top_up",
          reference_id: `admin-topup-${Date.now()}`,
        },
      });

      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        throw new Error(result?.error || "Credit operation failed");
      }

      toast.success(
        `Added ${amount.toLocaleString()} credits to ${selectedOrg.organisation?.name || 'organisation'}`,
      );
      setIsDialogOpen(false);
      setTopUpAmount("");
      setSelectedOrg(null);
      // Invalidate to get fresh server-side balance
      invalidateAllCreditBalanceQueries(queryClient);
    } catch (error) {
      console.error("[AdminTokenManagement] top-up failed:", error);
      const message =
        error instanceof Error ? error.message : "Failed to add credits";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredBalances = balances.filter((balance) => {
    const orgName = balance.organisation?.name?.toLowerCase() || "";
    const query = searchQuery.toLowerCase();
    return orgName.includes(query) || balance.org_id.includes(query);
  });

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState title="Failed to load credit balances" onRetry={() => refetch()} type="server" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Credit Management</h2>
        <p className="text-muted-foreground mt-2">
          Manage organisation credit balances and top-ups
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Organisation Balances
              </CardTitle>
              <CardDescription>
                View and manage credit balances for all organisations
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search organisations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : filteredBalances.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No organisations found
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Minimum Required</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBalances.map((balance) => {
                    const isBelowMinimum = balance.balance < balance.minimum_required;
                    return (
                      <TableRow key={balance.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {balance.organisation?.name || "Unknown"}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {balance.org_id.slice(0, 8)}...
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isBelowMinimum && (
                              <AlertCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span className={isBelowMinimum ? "text-destructive font-medium" : ""}>
                              {balance.balance.toLocaleString()}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {balance.minimum_required.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={isBelowMinimum ? "destructive" : "default"}
                          >
                            {isBelowMinimum ? "Below Minimum" : "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(balance.updated_at), "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Dialog open={isDialogOpen && selectedOrg?.id === balance.id} onOpenChange={(open) => {
                            setIsDialogOpen(open);
                            if (!open) {
                              setSelectedOrg(null);
                              setTopUpAmount("");
                            }
                          }}>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedOrg(balance);
                                  setIsDialogOpen(true);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Top Up
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Add credits</DialogTitle>
                                <DialogDescription>
                                  Issue credits to {balance.organisation?.name || "this organisation"}. Each credit is worth $1.00 USD and is recorded in the audit trail.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label>Current balance</Label>
                                  <div className="text-2xl font-bold">
                                    {balance.balance.toLocaleString()} credits
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="amount">Credits to add</Label>
                                  <Input
                                    id="amount"
                                    type="number"
                                    placeholder="Enter amount (max 10,000)"
                                    value={topUpAmount}
                                    onChange={(e) => setTopUpAmount(e.target.value)}
                                    min="1"
                                    max="10000"
                                  />
                                </div>
                                {topUpAmount && parseInt(topUpAmount) > 0 && (
                                  <div className="p-3 bg-muted rounded-md">
                                    <div className="text-sm text-muted-foreground">
                                      New balance will be:
                                    </div>
                                    <div className="text-xl font-bold text-primary">
                                      {(balance.balance + parseInt(topUpAmount || "0")).toLocaleString()} credits
                                    </div>
                                  </div>
                                )}
                              </div>
                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => setIsDialogOpen(false)}
                                  disabled={submitting}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  onClick={handleTopUp}
                                  disabled={submitting || !topUpAmount || parseInt(topUpAmount) <= 0}
                                >
                                  {submitting ? (
                                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding…</>
                                  ) : "Add credits"}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
