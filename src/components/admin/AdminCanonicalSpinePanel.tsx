/**
 * AdminCanonicalSpinePanel - Unified Spine view (Item 12).
 *
 * One row per match, with status pills for every spine stage:
 *   Search/Discovery → Match → POI → WaD → Execution (PoD)
 *
 * Lets admins filter by stage status and click through to MatchDetails.
 * Read-only; all mutations stay in the per-stage panels.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Search,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type StageStatus = "none" | "pending" | "complete" | "issue";

interface SpineRow {
  match_id: string;
  created_at: string;
  commodity: string | null;
  buyer_org: string | null;
  seller_org: string | null;
  match_state: string | null;
  match_status: string | null;
  poi_state: string | null;
  trade_request_id: string | null;
  // joined
  wad_state: string | null;
  wad_issued_at: string | null;
  pod_state: string | null;
  pod_milestones_total: number;
  pod_milestones_done: number;
  open_breaches: number;
}

const PAGE_SIZE = 50;

function pillFor(status: StageStatus, label: string) {
  const variants: Record<StageStatus, { cls: string; Icon: typeof Circle }> = {
    none: { cls: "bg-muted text-muted-foreground border-border", Icon: Circle },
    pending: {
      cls: "bg-amber-50 text-amber-900 border-amber-200",
      Icon: Loader2,
    },
    complete: {
      cls: "bg-emerald-50 text-emerald-900 border-emerald-200",
      Icon: CheckCircle2,
    },
    issue: {
      cls: "bg-rose-50 text-rose-900 border-rose-200",
      Icon: AlertTriangle,
    },
  };
  const { cls, Icon } = variants[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono ${cls}`}
    >
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      {label}
    </span>
  );
}

function deriveSearchStage(row: SpineRow): { status: StageStatus; label: string } {
  // A match always implies Discovery happened. If trade_request_id is present,
  // that's a richer search-driven path; otherwise it's a direct/manual match.
  return row.trade_request_id
    ? { status: "complete", label: "Searched" }
    : { status: "complete", label: "Direct" };
}

function deriveMatchStage(row: SpineRow): { status: StageStatus; label: string } {
  if (!row.match_state) return { status: "pending", label: "draft" };
  if (row.match_state === "rejected" || row.match_status === "cancelled") {
    return { status: "issue", label: row.match_state };
  }
  if (["committed", "settled"].includes(row.match_state)) {
    return { status: "complete", label: row.match_state };
  }
  return { status: "pending", label: row.match_state };
}

function derivePoiStage(row: SpineRow): { status: StageStatus; label: string } {
  const s = row.poi_state ?? "none";
  if (s === "COMPLETED" || s === "ELIGIBLE") return { status: "complete", label: s };
  if (s === "REJECTED" || s === "EXPIRED") return { status: "issue", label: s };
  if (s === "none") return { status: "none", label: "-" };
  return { status: "pending", label: s };
}

function deriveWadStage(row: SpineRow): { status: StageStatus; label: string } {
  if (!row.wad_state) return { status: "none", label: "-" };
  if (row.wad_state === "ISSUED") return { status: "complete", label: "ISSUED" };
  if (row.wad_state === "DENIED") return { status: "issue", label: "DENIED" };
  return { status: "pending", label: row.wad_state };
}

function deriveExecutionStage(row: SpineRow): { status: StageStatus; label: string } {
  if (!row.pod_state) return { status: "none", label: "-" };
  if (row.open_breaches > 0) return { status: "issue", label: "BREACH" };
  if (row.pod_state === "FINALISED") return { status: "complete", label: "FINALISED" };
  if (row.pod_state === "BREACHED") return { status: "issue", label: "BREACHED" };
  const pct = row.pod_milestones_total
    ? Math.round((row.pod_milestones_done / row.pod_milestones_total) * 100)
    : 0;
  return { status: "pending", label: `${pct}%` };
}

export function AdminCanonicalSpinePanel() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-spine"],
    queryFn: async (): Promise<SpineRow[]> => {
      // 1. Pull the most recent matches.
      const { data: matches, error: mErr } = await supabase
        .from("matches")
        .select(
          "id, created_at, commodity, buyer_name, seller_name, state, status, poi_state, trade_request_id"
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (mErr) throw mErr;
      const matchIds = (matches ?? []).map((m) => m.id);
      if (matchIds.length === 0) return [];

      // 2. Pull the latest WaD per match (poi_id == match.id).
      const { data: wads } = await supabase
        .from("p3_wads")
        .select("poi_id, state, issued_at, created_at")
        .in("poi_id", matchIds)
        .order("created_at", { ascending: false });
      const wadByMatch = new Map<string, { state: string; issued_at: string | null }>();
      for (const w of wads ?? []) {
        if (!wadByMatch.has(w.poi_id)) {
          wadByMatch.set(w.poi_id, { state: w.state, issued_at: w.issued_at });
        }
      }

      // 3. Pull active PoDs for those WaDs.
      const wadIds = (wads ?? []).map((w) => (w as any).id).filter(Boolean);
      // p3_wads rows we already fetched lack id in the projection - refetch ids.
      const { data: wadsWithIds } = await supabase
        .from("p3_wads")
        .select("id, poi_id")
        .in("poi_id", matchIds);
      const wadIdToMatch = new Map<string, string>();
      (wadsWithIds ?? []).forEach((w) => wadIdToMatch.set(w.id, w.poi_id));

      const allWadIds = Array.from(wadIdToMatch.keys());
      let podsRows: any[] = [];
      let milestoneRows: any[] = [];
      let breachRows: any[] = [];
      if (allWadIds.length > 0) {
        const { data: pods } = await supabase
          .from("pods")
          .select("id, wad_id, state")
          .in("wad_id", allWadIds)
          .neq("state", "CANCELLED");
        podsRows = pods ?? [];

        const podIds = podsRows.map((p) => p.id);
        if (podIds.length > 0) {
          const { data: ms } = await supabase
            .from("pod_milestones")
            .select("pod_id, status")
            .in("pod_id", podIds);
          milestoneRows = ms ?? [];

          const { data: br } = await supabase
            .from("breaches")
            .select("pod_id, status")
            .in("pod_id", podIds)
            .eq("status", "open");
          breachRows = br ?? [];
        }
      }

      const podByMatch = new Map<
        string,
        { state: string; total: number; done: number; openBreaches: number }
      >();
      for (const p of podsRows) {
        const matchId = wadIdToMatch.get(p.wad_id);
        if (!matchId) continue;
        const ms = milestoneRows.filter((m) => m.pod_id === p.id);
        const open = breachRows.filter((b) => b.pod_id === p.id).length;
        podByMatch.set(matchId, {
          state: p.state,
          total: ms.length,
          done: ms.filter((m) => m.status === "completed").length,
          openBreaches: open,
        });
      }

      return (matches ?? []).map((m: any) => {
        const wad = wadByMatch.get(m.id) ?? null;
        const pod = podByMatch.get(m.id) ?? null;
        return {
          match_id: m.id,
          created_at: m.created_at,
          commodity: m.commodity,
          buyer_org: m.buyer_name,
          seller_org: m.seller_name,
          match_state: m.state,
          match_status: m.status,
          poi_state: m.poi_state,
          trade_request_id: m.trade_request_id,
          wad_state: wad?.state ?? null,
          wad_issued_at: wad?.issued_at ?? null,
          pod_state: pod?.state ?? null,
          pod_milestones_total: pod?.total ?? 0,
          pod_milestones_done: pod?.done ?? 0,
          open_breaches: pod?.openBreaches ?? 0,
        } as SpineRow;
      });
    },
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const blob = `${r.match_id} ${r.commodity ?? ""} ${r.buyer_org ?? ""} ${r.seller_org ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (stageFilter === "all") return true;
      const matchStg = deriveMatchStage(r).status;
      const poiStg = derivePoiStage(r).status;
      const wadStg = deriveWadStage(r).status;
      const execStg = deriveExecutionStage(r).status;
      if (stageFilter === "issues") {
        return [matchStg, poiStg, wadStg, execStg].includes("issue");
      }
      if (stageFilter === "no-poi") return r.poi_state === null;
      if (stageFilter === "no-wad") return r.wad_state === null && (r.poi_state === "COMPLETED" || r.poi_state === "ELIGIBLE");
      if (stageFilter === "no-execution")
        return r.wad_state === "ISSUED" && r.pod_state === null;
      if (stageFilter === "in-execution")
        return r.pod_state === "IN_PROGRESS" || r.pod_state === "BREACHED";
      return true;
    });
  }, [data, search, stageFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Canonical Spine
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            One row per match · live status across Search → Match → POI → WaD → Execution
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by org / commodity / id"
              className="pl-7 w-[260px] h-9 text-sm"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[200px] h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              <SelectItem value="issues">Has issue</SelectItem>
              <SelectItem value="no-poi">Awaiting POI</SelectItem>
              <SelectItem value="no-wad">POI but no WaD</SelectItem>
              <SelectItem value="no-execution">WaD issued, no execution</SelectItem>
              <SelectItem value="in-execution">In execution</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Refresh"
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive p-3 border border-destructive/30 bg-destructive/5 rounded">
          <ShieldAlert className="h-4 w-4" />
          Failed to load spine: {(error as Error).message}
        </div>
      )}

      <div className="border border-border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Match</TableHead>
              <TableHead>Counterparties</TableHead>
              <TableHead>Search</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>POI</TableHead>
              <TableHead>WaD</TableHead>
              <TableHead>Execution</TableHead>
              <TableHead className="w-[140px] text-right">Age</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                  Loading spine…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                  No matches under the current filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const search = deriveSearchStage(row);
                const match = deriveMatchStage(row);
                const poi = derivePoiStage(row);
                const wad = deriveWadStage(row);
                const exec = deriveExecutionStage(row);
                return (
                  <TableRow key={row.match_id} className="text-sm">
                    <TableCell className="font-mono text-xs">
                      <div className="truncate max-w-[160px]" title={row.match_id}>
                        {row.match_id.slice(0, 8)}…
                      </div>
                      {row.commodity && (
                        <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                          {row.commodity}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div className="truncate max-w-[200px]">{row.buyer_org ?? "-"}</div>
                        <div className="text-muted-foreground truncate max-w-[200px]">
                          ↔ {row.seller_org ?? "-"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{pillFor(search.status, search.label)}</TableCell>
                    <TableCell>{pillFor(match.status, match.label)}</TableCell>
                    <TableCell>{pillFor(poi.status, poi.label)}</TableCell>
                    <TableCell>{pillFor(wad.status, wad.label)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {pillFor(exec.status, exec.label)}
                        {row.pod_state && row.pod_milestones_total > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {row.pod_milestones_done}/{row.pod_milestones_total}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(row.created_at), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/match/${row.match_id}`}
                        className="text-primary hover:underline inline-flex items-center"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open match"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-[11px] font-mono text-muted-foreground">
        Showing {filtered.length} of {data?.length ?? 0} most-recent matches · auto-refresh 30s
      </div>
    </div>
  );
}
