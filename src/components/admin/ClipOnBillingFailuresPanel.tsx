/**
 * ClipOnBillingFailuresPanel — surface durable clip-on billing failures.
 *
 * Reads from `clip_on_billing_failures` (append-only ledger written by
 * `record_clip_on_billing_failure` after the reviewer-pickup status update
 * is rolled back by `bill_clip_on_request`).
 *
 * Purpose: ensure that any insufficient-credits or status-revert blocked
 * attempt is visible to a human reviewer, with a direct link back to the
 * verification request so they can chase the org for top-up or take it
 * off-queue.
 *
 * RLS on `clip_on_billing_failures` already restricts SELECT to
 * platform_admin, so this panel relies on the existing /hq access gate.
 */

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCcw, TriangleAlert } from "lucide-react";

interface FailureRow {
  id: string;
  request_id: string;
  org_id: string | null;
  priced_total_zar: number | null;
  credits_required: number | null;
  current_balance: number | null;
  reason: Record<string, unknown> | null;
  created_at: string;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ClipOnBillingFailuresPanel() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["clip-on-billing-failures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clip_on_billing_failures")
        .select(
          "id, request_id, org_id, priced_total_zar, credits_required, current_balance, reason, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as FailureRow[];
    },
    staleTime: 30 * 1000,
  });

  // Group by request_id so a request that failed multiple times shows once
  // with an attempt count — this is the operator-friendly view. The raw
  // ledger is still queryable via the database for forensics.
  const grouped = useMemo(() => {
    const map = new Map<string, { latest: FailureRow; attempts: number }>();
    for (const r of rows) {
      const cur = map.get(r.request_id);
      if (!cur) {
        map.set(r.request_id, { latest: r, attempts: 1 });
      } else {
        cur.attempts += 1;
        // rows are ordered desc by created_at, so cur.latest is already
        // the most recent — just count.
      }
    }
    return Array.from(map.values());
  }, [rows]);

  // Pull the request rows so we can render the subject + match link.
  const requestIds = grouped.map((g) => g.latest.request_id);
  const { data: reqMap = new Map<string, { match_id: string | null; subject_name: string; status: string }>() } =
    useQuery({
      queryKey: ["clip-on-billing-failures-requests", requestIds.sort().join(",")],
      enabled: requestIds.length > 0,
      queryFn: async () => {
        const { data, error } = await supabase
          .from("operator_verification_requests")
          .select("id, match_id, subject_name, status")
          .in("id", requestIds);
        if (error) throw error;
        const m = new Map<string, { match_id: string | null; subject_name: string; status: string }>();
        for (const r of (data ?? []) as Array<{ id: string; match_id: string | null; subject_name: string; status: string }>) {
          m.set(r.id, {
            match_id: r.match_id,
            subject_name: r.subject_name,
            status: r.status,
          });
        }
        return m;
      },
    });

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground">Loading billing failures…</div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        No clip-on billing failures recorded. When a reviewer tries to pick up a
        request and the counterparty has insufficient credits (or the request
        is already billed), the attempt is logged here for follow-up.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold">Clip-on billing failures</h3>
          <Badge variant="outline" className="text-[10px]">
            {grouped.length} request{grouped.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ["admin-verification-queue"] });
          }}
        >
          <RefreshCcw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Subject</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium text-right">Required</th>
              <th className="px-3 py-2 font-medium text-right">Balance</th>
              <th className="px-3 py-2 font-medium text-right">Attempts</th>
              <th className="px-3 py-2 font-medium">Last attempt</th>
              <th className="px-3 py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ latest, attempts }) => {
              const req = reqMap.get(latest.request_id);
              const code =
                (latest.reason && (latest.reason as any).code) ||
                "UNKNOWN";
              return (
                <tr key={latest.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{req?.subject_name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Request status: {req?.status ?? "unknown"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="destructive" className="text-[10px]">
                      {String(code).replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {latest.credits_required ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {latest.current_balance ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{attempts}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatTime(latest.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    {req?.match_id ? (
                      <Link
                        to={`/desk/match/${req.match_id}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Match <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
