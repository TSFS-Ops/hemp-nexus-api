/**
 * GovernanceRecordsPanel - HQ-only entry surface.
 *
 * Two modes:
 *   - List mode: filterable list of recent matches (the primary anchor).
 *   - Detail mode: anchored by ?match=<uuid> | ?poi=<uuid> | ?engagement=<uuid>.
 *
 * Phase 1 scope: visibility only. No exports, no PDF, no AI summary.
 * Server-side protection: this panel is mounted only inside the /hq route,
 * which is wrapped by RequireAuth role="platform_admin"; all underlying
 * tables also restrict reads to platform_admin/auditor via RLS.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Search } from "lucide-react";
import { format } from "date-fns";
import { GovernanceRecordDetail } from "./GovernanceRecordDetail";

interface MatchRow {
  id: string;
  created_at: string;
  status: string | null;
  state: string | null;
  poi_state: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  commodity: string | null;
  is_demo: boolean | null;
}

function useRecentMatches(filters: { search: string; from: string; to: string }) {
  return useQuery({
    queryKey: ["governance-records-list", filters],
    queryFn: async () => {
      let q = supabase
        .from("matches")
        .select(
          "id, created_at, status, state, poi_state, buyer_name, seller_name, commodity, is_demo",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (filters.from) q = q.gte("created_at", new Date(filters.from).toISOString());
      if (filters.to) q = q.lte("created_at", new Date(filters.to).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as MatchRow[];
      if (!filters.search.trim()) return rows;
      const s = filters.search.trim().toLowerCase();
      return rows.filter((r) =>
        [r.id, r.commodity, r.buyer_name, r.seller_name, r.status, r.state]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s)),
      );
    },
  });
}

export function GovernanceRecordsPanel() {
  const [params, setParams] = useSearchParams();
  const matchId = params.get("match");
  const poiId = params.get("poi");
  const engagementId = params.get("engagement");
  const pendingEngagementId = params.get("pending_engagement");
  const tradeRequestId = params.get("trade_request");

  const inDetail = Boolean(
    matchId || poiId || engagementId || pendingEngagementId || tradeRequestId,
  );

  if (inDetail) {
    return (
      <div className="space-y-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(params);
              ["match", "poi", "engagement", "pending_engagement", "trade_request"].forEach((k) =>
                next.delete(k),
              );
              setParams(next, { replace: true });
            }}
            data-testid="governance-back"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-2" /> Back to Governance Records
          </Button>
        </div>
        <GovernanceRecordDetail
          anchor={{ matchId, poiId, engagementId, pendingEngagementId, tradeRequestId }}
        />
      </div>
    );
  }

  return <GovernanceRecordsList onOpen={(id) => setParams({ match: id }, { replace: false })} />;
}

function GovernanceRecordsList({ onOpen }: { onOpen: (matchId: string) => void }) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = useMemo(() => ({ search, from, to }), [search, from, to]);
  const { data, isLoading, isError } = useRecentMatches(filters);

  return (
    <div className="space-y-4" data-testid="governance-records-list">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                Search · match id · org · commodity · status
              </label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-7 h-9 text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="free text"
                />
              </div>
            </div>
            <div>
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                From
              </label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                To
              </label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              Phase 1 · HQ-only view · existing audit sources · no export
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <div className="p-5 text-sm text-destructive">Failed to load matches.</div>
          )}
          {data && data.length === 0 && (
            <div className="p-5 text-sm text-muted-foreground italic">
              No matches found for this filter.
            </div>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-border">
              {data.map((m) => (
                <li
                  key={m.id}
                  className="px-4 py-3 hover:bg-muted/40 cursor-pointer flex items-center justify-between gap-4"
                  onClick={() => onOpen(m.id)}
                  data-testid="governance-record-list-row"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground">
                        {m.id.slice(0, 8)}…
                      </span>
                      {m.is_demo && (
                        <Badge variant="outline" className="text-[10px]">Demo</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {m.status ?? "-"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {m.poi_state ?? "-"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {m.commodity ?? "-"} · {m.buyer_name ?? "-"} ↔ {m.seller_name ?? "-"}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {format(new Date(m.created_at), "yyyy-MM-dd HH:mm")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
