import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";

interface IntegritySummary {
  checked_at: string;
  token_balance_mismatches: number;
  event_chain_issues: number;
  match_state_violations: number;
  email_delivery_gaps: number;
  document_version_conflicts: number;
  overall_status: string;
  total_issues: number;
}

export function AdminDataIntegrityPanel() {
  const [activeTab, setActiveTab] = useState("summary");

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ["admin-integrity-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("run_data_integrity_checks");
      if (error) throw error;
      return data as unknown as IntegritySummary;
    },
  });

  const { data: tokenIssues, isLoading: tokenLoading } = useQuery({
    queryKey: ["admin-integrity-tokens"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reconcile_token_balances");
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: activeTab === "tokens",
  });

  const { data: chainIssues, isLoading: chainLoading } = useQuery({
    queryKey: ["admin-integrity-chain"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_event_chain_integrity");
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: activeTab === "chain",
  });

  const { data: stateIssues, isLoading: stateLoading } = useQuery({
    queryKey: ["admin-integrity-state"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("check_match_state_invariants");
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: activeTab === "state",
  });

  const { data: emailIssues, isLoading: emailLoading } = useQuery({
    queryKey: ["admin-integrity-email"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("check_engagement_email_delivery");
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: activeTab === "email",
  });

  const { data: docIssues, isLoading: docLoading } = useQuery({
    queryKey: ["admin-integrity-docs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("check_document_version_integrity");
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: activeTab === "docs",
  });

  const isClean = summary?.overall_status === "CLEAN";

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Overall"
          value={summaryLoading ? "…" : isClean ? "CLEAN" : "ISSUES"}
          icon={isClean ? ShieldCheck : ShieldAlert}
          variant={summaryLoading ? "neutral" : isClean ? "success" : "destructive"}
        />
        <SummaryCard label="Token Balances" value={summary?.token_balance_mismatches ?? "…"} variant={summary?.token_balance_mismatches ? "destructive" : "success"} />
        <SummaryCard label="Event Chain" value={summary?.event_chain_issues ?? "…"} variant={summary?.event_chain_issues ? "destructive" : "success"} />
        <SummaryCard label="State Invariants" value={summary?.match_state_violations ?? "…"} variant={summary?.match_state_violations ? "warning" : "success"} />
        <SummaryCard label="Email Delivery" value={summary?.email_delivery_gaps ?? "…"} variant={summary?.email_delivery_gaps ? "warning" : "success"} />
        <SummaryCard label="Doc Versions" value={summary?.document_version_conflicts ?? "…"} variant={summary?.document_version_conflicts ? "warning" : "success"} />
      </div>

      {summary && (
        <p className="text-xs text-muted-foreground">
          Last checked: {format(new Date(summary.checked_at), "dd MMM yyyy, HH:mm:ss")} · {summary.total_issues} total issue{summary.total_issues !== 1 ? "s" : ""}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => refetchSummary()} disabled={summaryLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${summaryLoading ? "animate-spin" : ""}`} />
          Re-run All Checks
        </Button>
      </div>

      {/* Detail Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="tokens">
              Token Balances {summary?.token_balance_mismatches ? <Badge variant="destructive" className="ml-1.5 text-[10px] h-4 px-1">{summary.token_balance_mismatches}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="chain">
              Event Chain {summary?.event_chain_issues ? <Badge variant="destructive" className="ml-1.5 text-[10px] h-4 px-1">{summary.event_chain_issues}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="state">
              State Invariants {summary?.match_state_violations ? <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">{summary.match_state_violations}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="email">
              Email Delivery {summary?.email_delivery_gaps ? <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">{summary.email_delivery_gaps}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="docs">
              Doc Versions {summary?.document_version_conflicts ? <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">{summary.document_version_conflicts}</Badge> : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cross-Consistency Reconciliation</CardTitle>
              <CardDescription>Validates that all views and records agree about what happened. Checks token balances against the ledger, event hash chains, match state machine invariants, engagement email delivery, and document versioning.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CheckRow label="Token balance = initial − Σburned + Σcredited" status={summary?.token_balance_mismatches === 0 ? "pass" : "fail"} count={summary?.token_balance_mismatches} />
              <CheckRow label="Event hash chain is unbroken and matches.event_chain_hash agrees" status={summary?.event_chain_issues === 0 ? "pass" : "fail"} count={summary?.event_chain_issues} />
              <CheckRow label="Match state machine invariants hold (committed → settled_at, poi_state, events)" status={summary?.match_state_violations === 0 ? "pass" : "fail"} count={summary?.match_state_violations} />
              <CheckRow label="All engagement notifications have corresponding email delivery records" status={summary?.email_delivery_gaps === 0 ? "pass" : "fail"} count={summary?.email_delivery_gaps} />
              <CheckRow label="Exactly one current-version document per (match, doc_type)" status={summary?.document_version_conflicts === 0 ? "pass" : "fail"} count={summary?.document_version_conflicts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tokens" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Token Balance Reconciliation</CardTitle>
              <CardDescription>Compares token_balances.balance against computed sum from token_ledger. Discrepancy indicates silent burn or double-credit.</CardDescription>
            </CardHeader>
            <CardContent>
              {tokenLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organisation</TableHead>
                      <TableHead className="text-right">Recorded</TableHead>
                      <TableHead className="text-right">Computed</TableHead>
                      <TableHead className="text-right">Burned</TableHead>
                      <TableHead className="text-right">Credited</TableHead>
                      <TableHead className="text-right">Discrepancy</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tokenIssues || []).slice(0, 50).map((row: any) => (
                      <TableRow key={row.org_id} className={row.status === "MISMATCH" ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-xs">{row.org_id?.slice(0, 8)}…</TableCell>
                        <TableCell className="text-right font-mono">{row.recorded_balance}</TableCell>
                        <TableCell className="text-right font-mono">{row.computed_balance}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{row.total_burned}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{row.total_credited}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{row.discrepancy > 0 ? "+" : ""}{row.discrepancy}</TableCell>
                        <TableCell><Badge variant={row.status === "ok" ? "secondary" : "destructive"}>{row.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(tokenIssues || []).length > 50 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing 50 of {(tokenIssues || []).length} records. Remaining {(tokenIssues || []).length - 50} not displayed.</p>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chain" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event Chain Integrity</CardTitle>
              <CardDescription>Verifies SHA-256 hash chain continuity across match events. CHAIN_BREAK = broken link. HASH_DRIFT = matches.event_chain_hash disagrees with latest event. MISSING_HASH = advanced state with null hash.</CardDescription>
            </CardHeader>
            <CardContent>
              {chainLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : chainIssues?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">All event chains verified. No issues found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(chainIssues || []).map((row: any, i: number) => (
                      <TableRow key={i} className="bg-destructive/5">
                        <TableCell className="font-mono text-xs">{row.match_id?.slice(0, 8)}…</TableCell>
                        <TableCell><Badge variant="destructive">{row.issue_type}</Badge></TableCell>
                        <TableCell className="text-xs max-w-md break-all">{row.details}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="state" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Match State Invariants</CardTitle>
              <CardDescription>Validates state machine rules: committed matches must have settled_at, POI events, collapse ledger entries, and committed timestamps.</CardDescription>
            </CardHeader>
            <CardContent>
              {stateLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : stateIssues?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">All match states are consistent. No violations.</p>
              ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Violation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(stateIssues || []).slice(0, 100).map((row: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{row.match_id?.slice(0, 8)}…</TableCell>
                        <TableCell><Badge variant="outline">{row.current_state}</Badge></TableCell>
                        <TableCell className="text-xs">{row.violation}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(stateIssues || []).length > 100 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing 100 of {(stateIssues || []).length} violations. Remaining {(stateIssues || []).length - 100} not displayed.</p>
                )}
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Engagement Email Delivery</CardTitle>
              <CardDescription>Cross-checks poi_engagements marked as "notification_sent" against email_send_log. Missing or failed entries indicate silent delivery failures.</CardDescription>
            </CardHeader>
            <CardContent>
              {emailLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : emailIssues?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">All engagement notifications have matching delivery records.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Engagement</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Email Status</TableHead>
                      <TableHead>Issue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(emailIssues || []).map((row: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{row.engagement_id?.slice(0, 8)}…</TableCell>
                        <TableCell className="text-xs">{row.counterparty_email}</TableCell>
                        <TableCell><Badge variant={row.email_status === "NO_RECORD" ? "destructive" : "secondary"}>{row.email_status}</Badge></TableCell>
                        <TableCell className="text-xs">{row.issue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document Version Integrity</CardTitle>
              <CardDescription>Detects cases where multiple documents are marked as the current version for the same match and document type.</CardDescription>
            </CardHeader>
            <CardContent>
              {docLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : docIssues?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">All document versions are consistent. No conflicts.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match</TableHead>
                      <TableHead>Document Type</TableHead>
                      <TableHead>Current Versions</TableHead>
                      <TableHead>Issue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(docIssues || []).map((row: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{row.match_id?.slice(0, 8)}…</TableCell>
                        <TableCell>{row.doc_type}</TableCell>
                        <TableCell className="font-mono">{row.current_version_count}</TableCell>
                        <TableCell className="text-xs">{row.issue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, variant = "neutral" }: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: "success" | "destructive" | "warning" | "neutral";
}) {
  const colors = {
    success: "border-emerald-500/30 bg-emerald-500/5",
    destructive: "border-destructive/30 bg-destructive/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    neutral: "border-border",
  };
  return (
    <Card className={`${colors[variant]}`}>
      <CardContent className="pt-4 pb-3 px-3 text-center">
        {Icon && <Icon className={`h-5 w-5 mx-auto mb-1 ${variant === "success" ? "text-emerald-500" : variant === "destructive" ? "text-destructive" : "text-muted-foreground"}`} />}
        <p className="text-lg font-bold font-mono">{value}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}

function CheckRow({ label, status, count }: { label: string; status: "pass" | "fail"; count?: number }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {status === "pass" ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">{label}</p>
      </div>
      {count !== undefined && count > 0 && (
        <Badge variant="destructive" className="text-[10px] h-5">{count} issue{count !== 1 ? "s" : ""}</Badge>
      )}
    </div>
  );
}
