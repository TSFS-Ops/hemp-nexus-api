/**
 * Batch V-UI -- user-facing IDV status widget.
 *
 * Reads the current user's latest IDV subject state (safe wording only).
 * Never displays raw ID numbers, provider payloads, photos, selfies,
 * biometrics, or private admin notes.
 *
 * Polling: after a resubmission (widget CTA or start-screen `?resubmit=1`),
 * the widget polls the server every few seconds until the status reaches
 * a terminal or actionable state, or until POLL_MAX_ATTEMPTS is reached.
 *
 * Batch V-UI-Fix-4: reads the latest state from `p5scr_idv_records`
 * (the gate-readable table that `idv-person-verify` and
 * `idv-manual-review` both write to) instead of `p5scr_check_results`,
 * which nothing in the person-IDV flow writes to. This is the fix for
 * "widget reading from a table that nothing writes to".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { idvSafeLabel } from "./idv-status-labels";

interface IdvWidgetState {
  loading: boolean;
  status: string;
  document_label: string | null;
  updated_at: string | null;
  resubmit_reason: string | null;
  resubmit_source: string | null;
  resubmit_at: string | null;
}

// Polling stops as soon as the status is anything other than an
// actively-in-flight provider state. Terminal-good, terminal-bad, and
// "waiting on user/admin" states all halt polling.
const ACTIVE_POLL_STATES = new Set(["pending", "provider_pending", "idv_pending", "screening_pending"]);
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~60s total

interface IdvStatusWidgetProps {
  className?: string;
  /** When true, start polling immediately on mount (used by the start screen). */
  pollOnMount?: boolean;
}

