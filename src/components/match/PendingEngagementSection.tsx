/**
 * PendingEngagementSection
 *
 * At-a-glance summary card shown on the Match Details page that answers
 * two questions a trader keeps asking after clicking "Generate POI" against
 * a named-but-unregistered counterparty:
 *
 *   1. What is the current invitation status?
 *      (pending, notification_sent, contacted, accepted, declined, expired)
 *
 *   2. Are there any missing counterparty fields blocking outreach?
 *      (counterparty name, counterparty email, org link)
 *
 * This card complements (it does NOT replace) the existing onboarding
 * timeline (`UnknownCounterpartyStatus`) and the detailed
 * `EngagementTracker`. Its job is to be the single, scannable header that
 * tells the user what state they're in and what — if anything — is missing.
 *
 * Hidden when:
 *   • there is no engagement row for this match, OR
 *   • the engagement is terminal AND the counterparty is fully linked
 *     (the rest of the page communicates state from there).
 *
 * Source of truth: `poi_engagements` row returned by
 * `GET /poi-engagements/by-match/:matchId`. The parent
 * (MatchDetails.tsx) is responsible for fetching it and passing the full
 * row in via `engagement`.
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, Mail, CheckCircle2, XCircle, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isEngagementTerminal } from "@/lib/engagement-state";
import { getEngagementWording } from "@/lib/engagement-wording";
// Batch A — single source of truth for the contact-state label/tooltip
// shown above the missing-fields callout.
import {
  contactBlockReason,
  contactStateLabel,
  getContactState,
  isOutreachBlocked,
  type ContactState,
} from "@/lib/contact-completeness";

export interface PendingEngagementRow {
  id?: string | null;
  engagement_status: string | null;
  counterparty_type: string | null;
  /**
   * Legacy fallback only. Canonical display name comes from the parent
   * `matches` row (`buyer_name` / `seller_name`) — that is the field the
   * user typed when drafting the trade and the field every other surface
   * (hero card, wizard, admin pipeline) reads.
   */
  counterparty_name?: string | null;
  counterparty_email: string | null;
  counterparty_org_id: string | null;
  /** Batch A — counterparty contact labelling fields. */
  contact_type?: "organisation" | "named_individual" | null;
  contact_name?: string | null;
  created_at?: string | null;
  contacted_at?: string | null;
  responded_at?: string | null;
  expires_at?: string | null;
  /** Batch B Phase 5 — used to derive late-acceptance wording. */
  counterparty_response?: string | null;
  renewed_from_engagement_id?: string | null;
  late_acceptance_recorded_at?: string | null;
}

/**
 * Minimum fields we need from the parent match to derive the counterparty's
 * display name. Kept loose so callers can pass the full match row.
 */
export interface PendingEngagementMatch {
  buyer_name?: string | null;
  seller_name?: string | null;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
}

interface Props {
  engagement: PendingEngagementRow | null | undefined;
  /** Parent match row — source of truth for the counterparty display name. */
  match?: PendingEngagementMatch | null;
  /** True when the current viewer is the initiator (the POI creator). */
  isInitiator: boolean;
}

