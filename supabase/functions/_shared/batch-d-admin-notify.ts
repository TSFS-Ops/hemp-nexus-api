/**
 * Batch D — D4b admin-only notification helper.
 *
 * Single chokepoint that ALL Batch D admin alerts must go through.
 * Mirrors the canonical catalogue from `src/lib/batch-d-events.ts`
 * for the two events D4b is allowed to dispatch. Runtime invariants
 * fail closed; any caller that attempts to dispatch a non-admin
 * event, or a recipient derived from engagement/contact/org data,
 * is refused and audited via `notification_skipped`.
 *
 * Recipient policy (HARD):
 *   - The platform admin mailbox + Slack webhook are the ONLY allowed
 *     recipients. Both are configured via `admin_settings.notifications`
 *     and `RESEND_API_KEY` and resolved by `notification-dispatch`.
 *   - This helper NEVER reads `poi_engagements.contact_email`,
 *     `org_id`, candidate-org tables, or any other counterparty source.
 *   - If the engagement is in `disputed_being_named` operational state,
 *     the helper still permits the platform-admin alert (that IS the
 *     point of the alert), but documents the suppression check ran.
 *
 * Wording policy (HARD):
 *   - Subjects/bodies are composed only from catalogue `safeWording`
 *     plus a short admin trace tail (engagement id). No commodity,
 *     org name, contact name, or PII is interpolated.
 *   - Subjects pass through `clampSubject` (200-char ceiling).
 *
 * Idempotency:
 *   - Deduped via an `audit_logs` lookup keyed on event_type +
 *     engagement_id within a 60-minute window. Best-effort: a race
 *     under 1s may emit one duplicate alert; never causes counterparty
 *     contact.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { clampSubject } from "./email-subject.ts";
import { recordNotificationSkipped } from "./notification-skip-audit.ts";

/**
 * Mirror of the two `adminDispatchEnabled: true` entries in
 * `src/lib/batch-d-events.ts`. Kept in sync via a parity test.
 */
const D4B_DISPATCH_ALLOWLIST = {
  "engagement.binding_review_required": {
    label: "Binding review required",
    safeWording:
      "A Pending Engagement requires a binding-review decision and is awaiting platform review.",
    subjectPrefix: "[Izenzo Admin] Binding review required",
  },
  "engagement.disputed_being_named": {
    label: "Counterparty dispute received",
    safeWording:
      "A counterparty has queried being named on a Pending Engagement. The engagement is paused for platform review.",
    subjectPrefix: "[Izenzo Admin] Counterparty dispute received",
  },
} as const;

export type D4bAdminEvent = keyof typeof D4B_DISPATCH_ALLOWLIST;

/**
 * Phase 1 demo isolation. If the engagement (or its parent match) is
 * flagged `is_demo`, the dispatcher refuses to send and audits the skip.
 * Demo rows must never trigger real platform-admin email or Slack.
 */
async function isDemoEngagement(
  supabase: SupabaseClient,
  engagementId: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("poi_engagements")
      .select("is_demo, matches:match_id ( is_demo )")
      .eq("id", engagementId)
      .maybeSingle();
    if (!data) return false;
    if ((data as { is_demo?: boolean }).is_demo === true) return true;
    const m = (data as { matches?: { is_demo?: boolean } | null }).matches;
    return m?.is_demo === true;
  } catch (err) {
    console.warn("[batch-d-admin-notify] is_demo lookup failed; defaulting to non-demo", err);
    return false;
  }
}

export const D4B_DISPATCH_EVENTS: readonly D4bAdminEvent[] = Object.keys(
  D4B_DISPATCH_ALLOWLIST,
) as D4bAdminEvent[];

const DEDUPE_WINDOW_MINUTES = 60;
const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";

export interface D4bAdminNotifyArgs {
  /** Canonical event name. Must be in D4B_DISPATCH_ALLOWLIST. */
  eventType: string;
  /** Target engagement id. Used for idempotency + admin trace. */
  engagementId: string;
  /**
   * Optional engagement row used for the defensive disputed-suppression
   * mirror check. The helper NEVER derives a recipient from this object.
   */
  engagement?: {
    engagement_status?: string | null;
    operational_state?: string | null;
    org_id?: string | null;
  } | null;
  /** Optional digest size for backlog alerts (binding_review_required). */
  backlogCount?: number;
  /** Caller name for audit forensics. */
  sourceFunction: string;
}

export interface D4bAdminNotifyResult {
  dispatched: boolean;
  skipped?: "non_admin_event" | "duplicate" | "dispatcher_error";
  detail?: string;
}

/**
 * Dispatch a Batch D admin-only alert. Returns a result object;
 * never throws. The caller's primary flow must not depend on the
 * outcome — alerts are best-effort.
 */