export function IdvStatusWidget({ className, pollOnMount = false }: IdvStatusWidgetProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<IdvWidgetState>({
    loading: true,
    status: "no_subject",
    document_label: null,
    updated_at: null,
    resubmit_reason: null,
    resubmit_source: null,
    resubmit_at: null,
  });
  const [resubmitting, setResubmitting] = useState(false);
  const [polling, setPolling] = useState(false);

  const cancelledRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptsRef = useRef(0);

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const loadStatus = useCallback(async (): Promise<string> => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        if (!cancelledRef.current) setState((s) => ({ ...s, loading: false }));
        return "no_subject";
      }
      const { data: subject } = await supabase
        .from("p5scr_subjects")
        .select("id, display_label, updated_at")
        .eq("person_external_ref", uid)
        .maybeSingle();

      const { data: intent } = await supabase
        .from("idv_resubmit_intents")
        .select("reason, source, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!subject) {
        const resolved = intent?.reason ? (intent.reason as string) : "no_subject";
        if (!cancelledRef.current) setState({
          loading: false,
          status: resolved,
          document_label: null,
          updated_at: (intent?.created_at as string) ?? null,
          resubmit_reason: (intent?.reason as string) ?? null,
          resubmit_source: (intent?.source as string) ?? null,
          resubmit_at: (intent?.created_at as string) ?? null,
        });
        return resolved;
      }

      // Batch V-UI-Fix-4: read the gate-readable p5scr_idv_records table,
      // not p5scr_check_results (which nothing in this flow writes to).
      const { data: record } = await supabase
        .from("p5scr_idv_records")
        .select("state, decided_at, created_at")
        .eq("subject_id", subject.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const recordAt = (record?.decided_at as string) ?? (record?.created_at as string) ?? null;
      const intentAt = (intent?.created_at as string) ?? null;
      const preferIntent =
        !!intentAt && (!recordAt || new Date(intentAt).getTime() > new Date(recordAt).getTime());

      const resolvedStatus = preferIntent
        ? (intent!.reason as string)
        : ((record?.state as string) ?? "pending");
      const resolvedUpdatedAt = preferIntent
        ? intentAt
        : (recordAt ?? (subject.updated_at as string) ?? null);

      if (!cancelledRef.current) {
        setState({
          loading: false,
          status: resolvedStatus,
          document_label: (subject.display_label as string) ?? null,
          updated_at: resolvedUpdatedAt,
          resubmit_reason: (intent?.reason as string) ?? null,
          resubmit_source: (intent?.source as string) ?? null,
          resubmit_at: intentAt,
        });
      }
      return resolvedStatus;
    } catch {
      if (!cancelledRef.current) setState((s) => ({ ...s, loading: false, status: "error" }));
      return "error";
    }
  }, []);

  const startPolling = useCallback(() => {
    clearPollTimer();
    pollAttemptsRef.current = 0;
    setPolling(true);
    const tick = async () => {
      pollAttemptsRef.current += 1;
      const status = await loadStatus();
      if (cancelledRef.current) return;
      const shouldContinue =
        ACTIVE_POLL_STATES.has(status) && pollAttemptsRef.current < POLL_MAX_ATTEMPTS;
      if (shouldContinue) {
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      } else {
        setPolling(false);
      }
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
  }, [loadStatus]);

  // Initial load + optional poll-on-mount (used after a resubmit navigation).
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      const status = await loadStatus();
      if (cancelledRef.current) return;
      if (pollOnMount && ACTIVE_POLL_STATES.has(status)) {
        startPolling();
      }
    })();
    return () => {
      cancelledRef.current = true;
      clearPollTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safe = idvSafeLabel(state.status);

  const RESUBMIT_STATES = new Set([
    "retry_required",
    "alternative_document_required",
    "failed",
    "expired",
    "error",
    "provider_error",
  ]);
  const START_STATES = new Set(["no_subject"]);
  const showResubmit = RESUBMIT_STATES.has(state.status);
  const showStart = START_STATES.has(state.status);
  const isTerminal = state.status === "idv_completed" || state.status === "manual_review_accepted";
  const startHref = showResubmit
    ? `/desk/idv/start?resubmit=1&reason=${encodeURIComponent(state.status)}`
    : "/desk/idv/start";
  const ctaLabel = showResubmit
    ? state.status === "alternative_document_required"
      ? "Submit alternative document"
      : "Retry identity verification"
    : "Start identity verification";

  return (
    <Card className={className} data-testid="idv-status-widget">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Identity verification
        </CardTitle>
        <Badge variant="secondary" data-testid="idv-status-badge">{safe.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {state.document_label && (
          <div>
            <span className="text-muted-foreground">Submission:</span>{" "}
            <span className="font-medium">{state.document_label}</span>
          </div>
        )}
        {safe.next_action && (
          <div className="text-muted-foreground">{safe.next_action}</div>
        )}
        {state.updated_at && (
          <div className="text-xs text-muted-foreground">
            Last updated {new Date(state.updated_at).toLocaleString()}
          </div>
        )}
        {polling && (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="idv-polling-indicator"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking for updates…
          </div>
        )}
        {!isTerminal && (showResubmit || showStart) && (
          showResubmit ? (
            <Button
              size="sm"
              variant="default"
              className="mt-2"
              disabled={resubmitting || polling}
              data-testid="idv-resubmit-cta"
              onClick={async () => {
                setResubmitting(true);
                try {
                  const { data, error } = await supabase.functions.invoke(
                    "idv-resubmit",
                    { body: { reason: state.status, source: "status_widget" } },
                  );
                  if (error) {
                    toast.error("Could not start a resubmission. Please try again.");
                    return;
                  }
                  const next = (data as { next_route?: string } | null)?.next_route
                    ?? `/desk/idv/start?resubmit=1&reason=${encodeURIComponent(state.status)}`;
                  toast.success("Resubmission started. Please complete the form.");
                  // Refresh status and begin polling in case the server is
                  // already transitioning to a pending provider state.
                  await loadStatus();
                  startPolling();
                  navigate(next);
                } catch {
                  toast.error("Could not start a resubmission. Please try again.");
                } finally {
                  setResubmitting(false);
                }
              }}
            >
              {resubmitting ? "Starting…" : ctaLabel}
            </Button>
          ) : (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="mt-2"
              data-testid="idv-start-cta"
            >
              <Link to={startHref}>{ctaLabel}</Link>
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}
