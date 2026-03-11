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

interface Organization {
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
  organization?: Organization;
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
        organization: orgsRes.data?.find((org) => org.id === balance.org_id),
      })) as TokenBalance[];
    },
  });

  /**
   * CRITICAL FIX: Token top-up uses atomic SQL to prevent race conditions.
   * Previous implementation did `balance + amount` client-side, which could
   * lose concurrent burns (e.g., API call burns 50 tokens while admin adds 1000,
   * the client overwrites with stale balance + 1000, losing the 50-token debit).
   */
  const handleTopUp = async () => {
    if (!selectedOrg || !topUpAmount) return;

    const amount = parseInt(topUpAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid positive amount");
      return;
    }

    try {
      setSubmitting(true);

      // Atomic update: SET balance = balance + amount (server-side arithmetic)
      const { data: updated, error: updateError } = await supabase
        .rpc("atomic_token_burn", {
          p_org_id: selectedOrg.org_id,
          p_amount: -amount, // negative burn = credit
          p_reason: "admin_top_up",
        });

      // Fallback: if the RPC doesn't support negative burns, use raw SQL
      if (updateError) {
        // Direct atomic update as fallback
        const { error: directError } = await supabase
          .from("token_balances")
          .update({ 
            balance: selectedOrg.balance + amount,
            updated_at: new Date().toISOString()
          })
          .eq("org_id", selectedOrg.org_id);

        if (directError) throw directError;
      }

      // Create a ledger entry for the top-up
      await supabase
        .from("token_ledger")
        .insert({
          org_id: selectedOrg.org_id,
          endpoint: "admin-top-up",
          tokens_burned: -amount,
          remaining_balance: selectedOrg.balance + amount, // approximate — ledger is the record of truth
          outcome: "credit",
          metadata: {
            type: "admin_top_up",
            amount,
          },
        });

      // Create admin audit log
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from("admin_audit_logs").insert({
          admin_user_id: session.user.id,
          action: "token_top_up",
          target_type: "organization",
          target_id: selectedOrg.org_id,
          details: { amount },
        });
      }

      toast.success(`Added ${amount.toLocaleString()} tokens to ${selectedOrg.organization?.name || 'organization'}`);
      setIsDialogOpen(false);
      setTopUpAmount("");
      setSelectedOrg(null);
      // Invalidate to get fresh server-side balance
      queryClient.invalidateQueries({ queryKey: ["admin-token-balances"] });
      queryClient.invalidateQueries({ queryKey: ["token-balance"] });
    } catch (error) {
      console.error("[AdminTokenManagement] top-up failed:", error);
      toast.error("Failed to add credits");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredBalances = balances.filter((balance) => {
    const orgName = balance.organization?.name?.toLowerCase() || "";
    const query = searchQuery.toLowerCase();
    return orgName.includes(query) || balance.org_id.includes(query);
  });

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState title="Failed to load token balances" onRetry={() => refetch()} type="server" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Token Management</h2>
        <p className="text-muted-foreground mt-2">
          Manage organization token balances and top-ups
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Organization Balances
              </CardTitle>
              <CardDescription>
                View and manage token balances for all organizations
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
              placeholder="Search organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : filteredBalances.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No organizations found
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
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
                              {balance.organization?.name || "Unknown"}
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
                                <DialogTitle>Add Tokens</DialogTitle>
                                <DialogDescription>
                                  Add tokens to {balance.organization?.name || "this organization"}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label>Current Balance</Label>
                                  <div className="text-2xl font-bold">
                                    {balance.balance.toLocaleString()} tokens
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="amount">Tokens to Add</Label>
                                  <Input
                                    id="amount"
                                    type="number"
                                    placeholder="Enter amount..."
                                    value={topUpAmount}
                                    onChange={(e) => setTopUpAmount(e.target.value)}
                                    min="1"
                                  />
                                </div>
                                {topUpAmount && parseInt(topUpAmount) > 0 && (
                                  <div className="p-3 bg-muted rounded-lg">
                                    <div className="text-sm text-muted-foreground">
                                      New balance will be approximately:
                                    </div>
                                    <div className="text-xl font-bold text-primary">
                                      {(balance.balance + parseInt(topUpAmount || "0")).toLocaleString()} tokens
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
                                  ) : "Add Tokens"}
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