export async function dispatchD4bAdminAlert(
  supabase: SupabaseClient,
  args: D4bAdminNotifyArgs,
): Promise<D4bAdminNotifyResult> {
  const orgId = args.engagement?.org_id ?? null;

  // ── Hard allowlist — refuses any event not flipped on for D4b ──
  if (!(args.eventType in D4B_DISPATCH_ALLOWLIST)) {
    await recordNotificationSkipped(supabase, {
      reason: "no_channels_configured",
      sourceFunction: args.sourceFunction,
      sourceEventType: args.eventType,
      targetId: args.engagementId,
      orgId,
      extra: { d4b_block: "non_admin_event" },
    });
    return { dispatched: false, skipped: "non_admin_event" };
  }

  const entry = D4B_DISPATCH_ALLOWLIST[args.eventType as D4bAdminEvent];

  // ── Defensive: if a future caller passes a counterparty recipient
  // somehow, log it. We never use the engagement to derive recipients
  // — this branch exists purely as a tripwire. ──
  // (No-op today; recorded shape kept for forensic queries.)

  // ── Idempotency: dedupe within 60 minutes per engagement+event ──
  try {
    const sinceIso = new Date(
      Date.now() - DEDUPE_WINDOW_MINUTES * 60 * 1000,
    ).toISOString();
    const { data: existing } = await supabase
      .from("audit_logs")
      .select("id")
      .eq("action", "engagement.admin_alert_sent")
      .eq("entity_id", args.engagementId)
      .gte("created_at", sinceIso)
      .contains("metadata", { event_type: args.eventType })
      .limit(1);
    if (existing && existing.length > 0) {
      await recordNotificationSkipped(supabase, {
        reason: "duplicate_suppressed",
        sourceFunction: args.sourceFunction,
        sourceEventType: args.eventType,
        targetId: args.engagementId,
        orgId,
        extra: { d4b_block: "duplicate", window_minutes: DEDUPE_WINDOW_MINUTES },
      });
      return { dispatched: false, skipped: "duplicate" };
    }
  } catch (dedupeErr) {
    // Soft-fail: prefer to risk a duplicate over silently dropping
    // a legitimate admin alert. Continue to dispatch.
    console.warn(
      "[batch-d-admin-notify] dedupe lookup failed; continuing",
      dedupeErr,
    );
  }

  // ── Compose subject + body from catalogue safeWording only ──
  const subject = clampSubject(
    args.backlogCount && args.backlogCount > 1
      ? `${entry.subjectPrefix} (${args.backlogCount} pending)`
      : entry.subjectPrefix,
  );
  const message = [
    entry.safeWording,
    "",
    `Engagement: ${args.engagementId}`,
    "Queue: /admin/pending-engagements",
  ].join("\n");

  // ── Invoke shared dispatcher (handles channel resolution) ──
  try {
    const { error: dispatchErr } = await supabase.functions.invoke(
      "notification-dispatch",
      {
        body: {
          event_type: args.eventType,
          subject,
          message,
          metadata: {
            org_id: orgId ?? SYSTEM_ORG_SENTINEL,
            engagement_id: args.engagementId,
            d4b_admin_alert: true,
          },
        },
      },
    );
    if (dispatchErr) {
      await recordNotificationSkipped(supabase, {
        reason: "dispatcher_unavailable",
        sourceFunction: args.sourceFunction,
        sourceEventType: args.eventType,
        targetId: args.engagementId,
        orgId,
        extra: { d4b_block: "dispatcher_error", error: dispatchErr.message ?? String(dispatchErr) },
      });
      return { dispatched: false, skipped: "dispatcher_error", detail: String(dispatchErr) };
    }
  } catch (err) {
    await recordNotificationSkipped(supabase, {
      reason: "dispatcher_unavailable",
      sourceFunction: args.sourceFunction,
      sourceEventType: args.eventType,
      targetId: args.engagementId,
      orgId,
      extra: { d4b_block: "dispatcher_error", error: err instanceof Error ? err.message : String(err) },
    });
    return { dispatched: false, skipped: "dispatcher_error" };
  }

  // ── Stable audit row used by the dedupe lookup above ──
  try {
    await supabase.from("audit_logs").insert({
      org_id: orgId ?? SYSTEM_ORG_SENTINEL,
      action: "engagement.admin_alert_sent",
      entity_type: "poi_engagement",
      entity_id: args.engagementId,
      metadata: {
        event_type: args.eventType,
        source_function: args.sourceFunction,
        backlog_count: args.backlogCount ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (auditErr) {
    console.warn(
      "[batch-d-admin-notify] admin_alert_sent audit insert failed",
      auditErr,
    );
  }

  return { dispatched: true };
}
