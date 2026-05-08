import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchEdgeFunction, EdgeInvokeError } from "@/lib/edge-invoke";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Clock, Mail, Phone, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
interface EngagementTrackerProps {
  matchId: string;
  /** The parent match object, used to pre-fill the re-use form */
  match?: {
    commodity?: string | null;
    quantity_amount?: number | null;
    quantity_unit?: string | null;
    price_amount?: number | null;
    price_currency?: string | null;
    match_type?: string | null;
    metadata?: unknown;
    trade_request_id?: string | null;
  };
}
type EngagementStatus =
  | "notification_sent"
  | "contacted"
  | "accepted"
  | "declined"
  | "expired"
  | "late_acceptance_pending_initiator_reconfirmation";
const STEPS = [{
  key: "notification_sent" as const,
  label: "Awaiting outreach",
  icon: Mail
}, {
  key: "contacted" as const,
  label: "Contacted",
  icon: Phone
}, {
  key: "accepted" as const,
  label: "Accepted",
  icon: Check
}] as const;
const TERMINAL_OVERRIDES: Record<string, {
  label: string;
  icon: typeof XCircle;
}> = {
  declined: {
    label: "Declined",
    icon: XCircle
  },
  expired: {
    label: "Expired",
    icon: AlertTriangle
  },
  // Batch B Phase 5: late acceptance recorded after the engagement window
  // elapsed. We render this as a terminal-shaped step (workflow does NOT
  // progress) but with explicit late-acceptance wording so the trader
  // never sees a bare "Accepted" pip implying mutual acceptance.
  late_acceptance_pending_initiator_reconfirmation: {
    label: "Late acceptance — awaiting reconfirmation",
    icon: AlertTriangle
  }
};
function getStepState(_stepKey: string, currentStatus: EngagementStatus, stepIndex: number): "complete" | "current" | "upcoming" | "terminal" {
  const statusOrder: EngagementStatus[] = ["notification_sent", "contacted", "accepted"];
  const currentIndex = statusOrder.indexOf(currentStatus);
  if (
    currentStatus === "declined" ||
    currentStatus === "expired" ||
    currentStatus === "late_acceptance_pending_initiator_reconfirmation"
  ) {
    const reachedIndex = statusOrder.indexOf("contacted");
    if (stepIndex <= reachedIndex) return "complete";
    return "terminal";
  }
  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}
