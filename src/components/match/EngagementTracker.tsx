import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Clock, Mail, Phone, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";

interface EngagementTrackerProps {
  matchId: string;
  /** The parent match object — used to pre-fill the re-use form */
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

type EngagementStatus = "notification_sent" | "contacted" | "accepted" | "declined" | "expired";

const STEPS = [
  { key: "notification_sent" as const, label: "Notification Sent", icon: Mail },
  { key: "contacted" as const, label: "Contacted", icon: Phone },
  { key: "accepted" as const, label: "Accepted", icon: Check },
] as const;

const TERMINAL_OVERRIDES: Record<string, { label: string; icon: typeof XCircle }> = {
  declined: { label: "Declined", icon: XCircle },
  expired: { label: "Expired", icon: AlertTriangle },
};

function getStepState(
  _stepKey: string,
  currentStatus: EngagementStatus,
  stepIndex: number
): "complete" | "current" | "upcoming" | "terminal" {
  const statusOrder: EngagementStatus[] = ["notification_sent", "contacted", "accepted"];
  const currentIndex = statusOrder.indexOf(currentStatus);

  if (currentStatus === "declined" || currentStatus === "expired") {
    const reachedIndex = statusOrder.indexOf("contacted");
    if (stepIndex <= reachedIndex) return "complete";
    return "terminal";
  }

  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

export function EngagementTracker({ matchId, match }: EngagementTrackerProps) {
  const navigate = useNavigate();

  const { data: engagement, isLoading, isError } = useQuery({
    queryKey: ["engagement-tracker", matchId],
    queryFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error("SESSION_EXPIRED");
      }
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/poi-engagements/by-match/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );
      if (response.status === 401) {
        throw new Error("SESSION_EXPIRED");
      }
      if (!response.ok) return null;
      const result = await response.json();
      return result?.engagement || null;
    },
    refetchInterval: 30000,
    retry: (failureCount, error) => {
      if (error?.message === "SESSION_EXPIRED") return false;
      return failureCount < 2;
    },
  });

  if (isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (isError) {
    return (
      <Card className="border-dashed border-destructive/40">
        <CardContent className="py-3 px-4">
          <p className="text-xs text-destructive">
            Unable to load engagement status. Your session may have expired —{" "}
            <a href="/auth" className="underline font-medium">sign in again</a>.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!engagement) return null;

  const status: EngagementStatus = engagement.engagement_status;
  const isTerminal = status === "declined" || status === "expired";
  const terminalInfo = isTerminal ? TERMINAL_OVERRIDES[status] : null;

  /** Navigate to the trade form pre-filled with the current match's details */
  const handleReuse = () => {
    const meta = match?.metadata as Record<string, unknown> | undefined;
    const side = (meta?.tradeSide as string) || (meta?.bidOfferSide as string) || "buyer";
    const isUnilateral = match?.match_type === "unilateral";

    // Build query params that the form can read
    const params = new URLSearchParams();
    if (match?.commodity) params.set("commodity", match.commodity);
    if (match?.quantity_amount) params.set("quantity", String(match.quantity_amount));
    if (match?.quantity_unit) params.set("unit", match.quantity_unit);
    if (match?.price_amount) params.set("price", String(match.price_amount));
    if (match?.price_currency) params.set("currency", match.price_currency);
    if (side) params.set("side", side);

    const target = isUnilateral
      ? `${ROUTES.DASHBOARD}?section=unilateral&${params.toString()}`
      : `${ROUTES.DASHBOARD}?section=bilateral&${params.toString()}`;

    navigate(target);
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Counterparty Engagement
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex items-center gap-0">
          {STEPS.map((step, index) => {
            const state = getStepState(step.key, status, index);

            // If terminal and this is the "accepted" step, show the terminal override
            if (isTerminal && step.key === "accepted" && terminalInfo) {
              const TermIcon = terminalInfo.icon;
              return (
                <div key={step.key} className="flex items-center">
                  {index > 0 && (
                    <div className={cn(
                      "w-6 sm:w-10 h-0.5",
                      "bg-destructive/30"
                    )} />
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center border-2",
                      "border-destructive bg-destructive/10 text-destructive"
                    )}>
                      <TermIcon className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] text-destructive font-medium text-center max-w-[70px]">
                      {terminalInfo.label}
                    </span>
                  </div>
                </div>
              );
            }

            const StepIcon = step.icon;

            return (
              <div key={step.key} className="flex items-center">
                {index > 0 && (
                  <div className={cn(
                    "w-6 sm:w-10 h-0.5 transition-colors",
                    state === "complete" ? "bg-primary" :
                    state === "current" ? "bg-primary/40" :
                    "bg-muted"
                  )} />
                )}
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors",
                    state === "complete" ? "border-primary bg-primary text-primary-foreground" :
                    state === "current" ? "border-primary bg-primary/10 text-primary" :
                    "border-muted bg-muted/30 text-muted-foreground"
                  )}>
                    {state === "complete" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <StepIcon className="h-4 w-4" />
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium text-center max-w-[70px]",
                    state === "complete" ? "text-primary" :
                    state === "current" ? "text-foreground" :
                    "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Status message */}
        <p className="text-xs text-muted-foreground mt-3">
          {status === "notification_sent" && "Your counterparty has been notified. Waiting for engagement."}
          {status === "contacted" && "Support has contacted the counterparty. Awaiting their response."}
          {status === "accepted" && "Counterparty has accepted. You may proceed with the trade."}
          {status === "declined" && "Counterparty declined this trade. You can re-use your trade details to approach a different counterparty."}
          {status === "expired" && "This engagement has expired. You can re-use your trade details to try a different counterparty."}
        </p>

        {/* Re-use CTA for terminal states */}
        {isTerminal && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full sm:w-auto"
            onClick={handleReuse}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Re-use Trade Details
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
