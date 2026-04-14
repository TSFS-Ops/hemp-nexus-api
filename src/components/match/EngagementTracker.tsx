import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Clock, Mail, Phone, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EngagementTrackerProps {
  matchId: string;
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
  stepKey: string,
  currentStatus: EngagementStatus,
  stepIndex: number
): "complete" | "current" | "upcoming" | "terminal" {
  const statusOrder: EngagementStatus[] = ["notification_sent", "contacted", "accepted"];
  const currentIndex = statusOrder.indexOf(currentStatus);

  if (currentStatus === "declined" || currentStatus === "expired") {
    const reachedIndex = currentStatus === "declined" || currentStatus === "expired"
      ? statusOrder.indexOf("contacted")
      : -1;
    if (stepIndex <= reachedIndex) return "complete";
    return "terminal";
  }

  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

export function EngagementTracker({ matchId }: EngagementTrackerProps) {
  const { data: engagement, isLoading } = useQuery({
    queryKey: ["engagement-tracker", matchId],
    queryFn: async () => {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/poi-engagements/by-match/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );
      if (!response.ok) return null;
      const result = await response.json();
      return result?.engagement || null;
    },
    refetchInterval: 30000, // Poll every 30s for updates
  });

  if (isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (!engagement) return null;

  const status: EngagementStatus = engagement.engagement_status;
  const isTerminal = status === "declined" || status === "expired";
  const terminalInfo = isTerminal ? TERMINAL_OVERRIDES[status] : null;

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
      </CardContent>
    </Card>
  );
}