export function EngagementTracker({
  matchId,
  match
}: EngagementTrackerProps) {
  const navigate = useNavigate();
  const {
    data: engagement,
    isLoading,
    isError
  } = useQuery({
    queryKey: ["engagement-tracker", matchId],
    queryFn: async () => {
      try {
        // Batch B Phase 1: consume the canonical read-model envelope and
        // operate strictly on `current_engagement`. Historical (expired /
        // declined) rows are intentionally NOT used to drive the live
        // status stepper.
        const result = await fetchEdgeFunction<unknown>(
          `poi-engagements/by-match/${matchId}`,
          { method: "GET", label: "load engagement status" },
        );
        const { parseByMatchResponse } = await import("@/lib/engagement-read-model");
        const model = parseByMatchResponse(result);
        return (model.current_engagement ?? null) as
          | { engagement_status: EngagementStatus; counterparty_type?: string }
          | null;
      } catch (err) {
        if (err instanceof EdgeInvokeError && err.code === "UNAUTHORIZED") {
          throw new Error("SESSION_EXPIRED");
        }
        if (err instanceof EdgeInvokeError && err.status && err.status >= 400 && err.status < 500) {
          return null;
        }
        throw err;
      }
    },
    refetchInterval: 30000,
    retry: (failureCount, error) => {
      if (error?.message === "SESSION_EXPIRED") return false;
      return failureCount < 2;
    }
  });
  if (isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }
  if (isError) {
    return <Card className="border-dashed border-destructive/40">
        <CardContent className="py-3 px-4">
          <p className="text-xs text-destructive"> Unable to load engagement status. Your session may have expired, {" "}
            <a href="/auth" className="underline font-medium">sign in again</a>.
          </p>
        </CardContent>
      </Card>;
  }
  if (!engagement) return null;
  const status: EngagementStatus = engagement.engagement_status;
  const counterpartyType: string = engagement.counterparty_type || "unknown";
  const isTerminal =
    status === "declined" ||
    status === "expired" ||
    status === "late_acceptance_pending_initiator_reconfirmation";
  const terminalInfo = isTerminal ? TERMINAL_OVERRIDES[status] : null;

  /** Navigate to the trade form pre-filled with the current match's details.
   *  If a trade_request_id exists, pass it so the new match links to the same
   *  persistent trade request (no data loss, no re-entry). */
  const handleReuse = () => {
    const meta = match?.metadata as Record<string, unknown> | undefined;
    // `tradeSide` / `bidOfferSide` (legacy) on a match's metadata represent the
    // INITIATOR's own side at the time the match was created (creator-owned, not
    // counterparty-owned). We only forward it when explicitly present — never
    // silently default to "buyer", or a seller's reuse would pre-fill as buyer.
    // If absent, omit the param so the trade form requires explicit user selection.
    const rawSide = (meta?.tradeSide ?? meta?.bidOfferSide) as unknown;
    const initiatorTradeSide =
      rawSide === "buyer" || rawSide === "seller" ? rawSide : null;
    const isUnilateral = match?.match_type === "unilateral";
    const params = new URLSearchParams();
    if (match?.commodity) params.set("commodity", match.commodity);
    if (match?.quantity_amount) params.set("quantity", String(match.quantity_amount));
    if (match?.quantity_unit) params.set("unit", match.quantity_unit);
    if (match?.price_amount) params.set("price", String(match.price_amount));
    if (match?.price_currency) params.set("currency", match.price_currency);
    if (initiatorTradeSide) params.set("side", initiatorTradeSide);
    if (match?.trade_request_id) params.set("trade_request_id", match.trade_request_id);
    const target = isUnilateral ? `${ROUTES.DASHBOARD}?section=unilateral&${params.toString()}` : `${ROUTES.DASHBOARD}?section=bilateral&${params.toString()}`;
    navigate(target);
  };
  return (
    <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground font-medium truncate">
            Counterparty engagement
          </p>
        </div>
        {!isTerminal && (
          <span className="text-[10px] font-medium text-muted-foreground shrink-0">
            {STEPS.findIndex((s) => s.key === status) + 1}/3
          </span>
        )}
      </div>

      {/* Compact horizontal micro-stepper — visually distinct from the macro WizardStepper */}
      <div className="flex items-center gap-1.5">
        {STEPS.map((step, index) => {
          const state = getStepState(step.key, status, index);
          if (isTerminal && step.key === "accepted" && terminalInfo) {
            return (
              <div key={step.key} className="flex items-center gap-1.5 flex-1 min-w-0">
                {index > 0 && <div className="h-px flex-1 bg-destructive/30" />}
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium">
                  <terminalInfo.icon className="h-3 w-3" />
                  <span>{terminalInfo.label}</span>
                </div>
              </div>
            );
          }
          return (
            <div key={step.key} className="flex items-center gap-1.5 flex-1 min-w-0">
              {index > 0 && (
                <div
                  className={cn(
                    "h-px flex-1 transition-colors",
                    state === "complete" ? "bg-primary/60" : "bg-border",
                  )}
                />
              )}
              <div
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap",
                  state === "complete" && "bg-primary/10 text-primary border-primary/20",
                  state === "current" && "bg-card text-foreground border-primary/40 shadow-sm",
                  state === "upcoming" && "bg-transparent text-muted-foreground/70 border-border",
                )}
              >
                {state === "complete" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <step.icon className="h-3 w-3" />
                )}
                <span>{step.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground mt-2.5 leading-snug">
        {status === "notification_sent" &&
          (counterpartyType === "known"
            ? "Trading partner notified directly. Awaiting their response."
            : "Trading partner notified. Awaiting engagement.")}
        {status === "contacted" &&
          (counterpartyType === "known"
            ? "Trading partner has been contacted. Awaiting their response."
            : "Support has contacted the trading partner. Awaiting their response.")}
        {status === "accepted" && "Trading partner has accepted. You may proceed."}
        {status === "declined" &&
          "Trading partner declined this trade. Re-use details to approach a different partner."}
        {status === "expired" &&
          "This engagement has expired. Re-use details to try a different partner."}
      </p>

      {isTerminal && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2.5 w-full sm:w-auto h-7 text-xs"
          onClick={handleReuse}
        >
          <RotateCcw className="h-3 w-3 mr-1.5" />
          Re-use trade details
        </Button>
      )}
    </div>
  );
}