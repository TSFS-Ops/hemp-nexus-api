/**
 * MT-012 — Admin HQ panel for trade-request archive lifecycle.
 *
 * Lists recent trade requests with archive state, exception-hold child
 * counts, and inline {@link Mt012ArchiveControls} actions. This is the
 * canonical HQ surface for normal archive, admin override, and exception
 * hold release. No POI / WaD / execution / finality / credit / payment
 * side effects are produced by this panel — it only invokes the three
 * MT-012 edge functions, all of which delegate to `service_role`-only
 * SECDEF RPCs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mt012ArchiveControls } from "@/components/trade-request/Mt012ArchiveControls";

interface Row {
  id: string;
  commodity: string | null;
  side: string | null;
  status: string | null;
  org_id: string;
  created_at: string;
  archived_at: string | null;
  archive_mode: string | null;
  exception_hold_count: number;
}

export function AdminTradeRequestArchivePanel() {
  const { isPlatformAdmin, user } = useAuth();
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) { setCurrentOrgId(null); return; }
    void supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
      .then(({ data }) => setCurrentOrgId((data?.org_id as string | null) ?? null));
  }, [user?.id]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: trs, error } = await supabase
        .from("trade_requests")
        .select("id, commodity, side, status, org_id, created_at, archived_at, archive_mode")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = (trs ?? []).map((t) => t.id);
      let holdCounts = new Map<string, number>();
      if (ids.length) {
        const { data: holds } = await supabase
          .from("matches")
          .select("trade_request_id, metadata")
          .in("trade_request_id", ids);
        for (const m of holds ?? []) {
          const md = (m as { metadata?: Record<string, unknown> }).metadata;
          if (md && (md as Record<string, unknown>).parent_archived_admin_exception_hold === true) {
            const k = (m as { trade_request_id: string }).trade_request_id;
            holdCounts.set(k, (holdCounts.get(k) ?? 0) + 1);
          }
        }
      }
      setRows(
        (trs ?? []).map((t) => ({
          ...t,
          exception_hold_count: holdCounts.get(t.id) ?? 0,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.id.toLowerCase().includes(q) ||
      (r.commodity ?? "").toLowerCase().includes(q) ||
      (r.status ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by ID, commodity, or status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>
      <div className="border border-border rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-2">Trade request</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Archive</th>
              <th className="text-left p-2">Exception hold</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isOwner = !!currentOrgId && r.org_id === currentOrgId;
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-2">
                    <div className="font-mono text-xs">{r.id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.commodity ?? "—"} · {r.side ?? "—"}
                    </div>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">{r.status ?? "—"}</Badge>
                  </td>
                  <td className="p-2 text-xs">
                    {r.archived_at ? (
                      <div>
                        <Badge variant="secondary" className="text-[10px]">archived</Badge>
                        <div className="text-muted-foreground mt-1">{r.archive_mode ?? "normal"}</div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">active</span>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {r.exception_hold_count > 0 ? (
                      <Badge variant="destructive" className="text-[10px]">
                        {r.exception_hold_count} held
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Mt012ArchiveControls
                      tradeRequestId={r.id}
                      isOwnerOrg={isOwner}
                      isPlatformAdmin={isPlatformAdmin}
                      isArchived={!!r.archived_at}
                      hasExceptionHoldChildren={r.exception_hold_count > 0}
                      onArchived={() => void load()}
                      onReleased={() => void load()}
                    />
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={5} className="p-4 text-center text-sm text-muted-foreground">
                No trade requests visible to this account.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminTradeRequestArchivePanel;
