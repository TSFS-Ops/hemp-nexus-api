import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Timer, ShieldCheck, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface OrgInsight {
  org_id: string;
  org_name: string;
  /** Average hours between POI draft and counterparty acceptance */
  avg_responsiveness_hours: number | null;
  /** Count of verified documents vs total uploaded */
  verified_docs: number;
  total_docs: number;
  /** Behavioral score from existing RPC */
  behavioral_score: number;
  behavioral_band: string;
  total_pois: number;
  bilateral_count: number;
}

export function AdminBehavioralInsights() {
  const { data: insights, isLoading } = useQuery({
    queryKey: ["admin-behavioral-insights"],
    queryFn: async () => {
      // Fetch behavioral scores via existing RPC
      const { data: scores, error: scoresErr } = await supabase.rpc(
        "compute_all_behavioral_kyc_scores",
        { p_days: 90 }
      );
      if (scoresErr) throw scoresErr;

      // Fetch POI responsiveness data — time between unilateral creation and bilateral bind
      const { data: matches, error: matchErr } = await supabase
        .from("matches")
        .select("org_id, match_type, created_at, settled_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (matchErr) throw matchErr;

      // Fetch document verification stats per org (verified_at != null means verified)
      const { data: docs, error: docErr } = await supabase
        .from("match_documents")
        .select("org_id, verified_at")
        .limit(1000);
      if (docErr) throw docErr;

      // Aggregate per org
      const orgMap = new Map<string, OrgInsight>();

      for (const s of scores || []) {
        orgMap.set(s.org_id, {
          org_id: s.org_id,
          org_name: s.org_name || s.org_id.slice(0, 8),
          avg_responsiveness_hours: null,
          verified_docs: 0,
          total_docs: 0,
          behavioral_score: Number(s.behavioral_score) || 0,
          behavioral_band: s.behavioral_band || "none",
          total_pois: 0,
          bilateral_count: 0,
        });
      }

      // Compute responsiveness: avg time from created_at to settled_at for bilateral matches
      const orgTimings = new Map<string, number[]>();
      for (const m of matches || []) {
        if (!m.org_id) continue;
        if (!orgMap.has(m.org_id)) continue;
        const entry = orgMap.get(m.org_id)!;
        entry.total_pois++;
        if (m.match_type === "bilateral") entry.bilateral_count++;
        if (m.settled_at && m.created_at) {
          const diff = (new Date(m.settled_at).getTime() - new Date(m.created_at).getTime()) / (1000 * 60 * 60);
          if (diff > 0 && diff < 720) { // cap at 30 days
            if (!orgTimings.has(m.org_id)) orgTimings.set(m.org_id, []);
            orgTimings.get(m.org_id)!.push(diff);
          }
        }
      }

      for (const [orgId, timings] of orgTimings) {
        if (orgMap.has(orgId) && timings.length > 0) {
          orgMap.get(orgId)!.avg_responsiveness_hours =
            Math.round((timings.reduce((a, b) => a + b, 0) / timings.length) * 10) / 10;
        }
      }

      // Document integrity
      for (const d of docs || []) {
        if (!d.org_id || !orgMap.has(d.org_id)) continue;
        const entry = orgMap.get(d.org_id)!;
        entry.total_docs++;
        if (d.verified_at) entry.verified_docs++;
      }

      return Array.from(orgMap.values())
        .filter(o => o.total_pois > 0 || o.behavioral_score > 0)
        .sort((a, b) => b.behavioral_score - a.behavioral_score);
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const orgs = insights || [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          Behavioural Insights
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          "Why vs. What" analysis — responsiveness patterns and document integrity per organisation.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Timer className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Avg Responsiveness</p>
              <p className="text-2xl font-bold">
                {orgs.length > 0
                  ? (() => {
                      const valid = orgs.filter(o => o.avg_responsiveness_hours !== null);
                      if (valid.length === 0) return "—";
                      const avg = valid.reduce((s, o) => s + o.avg_responsiveness_hours!, 0) / valid.length;
                      return avg < 24 ? `${Math.round(avg)}h` : `${Math.round(avg / 24)}d`;
                    })()
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Draft → Accept time</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Document Integrity</p>
              <p className="text-2xl font-bold">
                {(() => {
                  const totalDocs = orgs.reduce((s, o) => s + o.total_docs, 0);
                  const verifiedDocs = orgs.reduce((s, o) => s + o.verified_docs, 0);
                  return totalDocs > 0 ? `${Math.round((verifiedDocs / totalDocs) * 100)}%` : "—";
                })()}
              </p>
              <p className="text-xs text-muted-foreground">Verified / Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Active Orgs</p>
              <p className="text-2xl font-bold">{orgs.length}</p>
              <p className="text-xs text-muted-foreground">With POI activity</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-org table */}
      <Card>
        <CardHeader>
          <CardTitle>Organisation Behavioural Profile</CardTitle>
          <CardDescription>
            Responsiveness Score measures time from POI draft to counterparty acceptance.
            Document Integrity Score measures the ratio of verified vs unverified documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No behavioural data available yet. Organisations need to create POIs to generate insights.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Responsiveness</TableHead>
                  <TableHead>Doc Integrity</TableHead>
                  <TableHead>POIs</TableHead>
                  <TableHead>Bilateral</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => {
                  const docPct = org.total_docs > 0 ? Math.round((org.verified_docs / org.total_docs) * 100) : null;
                  return (
                    <TableRow key={org.org_id}>
                      <TableCell className="font-medium">{org.org_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              org.behavioral_band === "high" ? "default" :
                              org.behavioral_band === "medium" ? "secondary" : "outline"
                            }
                            className="text-xs"
                          >
                            {org.behavioral_band}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{org.behavioral_score}/100</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {org.avg_responsiveness_hours !== null ? (
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-sm font-medium",
                              org.avg_responsiveness_hours < 24 ? "text-green-600" :
                              org.avg_responsiveness_hours < 72 ? "text-amber-600" : "text-destructive"
                            )}>
                              {org.avg_responsiveness_hours < 24
                                ? `${Math.round(org.avg_responsiveness_hours)}h`
                                : `${Math.round(org.avg_responsiveness_hours / 24)}d`}
                            </span>
                            <Progress
                              value={Math.max(5, 100 - (org.avg_responsiveness_hours / 72) * 100)}
                              className="h-1.5 w-16"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No data</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {docPct !== null ? (
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-sm font-medium",
                              docPct >= 80 ? "text-green-600" :
                              docPct >= 50 ? "text-amber-600" : "text-destructive"
                            )}>
                              {docPct}%
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({org.verified_docs}/{org.total_docs})
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No docs</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{org.total_pois}</TableCell>
                      <TableCell className="text-sm">{org.bilateral_count}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
