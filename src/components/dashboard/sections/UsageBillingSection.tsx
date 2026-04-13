import { useState, useEffect } from "react";
import { useUserOrg } from "@/hooks/use-user-org";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Coins, TrendingUp, AlertTriangle, Clock, Filter, Download, RefreshCw } from "lucide-react";
import { format, subDays } from "date-fns";
import { toast } from "sonner";

interface CreditBalance {
  balance: number;
  minimum_required: number;
}

interface CreditLedgerEntry {
  id: string;
  endpoint: string;
  tokens_burned: number;
  outcome: string;
  remaining_balance: number;
  request_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface UsageStats {
  currentBalance: number;
  minimumRequired: number;
  callsThisMonth: number;
  blockedCallsThisMonth: number;
  totalBurnedThisMonth: number;
}

export function UsageBillingSection() {
  const orgId = useUserOrg();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<CreditLedgerEntry[]>([]);
  const [allEndpoints, setAllEndpoints] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [stats, setStats] = useState<UsageStats | null>(null);
  
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("30");

  const fetchBalance = async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance, minimum_required")
        .eq("org_id", orgId)
        .maybeSingle();

      if (error) throw error;
      setBalance(data);
    } catch (error) {
      console.error("Error fetching credit balance:", error);
      toast.error("Failed to fetch credit balance");
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async () => {
    setLedgerLoading(true);
    try {
      const startDate = subDays(new Date(), parseInt(dateRange));
      
      let query = supabase
        .from("token_ledger")
        .select("*")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false })
        .limit(100);

      if (endpointFilter !== "all") {
        query = query.eq("endpoint", endpointFilter);
      }

      if (outcomeFilter !== "all") {
        query = query.eq("outcome", outcomeFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      const mappedData: CreditLedgerEntry[] = (data || []).map((entry) => ({
        id: entry.id,
        endpoint: entry.endpoint,
        tokens_burned: entry.tokens_burned,
        outcome: entry.outcome,
        remaining_balance: entry.remaining_balance,
        request_id: entry.request_id,
        created_at: entry.created_at,
        metadata: entry.metadata as Record<string, unknown> | null,
      }));
      
      setLedgerEntries(mappedData);
      
      // Populate allEndpoints from unfiltered fetches so the dropdown always shows every option
      if (endpointFilter === "all") {
        setAllEndpoints([...new Set(mappedData.map((e) => e.endpoint))]);
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthlyEntries = (data || []).filter(
        (e) => new Date(e.created_at) >= monthStart
      );
      
      const totalBurned = monthlyEntries.reduce((sum, e) => sum + (e.tokens_burned || 0), 0);
      const allowedCalls = monthlyEntries.filter((e) => e.outcome === "allowed").length;
      const blockedCalls = monthlyEntries.filter((e) => e.outcome === "blocked").length;

      setStats({
        currentBalance: balance?.balance || 0,
        minimumRequired: balance?.minimum_required || 5000,
        callsThisMonth: allowedCalls,
        blockedCallsThisMonth: blockedCalls,
        totalBurnedThisMonth: totalBurned,
      });
    } catch (error) {
      console.error("Error fetching credit ledger:", error);
      toast.error("Failed to fetch usage data");
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, [orgId]);

  useEffect(() => {
    if (balance !== null) {
      fetchLedger();
    }
  }, [balance, endpointFilter, outcomeFilter, dateRange]);

  // Use allEndpoints (populated on initial unfiltered fetch) so the dropdown always shows all options
  const uniqueEndpoints = allEndpoints;

  const balancePercentage = balance 
    ? Math.min(100, (balance.balance / (balance.minimum_required * 2)) * 100)
    : 0;

  const isLowBalance = balance && balance.balance < balance.minimum_required * 1.5;
  const isCriticalBalance = balance && balance.balance < balance.minimum_required;

  const handleRefresh = () => {
    setLoading(true);
    fetchBalance();
  };

  const handleExportCSV = () => {
    const headers = ["Date", "Endpoint", "Credits Burned", "Outcome", "Remaining Balance", "Request ID"];
    const escapeCell = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };
    const rows = ledgerEntries.map((e) => [
      escapeCell(format(new Date(e.created_at), "yyyy-MM-dd HH:mm:ss")),
      escapeCell(e.endpoint),
      e.tokens_burned.toString(),
      escapeCell(e.outcome),
      e.remaining_balance.toString(),
      escapeCell(e.request_id || ""),
    ]);
    
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credit-usage-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <header className="space-y-1">
          <h1 className="font-bold tracking-tight">Usage & Billing</h1>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
            Your credit usage and transaction history
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-bold tracking-tight">Usage & Billing</h1>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
            Your credit usage and transaction history. <a href="/billing" className="text-primary hover:underline">Purchase credits →</a>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </header>

      {isCriticalBalance && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">Critical: Credit Balance Below Minimum</p>
                <p className="text-sm text-muted-foreground">
                  Your balance ({balance?.balance.toLocaleString()}) is below the required minimum ({balance?.minimum_required.toLocaleString()}).
                  API calls will be blocked.{" "}
                  <a href="/billing" className="text-primary underline hover:no-underline">
                    Purchase credits to continue
                  </a>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Balance</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{balance?.balance.toLocaleString() || 0}</div>
            <div className="mt-2">
              <Progress 
                value={balancePercentage} 
                className={isCriticalBalance ? "bg-destructive/20" : isLowBalance ? "bg-yellow-500/20" : ""} 
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Min required: {balance?.minimum_required.toLocaleString() || 5000}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Calls This Month</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.callsThisMonth.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Credits burned: {stats?.totalBurnedThisMonth.toLocaleString() || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Minimum Required</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{balance?.minimum_required.toLocaleString() || 5000}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Monthly minimum balance
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Blocked Calls</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {stats?.blockedCallsThisMonth || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Calls blocked this month
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Credit Ledger</CardTitle>
              <CardDescription>Complete history of credit usage</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Filters:</span>
            </div>
            
            <Select value={endpointFilter} onValueChange={setEndpointFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All endpoints" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All endpoints</SelectItem>
                {uniqueEndpoints.map((ep) => (
                  <SelectItem key={ep} value={ep}>{ep}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All outcomes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="allowed">Allowed</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-h-[320px]">
          {ledgerLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No credit usage recorded yet
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-center">Credits</TableHead>
                    <TableHead className="text-center">Outcome</TableHead>
                    <TableHead className="text-right">Remaining Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm">
                        {format(new Date(entry.created_at), "MMM dd, HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                          {entry.endpoint}
                        </code>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={entry.tokens_burned > 0 ? "text-destructive" : ""}>
                          -{entry.tokens_burned}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={entry.outcome === "allowed" ? "default" : "destructive"}>
                          {entry.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.remaining_balance.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
