/**
 * SpineTimeline - per-match canonical spine view.
 *
 * Mirrors AdminCanonicalSpinePanel's row logic, but rendered vertically
 * for traders inside MatchDetails. One stage per row:
 *   Search/Discovery → Match → POI → WaD → Execution (PoD)
 *
 * Read-only. Stage status derivation is intentionally identical to the
 * admin panel so admins and traders see the same canonical truth.
 */

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Search as SearchIcon,
  Handshake,
  FileCheck,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type StageStatus = "none" | "pending" | "complete" | "issue";

interface Props {
  matchId: string;
}

interface SpineData {
  match: {
    id: string;
    created_at: string;
    state: string | null;
    status: string | null;
    poi_state: string | null;
    trade_request_id: string | null;
    poi_issued_at?: string | null;
    settled_at?: string | null;
  } | null;
  wad: {
    state: string | null;
    issued_at: string | null;
    created_at: string | null;
  } | null;
  pod: {
    state: string | null;
    total: number;
    done: number;
    openBreaches: number;
    created_at: string | null;
  } | null;
}

function statusClasses(s: StageStatus): { ring: string; chip: string; Icon: typeof Circle } {
  switch (s) {
    case "complete":
      return {
        ring: "border-emerald-200 bg-emerald-50 text-emerald-900",
        chip: "bg-emerald-100 text-emerald-900 border-emerald-200",
        Icon: CheckCircle2,
      };
    case "issue":
      return {
        ring: "border-rose-200 bg-rose-50 text-rose-900",
        chip: "bg-rose-100 text-rose-900 border-rose-200",
        Icon: AlertTriangle,
      };
    case "pending":
      return {
        ring: "border-amber-200 bg-amber-50 text-amber-900",
        chip: "bg-amber-100 text-amber-900 border-amber-200",
        Icon: Loader2,
      };
    case "none":
    default:
      return {
        ring: "border-border bg-muted/40 text-muted-foreground",
        chip: "bg-muted text-muted-foreground border-border",
        Icon: Circle,
      };
  }
}

function deriveStages(d: SpineData) {
  const m = d.match;
  const search: { status: StageStatus; label: string; detail: string } = m?.trade_request_id
    ? { status: "complete", label: "Searched", detail: "Originated from a trade request." }
    : { status: "complete", label: "Direct", detail: "Direct/manual match - no prior search." };

  const matchStage: { status: StageStatus; label: string; detail: string } = (() => {
    if (!m?.state) return { status: "pending", label: "draft", detail: "Match draft pending." };
    if (m.state === "rejected" || m.status === "cancelled")
      return { status: "issue", label: m.state, detail: "Match was rejected or cancelled." };
    if (["committed", "settled"].includes(m.state))
      return { status: "complete", label: m.state, detail: "Match agreed by both sides." };
    return { status: "pending", label: m.state, detail: "Match in progress." };
  })();

  const poi: { status: StageStatus; label: string; detail: string } = (() => {
    const s = m?.poi_state ?? "none";
    if (s === "none") return { status: "none", label: "-", detail: "No Proof of Intent yet." };
    if (s === "COMPLETED" || s === "ELIGIBLE")
      return { status: "complete", label: s, detail: "Proof of Intent issued." };
    if (s === "REJECTED" || s === "EXPIRED")
      return { status: "issue", label: s, detail: "POI no longer valid." };
    return { status: "pending", label: s, detail: "POI in progress." };
  })();

  const wad: { status: StageStatus; label: string; detail: string } = (() => {
    if (!d.wad?.state) return { status: "none", label: "-", detail: "WaD not started." };
    if (d.wad.state === "ISSUED")
      return { status: "complete", label: "ISSUED", detail: "WaD sealed and issued." };
    if (d.wad.state === "DENIED")
      return { status: "issue", label: "DENIED", detail: "WaD denied." };
    return { status: "pending", label: d.wad.state, detail: "WaD attestations in progress." };
  })();

  const exec: { status: StageStatus; label: string; detail: string } = (() => {
    const p = d.pod;
    if (!p?.state) return { status: "none", label: "-", detail: "Execution not started." };
    if (p.openBreaches > 0)
      return {
        status: "issue",
        label: "BREACH",
        detail: `${p.openBreaches} open breach${p.openBreaches === 1 ? "" : "es"}.`,
      };
    if (p.state === "FINALISED")
      return { status: "complete", label: "FINALISED", detail: "Execution complete." };
    if (p.state === "BREACHED")
      return { status: "issue", label: "BREACHED", detail: "Execution breached." };
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return {
      status: "pending",
      label: `${pct}%`,
      detail: `${p.done} of ${p.total} milestones complete.`,
    };
  })();

  return { search, match: matchStage, poi, wad, exec };
}

