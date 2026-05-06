/**
 * UnknownCounterpartyStatus — Timeline panel surfacing the lifecycle of a POI
 * issued against an off-platform counterparty.
 *
 * Renders only when the engagement exists and the counterparty is not yet on
 * the platform (counterparty_type === "unknown" OR counterparty_org_id is null
 * while the engagement is in a pre-linked status).
 *
 * Three states tracked:
 *   1. Support desk notified            (always true once engagement exists)
 *   2. Outreach email sent to partner   (engagement_status === "contacted" | "accepted" | "declined")
 *   3. Counterparty signed up & linked  (counterparty_org_id !== null)
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Mail, UserPlus, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
// Batch A — surface the canonical contact-state label here too so the
// timeline panel uses the same wording as the admin queue and the
// pending-engagement card.
import {
  contactBlockReason,
  contactStateLabel,
  getContactState,
  isOutreachBlocked,
} from "@/lib/contact-completeness";

export interface UnknownCounterpartyEngagement {
  engagement_status: string | null;
  counterparty_type: string | null;
  counterparty_email: string | null;
  counterparty_org_id: string | null;
  counterparty_name?: string | null;
  /** Batch A — counterparty contact labelling fields. */
  contact_type?: "organisation" | "named_individual" | null;
  contact_name?: string | null;
  contacted_at?: string | null;
  responded_at?: string | null;
  created_at?: string | null;
}

interface Props {
  engagement: UnknownCounterpartyEngagement | null;
  /** True when the current viewer is the initiator (the POI creator). */
  isInitiator: boolean;
}

type StepState = "complete" | "active" | "pending";

interface Step {
  id: string;
  label: string;
  description: string;
  state: StepState;
  timestamp?: string | null;
  icon: React.ComponentType<{ className?: string }>;
}

function formatTs(ts?: string | null): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function UnknownCounterpartyStatus({ engagement, isInitiator }: Props) {
  if (!engagement) return null;

  // Only show this panel when the counterparty is/was off-platform.
  // Once linked (counterparty_org_id set AND counterparty_type === 'known' AND
  // status moved to accepted/declined), the AcceptEngagementCard / wizard
  // takes over the visible workflow — but we still show the "linked" success
  // beat for one terminal status to confirm the link happened.
  const isOffPlatform =
    engagement.counterparty_type === "unknown" || !engagement.counterparty_org_id;

  // Hide entirely once the partner has accepted/declined AND linking is done —
  // the rest of the UI communicates state from there.
  const terminal =
    engagement.engagement_status === "accepted" ||
    engagement.engagement_status === "declined";
  if (terminal && engagement.counterparty_org_id) return null;
  if (!isOffPlatform && !terminal) return null;

  const supportDone = true; // engagement existing implies support was notified at POI time
  const outreachDone =
    engagement.engagement_status === "contacted" ||
    engagement.engagement_status === "accepted" ||
    engagement.engagement_status === "declined";
  const linkedDone = !!engagement.counterparty_org_id;

  // Active step = the first incomplete one
  const activeIndex = !supportDone ? 0 : !outreachDone ? 1 : !linkedDone ? 2 : 3;

  const steps: Step[] = [
    {
      id: "support",
      label: "Support desk notified",
      description:
        "Our compliance desk has been alerted that your counterparty is not yet on the platform and will reach out on your behalf.",
      state: supportDone ? "complete" : activeIndex === 0 ? "active" : "pending",
      timestamp: engagement.created_at,
      icon: ShieldCheck,
    },
    {
      id: "outreach",
      label: outreachDone ? "Outreach email sent" : "Outreach email pending",
      description: outreachDone
        ? `An invitation was sent${engagement.counterparty_email ? ` to ${engagement.counterparty_email}` : ""}, asking your counterparty to register and respond.`
        : engagement.counterparty_email
          ? `Ready to send to ${engagement.counterparty_email}. Awaiting compliance desk action.`
          : "Awaiting confirmation of your counterparty's email address before outreach can be sent.",
      state: outreachDone ? "complete" : activeIndex === 1 ? "active" : "pending",
      timestamp: engagement.contacted_at,
      icon: Mail,
    },
    {
      id: "linked",
      label: linkedDone ? "Counterparty signed up & linked" : "Awaiting counterparty signup",
      description: linkedDone
        ? "Your counterparty has registered. They can now see this trade in their dashboard and accept or decline."
        : "Once they register using the invited email address, this match will be linked to their organisation automatically.",
      state: linkedDone ? "complete" : activeIndex === 2 ? "active" : "pending",
      timestamp: linkedDone ? engagement.responded_at : null,
      icon: UserPlus,
    },
  ];

  const currentBadge = (() => {
    if (linkedDone)
      return { label: "Linked — awaiting response", tone: "complete" as const };
    if (outreachDone)
      return { label: "Outreach sent — awaiting signup", tone: "active" as const };
    return { label: "Support notified — outreach pending", tone: "pending" as const };
  })();

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Counterparty onboarding in progress
            </CardTitle>
            <CardDescription>
              {isInitiator
                ? "Your counterparty is not yet on Izenzo. Here's where they are in the onboarding journey."
                : "This trade was issued to a counterparty who is not yet on the platform."}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-xs",
              currentBadge.tone === "complete" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              currentBadge.tone === "active" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
              currentBadge.tone === "pending" && "border-muted-foreground/30 bg-muted text-muted-foreground",
            )}
          >
            {currentBadge.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-5">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isLast = idx === steps.length - 1;
            const ts = formatTs(step.timestamp);
            return (
              <li key={step.id} className="relative flex gap-4">
                {/* Connector line */}
                {!isLast && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-4 top-8 h-full w-px -translate-x-1/2",
                      step.state === "complete" ? "bg-emerald-500/40" : "bg-border",
                    )}
                  />
                )}

                {/* Icon */}
                <div
                  className={cn(
                    "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
                    step.state === "complete" &&
                      "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    step.state === "active" &&
                      "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400 motion-safe:animate-pulse",
                    step.state === "pending" &&
                      "border-muted-foreground/30 bg-background text-muted-foreground",
                  )}
                >
                  {step.state === "complete" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>

                {/* Body */}
                <div className="flex-1 pb-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        step.state === "pending" && "text-muted-foreground",
                      )}
                    >
                      {step.label}
                    </p>
                    {ts && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {ts}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {isInitiator && !linkedDone && (
          <p className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground">
            <strong className="text-foreground">What you can do:</strong>{" "}
            {!outreachDone
              ? "Nudge your counterparty directly if you have their contact details — once they sign up with the invited email, this match will link automatically."
              : "Your counterparty has been emailed. If they haven't responded within 48 hours, contact support@izenzo.co.za and we'll follow up."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
