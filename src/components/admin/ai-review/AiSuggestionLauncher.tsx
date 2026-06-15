/**
 * AI Suggestion Launcher - Batch 1 / Fix 1 (entry-point wiring).
 *
 * Lives at the top of /hq/ai-suggestions. Lets a platform_admin:
 *   1. Pick a real existing trade_request (no seeding, no fake data).
 *   2. Run "Interpret with AI" → ai-interpret-trade-request edge function.
 *   3. Run "Source counterparties" → ai-source-counterparties edge function.
 *
 * Strict scope (mirrors the queue panel banner):
 *   - Advisory only. No outreach, no POI, no WaD, no formal-match mutation,
 *     no verification claim. Both buttons are platform_admin-gated server-side.
 *   - On success, invalidates the `ai-proposed-matches` query so newly sourced
 *     proposals appear in the queue below without a page reload.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { Sparkles, Search, Users, Info } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type TradeRequestRow = {
  id: string;
  org_id: string | null;
  commodity: string | null;
  side: string | null;
  location: string | null;
  status: string | null;
  created_at: string;
};

type InterpretationRow = {
  id: string;
  trade_request_id: string;
  commodity_or_service: string | null;
  side: string | null;
  geography: string | null;
  quantity: string | null;
  timing: string | null;
  commercial_intent: string | null;
  preferred_counterparty_type: string | null;
  ai_confidence: string | null;
  risk_indicators: unknown;
  created_at: string;
};

const PICKER_LIMIT = 50;

export function AiSuggestionLauncher() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [latestInterpretation, setLatestInterpretation] = useState<InterpretationRow | null>(null);

  const listQuery = useQuery({
    queryKey: ["ai-launcher-trade-requests", query],
    queryFn: async (): Promise<TradeRequestRow[]> => {
      let q = supabase
        .from("trade_requests")
        .select("id, org_id, commodity, side, location, status, created_at")
        .order("created_at", { ascending: false })
        .limit(PICKER_LIMIT);

      const term = query.trim();
      if (term.length > 0) {
        // Allow direct id paste OR commodity/location ilike search.
        if (/^[0-9a-f-]{8,}$/i.test(term)) {
          q = q.ilike("id", `%${term}%`);
        } else {
          q = q.or(
            `commodity.ilike.%${term}%,location.ilike.%${term}%,side.ilike.%${term}%`,
          );
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TradeRequestRow[];
    },
  });

  const selected = useMemo(
    () => (listQuery.data ?? []).find((r) => r.id === selectedId) ?? null,
    [listQuery.data, selectedId],
  );

  // If selection isn't in the current page (e.g. picked then changed search),
  // fetch the single row so its details still render.
  const selectedDetail = useQuery({
    queryKey: ["ai-launcher-tr-detail", selectedId],
    enabled: !!selectedId && !selected,
    queryFn: async (): Promise<TradeRequestRow | null> => {
      const { data, error } = await supabase
        .from("trade_requests")
        .select("id, org_id, commodity, side, location, status, created_at")
        .eq("id", selectedId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TradeRequestRow | null;
    },
  });

  const activeRow = selected ?? selectedDetail.data ?? null;

  async function handleInterpret() {
    if (!selectedId || interpreting) return;
    setInterpreting(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-interpret-trade-request", {
        body: { trade_request_id: selectedId },
      });
      if (error) throw new Error(error.message || "Edge function error");
      const payload = data as { interpretation?: InterpretationRow; error?: string };
      if (payload?.error) throw new Error(payload.error);
      if (payload?.interpretation) setLatestInterpretation(payload.interpretation);
      toast.success("Interpretation generated. Advisory only - nothing was contacted.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(`Interpret failed: ${msg}`);
    } finally {
      setInterpreting(false);
    }
  }

  async function handleSource() {
    if (!selectedId || sourcing) return;
    setSourcing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-source-counterparties", {
        body: { trade_request_id: selectedId },
      });
      if (error) throw new Error(error.message || "Edge function error");
      const payload = data as {
        error?: string;
        created?: number;
        proposed?: unknown[];
        proposed_matches?: unknown[];
      };
      if (payload?.error) throw new Error(payload.error);
      const n =
        typeof payload?.created === "number"
          ? payload.created
          : Array.isArray(payload?.proposed_matches)
            ? payload.proposed_matches.length
            : Array.isArray(payload?.proposed)
              ? payload.proposed.length
              : null;
      if (n === 0) {
        toast.message(
          "No proposed matches were found from approved internal sources for this trade request. Try a different trade request or approve more source data.",
        );
      } else if (n != null) {
        toast.success(
          `Sourcing complete. ${n} proposed match${n === 1 ? "" : "es"} added - advisory only.`,
        );
      } else {
        toast.success("Sourcing complete. Advisory only - no outreach was sent.");
      }
      qc.invalidateQueries({ queryKey: ["ai-proposed-matches"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(`Source failed: ${msg}`);
    } finally {
      setSourcing(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-border bg-muted/50 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          AI Launcher · platform_admin only · advisory, no outreach
        </p>
      </header>

      <div className="p-4 sm:p-5 space-y-4">
        <div className="border border-sky-200 bg-sky-50/70 rounded-sm p-3 flex gap-3">
          <Info className="h-4 w-4 text-sky-700 mt-0.5 shrink-0" strokeWidth={1.75} />
          <p className="text-[12.5px] leading-relaxed text-sky-900">
            Pick a real trade request, run <span className="font-medium">Interpret with AI</span>, then
            <span className="font-medium"> Source counterparties</span>. AI output is advisory only and
            does not contact anyone, create a POI, WaD, formal match, or assert that any organisation
            is verified.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="ai-launcher-search" className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Trade request
          </label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
            <Input
              id="ai-launcher-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by commodity, location, side, or paste trade request id…"
              className="pl-8 h-9 text-[13px]"
            />
          </div>

          <div className="border border-border rounded-sm overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">ID</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">Commodity</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">Side</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">Location</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">Status</th>
                  <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">Created</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Loading trade requests…</td></tr>
                ) : (listQuery.data ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No trade requests match your search.</td></tr>
                ) : (
                  (listQuery.data ?? []).map((r) => {
                    const isSel = r.id === selectedId;
                    return (
                      <tr key={r.id} className={`border-t border-border hover:bg-muted/30 ${isSel ? "bg-emerald-50/40" : ""}`}>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.id.slice(0, 8)}…</td>
                        <td className="px-3 py-2 text-foreground">{r.commodity ?? "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.side ?? "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.location ?? "-"}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10.5px]">{r.status ?? "-"}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant={isSel ? "default" : "outline"}
                            onClick={() => { setSelectedId(r.id); setLatestInterpretation(null); }}
                          >
                            {isSel ? "Selected" : "Select"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-border rounded-sm bg-muted/20 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Selected</span>
            {activeRow ? (
              <>
                <span className="font-mono text-[11px] text-foreground">{activeRow.id}</span>
                {activeRow.commodity ? <Badge variant="outline">{activeRow.commodity}</Badge> : null}
                {activeRow.side ? <Badge variant="outline">{activeRow.side}</Badge> : null}
                {activeRow.location ? <Badge variant="outline">{activeRow.location}</Badge> : null}
              </>
            ) : (
              <span className="text-[12px] text-muted-foreground">None - pick a trade request above.</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <LoadingButton
              loading={interpreting}
              loadingText="Interpreting…"
              disabled={!selectedId}
              onClick={handleInterpret}
              icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
              size="sm"
            >
              Interpret with AI
            </LoadingButton>
            <LoadingButton
              loading={sourcing}
              loadingText="Sourcing…"
              disabled={!selectedId}
              onClick={handleSource}
              icon={<Users className="h-3.5 w-3.5" strokeWidth={1.75} />}
              size="sm"
              variant="outline"
            >
              Source counterparties
            </LoadingButton>
            <p className="text-[11px] text-muted-foreground self-center ml-1">
              Records <span className="font-mono">ai_review.trade_request_interpreted</span> and
              <span className="font-mono"> ai_review.counterparty_sourced</span>. No outreach. No POI/WaD/match mutation.
            </p>
          </div>

          {latestInterpretation ? (
            <div className="border border-emerald-200 bg-emerald-50/50 rounded-sm p-3 space-y-1.5">
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-800">
                Latest interpretation · advisory only
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-emerald-900">
                <Row label="Commodity/service" value={latestInterpretation.commodity_or_service} />
                <Row label="Side" value={latestInterpretation.side} />
                <Row label="Geography" value={latestInterpretation.geography} />
                <Row label="Quantity" value={latestInterpretation.quantity} />
                <Row label="Timing" value={latestInterpretation.timing} />
                <Row label="AI confidence" value={latestInterpretation.ai_confidence} />
                <Row label="Commercial intent" value={latestInterpretation.commercial_intent} />
                <Row label="Preferred counterparty" value={latestInterpretation.preferred_counterparty_type} />
              </dl>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-emerald-700/80 shrink-0">{label}:</dt>
      <dd className="text-emerald-900 break-words">{value && value.trim() ? value : "-"}</dd>
    </div>
  );
}