interface StatusMeta {
  label: string;
  tone: "pending" | "active" | "ok" | "fail";
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Copy is deliberately conservative: at the moment the soft-route creates
 * a Pending Engagement, NO email is dispatched and NO in-app notification
 * is queued — only a `poi_engagements` row and a `match.poi.soft_routed`
 * audit entry. Outreach is performed later by a compliance reviewer from
 * the admin Pending Engagements panel. So we must not claim "Invitation
 * sent" or "We have emailed your counterparty" in the `pending` state.
 */
function statusMeta(status: string | null): StatusMeta {
  switch (status) {
    case "pending":
      return {
        label: "Pending Engagement created",
        tone: "pending",
        description:
          "Counterparty details have been recorded. No invitation has been sent yet — our compliance desk will review this engagement and reach out to your counterparty manually. You will be notified when outreach occurs or when they respond.",
        icon: Clock,
      };
    case "notification_sent":
      return {
        label: "Queued for outreach",
        tone: "pending",
        description:
          "Our compliance desk has been notified and will contact your counterparty manually. No email has been sent yet. No further action required from you.",
        icon: Clock,
      };
    case "contacted":
      return {
        label: "Outreach sent",
        tone: "active",
        description:
          "Our compliance desk has reached out to your counterparty. We will notify you once they reply.",
        icon: Mail,
      };
    case "accepted":
      return {
        label: "Counterparty accepted",
        tone: "ok",
        description:
          "Your counterparty has registered and accepted. The trade can now progress to Proof of Intent.",
        icon: CheckCircle2,
      };
    case "declined":
      return {
        label: "Counterparty declined",
        tone: "fail",
        description:
          "Your counterparty declined this engagement. You can restart the trade with a different counterparty from the trade detail page.",
        icon: XCircle,
      };
    case "expired":
      return {
        label: "Engagement window elapsed",
        tone: "fail",
        description:
          "The 30-day response window elapsed without a reply. You can restart the trade with the same or a different counterparty.",
        icon: XCircle,
      };
    default:
      return {
        label: status ? `Status: ${status}` : "Unknown status",
        tone: "pending",
        description:
          "This engagement is in an unrecognised state. Contact support@izenzo.co.za if it persists.",
        icon: AlertCircle,
      };
  }
}

function formatTs(ts?: string | null): string | null {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function daysUntil(ts?: string | null): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function PendingEngagementSection({ engagement, match, isInitiator }: Props) {
  if (!engagement) return null;

  // Hide once fully resolved AND linked — other surfaces own that story.
  const terminal = isEngagementTerminal(engagement.engagement_status);
  if (terminal && engagement.counterparty_org_id) return null;

  const meta = statusMeta(engagement.engagement_status);
  const Icon = meta.icon;

  // Identify any missing counterparty fields that would block / weaken outreach.
  const missingFields: { label: string; hint: string }[] = [];
  // Derive display name from the parent match — that is the canonical
  // source. Prefer whichever side is unregistered (no *_org_id). Fall back
  // to the engagement row only if the match is missing both names.
  const buyerName = (match?.buyer_name || "").trim();
  const sellerName = (match?.seller_name || "").trim();
  const buyerUnregistered = !match?.buyer_org_id;
  const sellerUnregistered = !match?.seller_org_id;
  const derivedFromMatch =
    buyerUnregistered && buyerName
      ? buyerName
      : sellerUnregistered && sellerName
        ? sellerName
        : buyerName || sellerName;
  const name = (derivedFromMatch || engagement.counterparty_name || "").trim();
  const email = (engagement.counterparty_email || "").trim();
  if (!name) {
    missingFields.push({
      label: "Counterparty name",
      hint: "We need a name so the compliance desk can address outreach correctly.",
    });
  }
  if (!email) {
    missingFields.push({
      label: "Counterparty email",
      hint: "Without an email, our compliance desk has no address to reach out to.",
    });
  }
  if (!engagement.counterparty_org_id && !terminal) {
    missingFields.push({
      label: "Linked organisation",
      hint:
        "This counterparty has not yet registered. The match will auto-link once they sign up using the recorded email.",
    });
  }

  const expiresIn = daysUntil(engagement.expires_at);
  const expiresLabel =
    expiresIn === null
      ? null
      : expiresIn <= 0
        ? "Engagement window has elapsed"
        : expiresIn === 1
          ? "Engagement expires in 1 day"
          : `Engagement expires in ${expiresIn} days`;

  // Border / surface tone
  const surface =
    meta.tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : meta.tone === "fail"
        ? "border-red-500/40 bg-red-500/5"
        : "border-amber-500/40 bg-amber-500/5";

  const badgeClass =
    meta.tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : meta.tone === "fail"
        ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
        : meta.tone === "active"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-muted-foreground/30 bg-muted text-muted-foreground";

  const iconClass =
    meta.tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : meta.tone === "fail"
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";

  return (
    <Card className={cn(surface)} aria-labelledby="pending-engagement-heading">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <CardTitle
              id="pending-engagement-heading"
              className="flex items-center gap-2 text-lg"
            >
              <Icon className={cn("h-5 w-5 shrink-0", iconClass)} />
              Pending Engagement
            </CardTitle>
            <CardDescription>
              {isInitiator
                ? "A pending engagement has been recorded for this trade. Status shown below."
                : "A pending engagement is in progress for this trade. Status shown below."}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant="outline" className={cn("text-xs", badgeClass)}>
              {meta.label}
            </Badge>
            {/* Batch A — canonical contact-state badge so the initiator can
                see at a glance whether the recorded contact is sufficient
                for the compliance desk to send outreach. */}
            {(() => {
              const cs: ContactState = getContactState(
                {
                  counterparty_email: engagement.counterparty_email,
                  counterparty_org_id: engagement.counterparty_org_id,
                  contact_name: engagement.contact_name,
                  contact_type: engagement.contact_type,
                },
                match ?? null,
              );
              const blocked = isOutreachBlocked(cs);
              const reason = contactBlockReason(cs);
              const tone = blocked
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : cs === "named_individual_contact"
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
              return (
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", tone)}
                  title={reason ?? "Contact details are sufficient for outreach."}
                  data-contact-state={cs}
                >
                  {contactStateLabel(cs)}
                </Badge>
              );
            })()}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <p className="text-sm text-foreground/90 leading-relaxed">{meta.description}</p>

        {/* ── Counterparty summary ─────────────────────────────────────── */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Counterparty
            </dt>
            <dd className="font-medium text-foreground">
              {name || <span className="text-muted-foreground italic">Not provided</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Email
            </dt>
            <dd className="font-mono text-xs text-foreground break-all">
              {email || <span className="font-sans text-sm text-muted-foreground italic">Not provided</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Linked organisation
            </dt>
            <dd className="text-foreground">
              {engagement.counterparty_org_id ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Linked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <UserPlus className="h-3.5 w-3.5" />
                  Awaiting signup
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Recorded
            </dt>
            <dd className="text-foreground tabular-nums">
              {formatTs(engagement.created_at) || "—"}
            </dd>
          </div>
          {engagement.contacted_at && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Outreach sent
              </dt>
              <dd className="text-foreground tabular-nums">
                {formatTs(engagement.contacted_at)}
              </dd>
            </div>
          )}
          {engagement.responded_at && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Responded
              </dt>
              <dd className="text-foreground tabular-nums">
                {formatTs(engagement.responded_at)}
              </dd>
            </div>
          )}
          {expiresLabel && !terminal && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Window
              </dt>
              <dd
                className={cn(
                  "text-sm tabular-nums",
                  expiresIn !== null && expiresIn <= 3
                    ? "text-amber-700 dark:text-amber-400 font-medium"
                    : "text-foreground",
                )}
              >
                {expiresLabel}
                {engagement.expires_at && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    ({formatTs(engagement.expires_at)})
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>

        {/* ── Missing fields callout ──────────────────────────────────── */}
        {missingFields.length > 0 && (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4"
            role="alert"
            aria-label="Missing counterparty information"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4" />
              {missingFields.length === 1
                ? "1 item still required"
                : `${missingFields.length} items still required`}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {missingFields.map((f) => (
                <li key={f.label} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{f.label}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.hint}</p>
                  </div>
                </li>
              ))}
            </ul>
            {isInitiator && !engagement.counterparty_org_id && (
              <p className="mt-3 pt-3 border-t border-amber-500/30 text-xs text-muted-foreground">
                Need to correct the email or name?{" "}
                <a
                  href="mailto:support@izenzo.co.za?subject=Update%20counterparty%20on%20pending%20engagement"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Contact support
                </a>{" "}
                and reference your match ID.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
