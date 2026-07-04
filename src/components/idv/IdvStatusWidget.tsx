/**
 * Batch V-UI — user-facing IDV status widget.
 *
 * Reads the current user's latest IDV subject state (safe wording only).
 * Never displays raw ID numbers, provider payloads, photos, selfies,
 * biometrics, or private admin notes.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { idvSafeLabel } from "./idv-status-labels";

interface IdvWidgetState {
  loading: boolean;
  status: string;
  document_label: string | null;
  updated_at: string | null;
}

export function IdvStatusWidget({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<IdvWidgetState>({
    loading: true,
    status: "no_subject",
    document_label: null,
    updated_at: null,
  });
  const [resubmitting, setResubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (!uid) {
          if (!cancelled) setState((s) => ({ ...s, loading: false }));
          return;
        }
        const { data: subject } = await supabase
          .from("p5scr_subjects")
          .select("id, display_label, updated_at")
          .eq("person_external_ref", uid)
          .maybeSingle();
        if (!subject) {
          if (!cancelled) setState({ loading: false, status: "no_subject", document_label: null, updated_at: null });
          return;
        }
        const { data: check } = await supabase
          .from("p5scr_check_results")
          .select("state, decided_at, created_at")
          .eq("subject_id", subject.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled) {
          setState({
            loading: false,
            status: (check?.state as string) ?? "pending",
            document_label: (subject.display_label as string) ?? null,
            updated_at: (check?.decided_at as string) ?? (subject.updated_at as string) ?? null,
          });
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false, status: "error" }));
      }
    })();
    return () => { cancelled = true; };
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
        {!isTerminal && (showResubmit || showStart) && (
          <Button
            asChild
            size="sm"
            variant={showResubmit ? "default" : "outline"}
            className="mt-2"
            data-testid={showResubmit ? "idv-resubmit-cta" : "idv-start-cta"}
          >
            <Link to={startHref}>{ctaLabel}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
