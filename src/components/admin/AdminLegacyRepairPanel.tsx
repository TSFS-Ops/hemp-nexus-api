/**
 * Batch O Phase 2 (MT-008) — Legacy Repair queue (read-only).
 *
 * Lists matches across all orgs whose lifecycle fields are mutually
 * inconsistent (Phase 1 predicate). Admin-only via the
 * `admin_list_inconsistent_matches` SECURITY DEFINER RPC.
 *
 * Phase 2 = read-only. No repair/archive actions yet (deferred to 2b).
 * No POI/WaD/payment/credit/notification side effects.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string;
  commodity: string | null;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  org_id: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  status: string | null;
  state: string | null;
  poi_state: string | null;
  settled_at: string | null;
  completed_at: string | null;
  buyer_committed_at: string | null;
  seller_committed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
  inconsistency_reasons: string[] | null;
};

const REASON_LABEL: Record<string, string> = {
  settled_status_with_draft_poi: "Settled status with draft POI",
  completed_state_with_open_poi: "Completed state with open POI",
  settled_at_without_terminal_status: "settled_at set but status not terminal",
  both_committed_state_discovery: "Both sides committed but state = discovery",
  marker_legacy_repair_required: "Operator marker: legacy repair required",
  marker_state_reconciliation_required: "Operator marker: state reconciliation required",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminLegacyRepairPanel() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-legacy-repair"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("admin_list_inconsistent_matches");
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    const msg = (error as Error)?.message ?? "Failed to load legacy repair queue";
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        {msg}
      </div>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground text-center">
        No inconsistent matches detected. All deal lifecycle data is consistent.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} match{rows.length === 1 ? "" : "es"} flagged for repair
        </span>
        <span className="font-mono">Read-only · repair/archive actions: coming next</span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Match</th>
              <th className="text-left px-3 py-2 font-medium">Commodity</th>
              <th className="text-left px-3 py-2 font-medium">Buyer org</th>
              <th className="text-left px-3 py-2 font-medium">Seller org</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">State</th>
              <th className="text-left px-3 py-2 font-medium">POI</th>
              <th className="text-left px-3 py-2 font-medium">Reasons</th>
              <th className="text-left px-3 py-2 font-medium">Updated</th>
              <th className="text-left px-3 py-2 font-medium">Spine</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
                <td className="px-3 py-2">{r.commodity ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.buyer_org_id ? r.buyer_org_id.slice(0, 8) : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.seller_org_id ? r.seller_org_id.slice(0, 8) : "—"}
                </td>
                <td className="px-3 py-2">{r.status ?? "—"}</td>
                <td className="px-3 py-2">{r.state ?? "—"}</td>
                <td className="px-3 py-2">{r.poi_state ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(r.inconsistency_reasons ?? []).map((reason) => (
                      <Badge
                        key={reason}
                        variant="outline"
                        className="text-[10px] font-normal border-amber-300 bg-amber-50 text-amber-900"
                      >
                        {REASON_LABEL[reason] ?? reason}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(r.updated_at)}</td>
                <td className="px-3 py-2">
                  <Link
                    to={`/admin?tab=spine&match=${r.id}`}
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
