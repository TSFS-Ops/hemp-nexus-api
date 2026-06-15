/**
 * CounterpartyIntelPanel - system-assisted public-source intel
 * ───────────────────────────────────────────────────────────
 * Daniel Davies, 2026-04-27 clarification (binding directive):
 *
 *   "The light compliance / public-source check should not be a manual
 *    capture exercise where the user types in website links, LinkedIn
 *    links, notes, and similar items themselves. […] It must remain
 *    light, and it must remain pre-POI, but it should be system-assisted
 *    rather than user-assembled."
 *
 * This panel is therefore a READ-ONLY intel surface:
 *   • On first open (per match/side), the platform automatically runs
 *     a light public-source sketch via the `counterparty-intel-auto`
 *     edge function (Lovable AI Gateway → conservative tool-call).
 *   • The user sees: a 1–3 sentence summary, best-guess website,
 *     best-guess LinkedIn, and any other public source links the
 *     model surfaced - together with a confidence badge and the
 *     timestamp of the last run.
 *   • A single "Refresh" button re-runs the sketch.
 *   • There are NO input fields. Nothing is user-assembled.
 *
 * Hard verification (KYB / IDV / UBO / ATB) remains a strict WaD-stage
 * wall and is unaffected by anything in this file.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { EdgeInvokeError, fetchEdgeFunction } from "@/lib/edge-invoke";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Globe,
  Linkedin,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  ExternalLink,
  Newspaper,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Match } from "@/hooks/use-match-details";

type Side = "buyer" | "seller";
type AutoStatus = "pending" | "ready" | "failed" | "unavailable";

interface AutoSource {
  label: string;
  url: string;
  kind: "website" | "linkedin" | "news" | "registry" | "other";
}

interface IntelRow {
  id: string;
  match_id: string;
  org_id: string;
  side: Side;
  counterparty_name: string;
  website_url: string | null;
  linkedin_url: string | null;
  notes: string | null;
  auto_summary: string | null;
  auto_sources: AutoSource[] | null;
  auto_generated_at: string | null;
  auto_status: AutoStatus;
  updated_at: string;
}

// ────────────────────────────────────────────────────────────────────────
// Side card
// ────────────────────────────────────────────────────────────────────────
function kindIcon(kind: AutoSource["kind"]) {
  switch (kind) {
    case "website":
      return <Globe className="h-3.5 w-3.5" />;
    case "linkedin":
      return <Linkedin className="h-3.5 w-3.5" />;
    case "news":
      return <Newspaper className="h-3.5 w-3.5" />;
    case "registry":
      return <FileText className="h-3.5 w-3.5" />;
    default:
      return <ExternalLink className="h-3.5 w-3.5" />;
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

interface SidePanelProps {
  match: Match;
  side: Side;
  counterpartyName: string;
  isRegistered: boolean;
  intel: IntelRow | undefined;
  onRefreshed: () => void;
  canRunIntel: boolean;
  // Trigger an automatic first-run if the row is absent.
  autoRunIfMissing: boolean;
}

function SidePanel({
  match,
  side,
  counterpartyName,
  isRegistered,
  intel,
  onRefreshed,
  canRunIntel,
  autoRunIfMissing,
}: SidePanelProps) {
  const [running, setRunning] = useState(false);
  const autoRanRef = useRef(false);

  const runIntel = async () => {
    if (running) return;
    if (!canRunIntel) {
      toast.error("Please wait for your sign-in session to finish loading, then retry Refresh.");
      return;
    }
    setRunning(true);
    try {
      await fetchEdgeFunction("counterparty-intel-auto", {
        method: "POST",
        body: { match_id: match.id, side },
        requireSession: false,
        label: "auto-generate counterparty intel",
      });
      toast.success(`${side === "buyer" ? "Buyer" : "Seller"} intel refreshed`);
      onRefreshed();
    } catch (e: any) {
      if (e instanceof EdgeInvokeError && ["NO_SESSION", "REFRESH_FAILED", "UNAUTHORIZED"].includes(e.code ?? "")) {
        toast.error("Could not refresh intel: Please refresh the page and try again.");
        return;
      }
      toast.error(`Could not refresh intel: ${e?.message ?? "unknown error"}`);
    } finally {
      setRunning(false);
    }
  };

  // First-run automation: if there is no row at all (or the row is still
  // 'pending' from a prior tab close), kick off the system-assisted
  // sketch automatically. The user does nothing.
  useEffect(() => {
    if (autoRanRef.current) return;
    if (!autoRunIfMissing) return;
    const needsRun = !intel || intel.auto_status === "pending";
    if (needsRun && !running) {
      autoRanRef.current = true;
      void runIntel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunIfMissing, intel?.auto_status]);

  const status: AutoStatus = intel?.auto_status ?? "pending";
  const summary = intel?.auto_summary;
  const sources = intel?.auto_sources ?? [];
  const website = intel?.website_url;
  const linkedin = intel?.linkedin_url;

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {side === "buyer" ? "Buyer" : "Seller"}: {counterpartyName || "-"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isRegistered
              ? "Registered on platform - auto-intel is informational."
              : "Not yet registered - system has run a light public-source sketch."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={isRegistered ? "secondary" : "outline"} className="text-[10px]">
            {isRegistered ? "Registered" : "Named only"}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={runIntel}
            disabled={running || !canRunIntel}
            className="h-7 px-2 text-xs"
            title="Re-run automatic public-source sketch"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* ── Pending state ─────────────────────────────── */}
      {status === "pending" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Running light public-source sketch…
        </div>
      )}

      {/* ── Unavailable state (AI gateway off) ────────── */}
      {status === "unavailable" && (
        <p className="text-xs text-muted-foreground">
          Automatic public-source check is not configured on this environment.
          Intel is informational only - you can still proceed to POI.
        </p>
      )}

      {/* ── Failed state ──────────────────────────────── */}
      {status === "failed" && (
        <p className="text-xs text-muted-foreground">
          The automatic check could not complete this time. Use Refresh to retry.
          Intel is informational - not a block on POI.
        </p>
      )}

      {/* ── Ready state ───────────────────────────────── */}
      {status === "ready" && (
        <div className="space-y-3">
          {summary && (
            <p className="text-sm text-foreground/90 leading-relaxed">{summary}</p>
          )}

          {(website || linkedin || sources.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
                >
                  <Globe className="h-3 w-3" /> Website <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              )}
              {linkedin && (
                <a
                  href={linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
                >
                  <Linkedin className="h-3 w-3" /> LinkedIn <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              )}
              {sources
                .filter((s) => {
                  // Don't duplicate website/linkedin we already showed.
                  if (s.kind === "website" && website) return false;
                  if (s.kind === "linkedin" && linkedin) return false;
                  return true;
                })
                .map((s, i) => (
                  <a
                    key={`${s.url}-${i}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs hover:bg-accent max-w-[16rem] truncate"
                    title={s.label}
                  >
                    {kindIcon(s.kind)}
                    <span className="truncate">{s.label || s.url}</span>
                    <ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                  </a>
                ))}
            </div>
          )}

          {!summary && !website && !linkedin && sources.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No public footprint located. The counterparty may simply have a
              limited online presence - this is informational only.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Auto-generated • last run {relativeTime(intel?.auto_generated_at ?? null)}
          </p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Top-level panel
// ────────────────────────────────────────────────────────────────────────
export function CounterpartyIntelPanel({ match }: { match: Match }) {
  const queryClient = useQueryClient();
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const matchType = (match as any).match_type;
  const isUnilateral = matchType === "unilateral";
  const canRunIntel = !authLoading && isAuthenticated;

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["counterparty-intel", match.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_counterparty_intel")
        .select("*")
        .eq("match_id", match.id);
      if (error) throw error;
      return (data ?? []) as unknown as IntelRow[];
    },
    enabled: canRunIntel,
    refetchOnWindowFocus: false,
  });

  const buyerIntel = useMemo(() => rows.find((r) => r.side === "buyer"), [rows]);
  const sellerIntel = useMemo(() => rows.find((r) => r.side === "seller"), [rows]);

  const handleRefreshed = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["counterparty-intel", match.id] });
  };

  // Hide entirely if there are no parties at all (e.g. wide-open unilateral draft).
  if (!match.buyer_name && !match.seller_name) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
          Counterparty intel - system-assisted public-source check
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1.5">
          The platform automatically runs a light public-source sketch of each
          named counterparty. No paid lookups, no formal onboarding, nothing
          for you to fill in. Hard verification (KYB / IDV) is required only at
          the WaD stage, not now.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
        {!isUnilateral && match.buyer_name && (
          <SidePanel
            match={match}
            side="buyer"
            counterpartyName={match.buyer_name}
            isRegistered={!!(match as any).buyer_id}
            intel={buyerIntel}
            onRefreshed={handleRefreshed}
            canRunIntel={canRunIntel}
            autoRunIfMissing={canRunIntel && !isLoading}
          />
        )}
        {!isUnilateral && match.seller_name && (
          <SidePanel
            match={match}
            side="seller"
            counterpartyName={match.seller_name}
            isRegistered={!!(match as any).seller_id}
            intel={sellerIntel}
            onRefreshed={handleRefreshed}
            canRunIntel={canRunIntel}
            autoRunIfMissing={canRunIntel && !isLoading}
          />
        )}
        {isUnilateral && (
          <p className="text-sm text-muted-foreground">
            Unilateral intent - only the declaring party is on record. The
            system will run a public-source sketch once a counterparty is named.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
