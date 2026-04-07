import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Loader2, Activity, ShieldCheck, AlertTriangle, TrendingUp } from "lucide-react";

interface OrgKycRow {
  org_id: string;
  org_name: string;
  kyc_status: string;
  kyc_completeness: number;
  behavioral_score: number;
  behavioral_band: string;
  total_signals: number;
  views: number;
  flag: "action_needed" | "ready" | "inactive" | "normal";
}

export function AdminBehavioralKycLink() {
  const [bandFilter, setBandFilter] = useState("all");

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ["admin-behavioral-kyc-link", bandFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compute_all_behavioral_kyc_scores", {
        p_days: 30,
      });
      if (error) throw error;

      const results: OrgKycRow[] = ((data as any[]) || [])
        .filter((row: any) => bandFilter === "all" || row.behavioral_band === bandFilter)
        .map((row: any) => {
          const bBand = row.behavioral_band;
          const kycPct = row.kyc_completeness ?? 0;

          let flag: OrgKycRow["flag"] = "normal";
          if (bBand === "high" && kycPct < 100) flag = "action_needed";
          else if (bBand === "high" && kycPct >= 100) flag = "ready";
          else if (bBand === "none") flag = "inactive";

          return {
            org_id: row.org_id,
            org_name: row.org_name || row.org_id?.slice(0, 8),
            kyc_status: row.kyc_status ?? "not_started",
            kyc_completeness: kycPct,
            behavioral_score: row.behavioral_score ?? 0,
            behavioral_band: bBand,
            total_signals: row.total_signals ?? 0,
            views: row.views ?? 0,
            flag,
          };
        });

      // Sort: action_needed first, then by score desc
      results.sort((a, b) => {
        const flagOrder = { action_needed: 0, ready: 1, normal: 2, inactive: 3 };
        const diff = flagOrder[a.flag] - flagOrder[b.flag];
        if (diff !== 0) return diff;
        return b.behavioral_score - a.behavioral_score;
      });

      return results;
    },
  });

  const bandBadge = (band: string) => {
    switch (band) {
      case "high": return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400">High</Badge>;
      case "medium": return <Badge className="bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-400">Medium</Badge>;
      case "low": return <Badge className="bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400">Low</Badge>;
      default: return <Badge variant="secondary">None</Badge>;
    }
  };

  const flagBadge = (flag: OrgKycRow["flag"]) => {
    switch (flag) {
      case "action_needed":
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />KYC Needed</Badge>;
      case "ready":
        return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400 gap-1"><ShieldCheck className="h-3 w-3" />Ready</Badge>;
      case "inactive":
        return <Badge variant="secondary">Inactive</Badge>;
      default:
        return null;
    }
  };

  const actionCount = rows?.filter((r) => r.flag === "action_needed").length ?? 0;
  const readyCount = rows?.filter((r) => r.flag === "ready").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Behavioural Score → KYC Link</h2>
          <p className="text-muted-foreground mt-2">
            Orgs with high engagement but incomplete KYC are flagged for follow-up.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={bandFilter} onValueChange={setBandFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Filter" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Bands</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-destructive/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Action Needed</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{actionCount}</div>
            <p className="text-xs text-muted-foreground">High engagement, incomplete KYC</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fully Ready</CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{readyCount}</div>
            <p className="text-xs text-muted-foreground">High engagement + complete KYC</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orgs</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">Across all bands</p>
          </CardContent>
        </Card>
      </div>

      {/* Combined Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Organisation Engagement vs KYC</CardTitle>
          <CardDescription>Behavioural engagement score (30-day window) linked to KYC completeness</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : rows && rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Engagement Score</TableHead>
                    <TableHead>Band</TableHead>
                    <TableHead>Signals (30d)</TableHead>
                    <TableHead>KYC Status</TableHead>
                    <TableHead>KYC Completeness</TableHead>
                    <TableHead>Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.org_id} className={row.flag === "action_needed" ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium max-w-[180px] truncate">{row.org_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{row.behavioral_score}</span>
                          <Progress value={Number(row.behavioral_score)} className="w-16 h-2" />
                        </div>
                      </TableCell>
                      <TableCell>{bandBadge(row.behavioral_band)}</TableCell>
                      <TableCell className="text-sm">{row.total_signals} ({row.views} views)</TableCell>
                      <TableCell>
                        <Badge variant={row.kyc_status === "verified" ? "default" : "outline"}>
                          {row.kyc_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={Number(row.kyc_completeness)} className="w-16 h-2" />
                          <span className="text-sm">{row.kyc_completeness}%</span>
                        </div>
                      </TableCell>
                      <TableCell>{flagBadge(row.flag)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No organisation data found.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