export function SpineTimeline({ matchId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["match-spine", matchId],
    queryFn: async (): Promise<SpineData> => {
      const { data: match, error: mErr } = await supabase
        .from("matches")
        .select("id, created_at, state, status, poi_state, trade_request_id")
        .eq("id", matchId)
        .maybeSingle();
      if (mErr) throw mErr;

      const { data: wads } = await supabase
        .from("p3_wads")
        .select("id, state, issued_at, created_at")
        .eq("poi_id", matchId)
        .order("created_at", { ascending: false })
        .limit(1);
      const wad = wads?.[0] ?? null;

      let pod: SpineData["pod"] = null;
      if (wad?.id) {
        const { data: pods } = await supabase
          .from("pods")
          .select("id, state, created_at")
          .eq("wad_id", wad.id)
          .neq("state", "CANCELLED")
          .order("created_at", { ascending: false })
          .limit(1);
        const p = pods?.[0];
        if (p) {
          const [{ data: ms }, { data: br }] = await Promise.all([
            supabase.from("pod_milestones").select("status").eq("pod_id", p.id),
            supabase.from("breaches").select("id").eq("pod_id", p.id).eq("status", "open"),
          ]);
          pod = {
            state: p.state,
            total: (ms ?? []).length,
            done: (ms ?? []).filter((x) => x.status === "completed").length,
            openBreaches: (br ?? []).length,
            created_at: p.created_at,
          };
        }
      }

      return { match: match as SpineData["match"], wad, pod };
    },
    enabled: !!matchId,
    refetchInterval: 60_000,
  });

  const stages = data
    ? deriveStages(data)
    : null;

  const rows: Array<{
    key: string;
    title: string;
    Icon: typeof SearchIcon;
    status: StageStatus;
    label: string;
    detail: string;
    timestamp?: string | null;
  }> = stages && data
    ? [
        {
          key: "search",
          title: "Discovery",
          Icon: SearchIcon,
          ...stages.search,
        },
        {
          key: "match",
          title: "Match",
          Icon: Handshake,
          ...stages.match,
          timestamp: data.match?.created_at,
        },
        {
          key: "poi",
          title: "Proof of Intent",
          Icon: FileCheck,
          ...stages.poi,
        },
        {
          key: "wad",
          title: "Without a Doubt",
          Icon: ShieldCheck,
          ...stages.wad,
          timestamp: data.wad?.issued_at ?? data.wad?.created_at,
        },
        {
          key: "exec",
          title: "Execution",
          Icon: Truck,
          ...stages.exec,
          timestamp: data.pod?.created_at,
        },
      ]
    : [];

  return (
    <section className="border border-border rounded-md bg-card p-4">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Trade Spine
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Canonical lifecycle: Discovery → Match → POI → WaD → Execution
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-4 text-center">Loading spine…</div>
      ) : error ? (
        <div className="text-xs text-destructive py-2">
          Failed to load spine: {(error as Error).message}
        </div>
      ) : (
        <ol className="relative space-y-2">
          {rows.map((row, idx) => {
            const { ring, chip, Icon: StatusIcon } = statusClasses(row.status);
            const isLast = idx === rows.length - 1;
            return (
              <li key={row.key} className="relative flex items-start gap-3">
                {/* Connector line */}
                {!isLast && (
                  <span
                    aria-hidden
                    className="absolute left-[15px] top-8 bottom-[-8px] w-px bg-border"
                  />
                )}
                <div
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${ring}`}
                >
                  <row.Icon className="h-4 w-4" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{row.title}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono ${chip}`}
                    >
                      <StatusIcon className="h-3 w-3" strokeWidth={1.5} />
                      {row.label}
                    </span>
                    {row.timestamp && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {formatDistanceToNowStrict(new Date(row.timestamp), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{row.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
