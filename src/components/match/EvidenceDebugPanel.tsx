/**
 * EvidenceDebugPanel - Operator-facing debug surface for the POI evidence gate.
 *
 * Renders the *exact* values returned by the `match-evidence-counts` edge
 * function (the same authoritative source the StateProgressionCard uses to
 * decide whether a strict waiver is required). This lets operators verify
 * what the backend decided, without inspecting network requests.
 *
 * Visibility: collapsed by default, gated behind a "Debug" toggle so it
 * never distracts non-technical users. Mount only in POI-mint contexts.
 */

import { useState } from "react";
import { Bug, ChevronDown, ChevronUp, RefreshCw, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import type { MatchEvidenceCounts } from "@/lib/match-evidence-counts-client";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
const FUNCTIONS_BASE = PROJECT_ID
  ? `https://${PROJECT_ID}.supabase.co/functions/v1`
  : "";

type Props = {
  matchId: string;
  data: MatchEvidenceCounts | undefined;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRefetch?: () => void;
  /** Effective UI flag (server flag OR local override). Useful to spot drift. */
  effectiveWaiverRequired?: boolean;
};

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const ageMs = Date.now() - d.getTime();
    const ageSec = Math.max(0, Math.round(ageMs / 1000));
    const ageLabel =
      ageSec < 60
        ? `${ageSec}s ago`
        : ageSec < 3600
          ? `${Math.round(ageSec / 60)}m ago`
          : `${Math.round(ageSec / 3600)}h ago`;
    return `${d.toLocaleTimeString()} · ${ageLabel}`;
  } catch {
    return iso;
  }
}

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={`text-xs text-foreground ${mono ? "font-mono" : "font-medium"}`}
        data-testid={`evidence-debug-${label.replace(/\s+/g, "-").toLowerCase()}`}
      >
        {value}
      </span>
    </div>
  );
}

export function EvidenceDebugPanel({
  matchId,
  data,
  isLoading,
  isFetching,
  error,
  onRefetch,
  effectiveWaiverRequired,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const restUrl = FUNCTIONS_BASE
    ? `${FUNCTIONS_BASE}/match-evidence-counts/matches/${matchId}/evidence`
    : `/functions/v1/match-evidence-counts/matches/${matchId}/evidence`;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(restUrl);
      setCopied(true);
      toast.success("Endpoint URL copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy URL");
    }
  };

  const drift =
    typeof effectiveWaiverRequired === "boolean" &&
    data &&
    effectiveWaiverRequired !== data.waiverRequired;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 text-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls="evidence-debug-body"
      >
        <span className="inline-flex items-center gap-2 text-xs font-semibold">
          <Bug className="h-3.5 w-3.5" />
          Evidence debug
          {data ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                data.waiverRequired
                  ? "bg-destructive/10 text-destructive"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              server waiverRequired = {String(data.waiverRequired)}
            </span>
          ) : isLoading ? (
            <span className="text-[10px] text-muted-foreground">loading…</span>
          ) : null}
          {drift && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              UI drift
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div id="evidence-debug-body" className="border-t border-border/60 px-3 py-2 space-y-0.5">
          <Row label="Match ID" value={<span className="font-mono">{matchId}</span>} />
          <Row label="Source" value={<span className="font-mono">match-evidence-counts (edge fn)</span>} />
          <div className="flex items-start justify-between gap-2 py-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">Endpoint</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <code className="text-[11px] font-mono text-foreground truncate" title={restUrl}>
                GET {restUrl}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className="inline-flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent shrink-0"
                aria-label="Copy endpoint URL"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <Row label="Fetched at" value={formatTimestamp(data?.fetchedAt)} />
          <div className="my-1 h-px bg-border/60" />
          <Row label="match_documents" value={data ? data.matchDocumentCount : "-"} mono />
          <Row label="governance_documents" value={data ? data.governanceDocumentCount : "-"} mono />
          <Row label="document_count (sum)" value={data ? data.documentCount : "-"} mono />
          <Row label="notes_count" value={data ? data.notesCount : "-"} mono />
          <Row
            label="has_supporting_evidence"
            value={data ? String(data.hasSupportingEvidence) : "-"}
            mono
          />
          <Row
            label="server waiverRequired"
            value={data ? String(data.waiverRequired) : "-"}
            mono
          />
          {typeof effectiveWaiverRequired === "boolean" && (
            <Row label="UI waiverRequired (effective)" value={String(effectiveWaiverRequired)} mono />
          )}

          {error ? (
            <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
              {error instanceof Error ? error.message : "Failed to load evidence counts."}
            </p>
          ) : null}

          {drift && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              UI is showing a different waiver decision than the server. Refetch to resync.
            </p>
          )}

          {onRefetch && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onRefetch}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 rounded border border-input bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
              >
                {isFetching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Refetch from server
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
