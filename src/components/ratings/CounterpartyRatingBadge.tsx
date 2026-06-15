/**
 * CounterpartyRatingBadge - institutional-premium trust signal.
 *
 * Bands (deterministic, derived):
 *   platinum / gold / silver / bronze / new / insufficient_history
 *
 * Click opens a transparency popover showing the four-pillar breakdown,
 * sample size, methodology version, and last-computed timestamp.
 *
 * Rendering rules:
 *   - Below min_sample_size settled deals → "Insufficient history".
 *   - No row at all → "Unrated" placeholder (never imply 100/100).
 *   - All colours from semantic tokens; band tone driven by --emerald, etc.
 */

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  orgId: string | null | undefined;
  /** Compact = badge only (for tables/lists). Full = chip + label. */
  variant?: "compact" | "full";
  className?: string;
}

interface RatingRow {
  org_id: string;
  methodology_version: number;
  reliability_score: number | null;
  responsiveness_score: number | null;
  compliance_score: number | null;
  settlement_score: number | null;
  overall_score: number | null;
  band: string;
  sample_size: number;
  recent_sample_size: number;
  signals_summary: Record<string, unknown>;
  computed_at: string;
}

const BAND_META: Record<string, { label: string; tone: string; ring: string; icon: typeof ShieldCheck }> = {
  platinum:              { label: "Platinum",              tone: "text-emerald-700 bg-emerald-50 border-emerald-200",     ring: "ring-emerald-300", icon: ShieldCheck },
  gold:                  { label: "Gold",                  tone: "text-amber-800 bg-amber-50 border-amber-200",           ring: "ring-amber-300",   icon: ShieldCheck },
  silver:                { label: "Silver",                tone: "text-slate-700 bg-slate-50 border-slate-200",           ring: "ring-slate-300",   icon: ShieldCheck },
  bronze:                { label: "Bronze",                tone: "text-orange-800 bg-orange-50 border-orange-200",        ring: "ring-orange-300",  icon: ShieldCheck },
  new:                   { label: "New",                   tone: "text-blue-700 bg-blue-50 border-blue-200",              ring: "ring-blue-300",    icon: ShieldQuestion },
  insufficient_history:  { label: "Insufficient history",  tone: "text-muted-foreground bg-muted border-border",           ring: "ring-muted",       icon: ShieldQuestion },
  unrated:               { label: "Unrated",               tone: "text-muted-foreground bg-muted border-border",           ring: "ring-muted",       icon: ShieldAlert },
};

function PillarBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono text-muted-foreground">-</span>
        </div>
        <div className="h-1.5 rounded-sm bg-muted" />
      </div>
    );
  }
  const pct = Math.round(value);
  const tone =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 60 ? "bg-amber-500" :
    pct >= 40 ? "bg-orange-500" : "bg-destructive";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{pct}</span>
      </div>
      <div className="h-1.5 rounded-sm bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CounterpartyRatingBadge({ orgId, variant = "full", className }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["counterparty-rating", orgId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("counterparty_ratings")
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data as RatingRow | null;
    },
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

  if (!orgId) return null;
  if (isLoading) {
    return <Badge variant="outline" className={cn("font-mono text-[10px] tracking-widest", className)}>…</Badge>;
  }

  const band = data?.band ?? "unrated";
  const meta = BAND_META[band] ?? BAND_META.unrated;
  const Icon = meta.icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-xs font-medium transition-all hover:ring-2",
            meta.tone,
            meta.ring,
            className,
          )}
          aria-label={`Counterparty rating: ${meta.label}. Click for breakdown.`}
        >
          <Icon className="h-3 w-3" strokeWidth={2} />
          {variant === "full" && <span>{meta.label}</span>}
          {variant === "compact" && (
            <span className="font-mono text-[10px] uppercase tracking-wider">{meta.label.charAt(0)}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4">
        <div className="space-y-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">
              Counterparty Rating
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold">{meta.label}</span>
              {data?.overall_score !== null && data?.overall_score !== undefined && (
                <span className="font-mono text-sm text-muted-foreground">
                  {Math.round(data.overall_score)} / 100
                </span>
              )}
            </div>
          </div>

          {!data && (
            <p className="text-xs text-muted-foreground">
              No rating computed yet. Ratings are derived nightly from on-platform activity.
            </p>
          )}

          {data && (
            <>
              <div className="space-y-2.5">
                <PillarBar label="Reliability"     value={data.reliability_score} />
                <PillarBar label="Responsiveness"  value={data.responsiveness_score} />
                <PillarBar label="Compliance"      value={data.compliance_score} />
                <PillarBar label="Settlement"      value={data.settlement_score} />
              </div>

              <div className="border-t border-border pt-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Settled deals</span>
                  <span className="font-mono">{data.sample_size}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recent (12mo)</span>
                  <span className="font-mono">{data.recent_sample_size}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Methodology</span>
                  <span className="font-mono">v{data.methodology_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Computed</span>
                  <span className="font-mono">{new Date(data.computed_at).toLocaleDateString()}</span>
                </div>
              </div>

              {data.band === "insufficient_history" && (
                <p className="text-xs text-muted-foreground border-t border-border pt-3">
                  Not enough settled deals to issue a rated band. Continue trading to build a track record.
                </p>
              )}
            </>
          )}

          <p className="text-[10px] text-muted-foreground border-t border-border pt-3 leading-relaxed">
            Derived from on-platform activity. No free-text reviews. Time-decayed,
            sample-size guarded, audit-grade. Rating may be appealed by the rated organisation.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
