/**
 * notification-skip-audit
 * -----------------------
 * Shared helper to write an append-only audit row whenever a lifecycle or
 * notification flow intentionally does NOT send a notification (email,
 * Slack, webhook, in-app, etc.).
 *
 * Without this signal, a silently-suppressed dispatch is indistinguishable
 * from a successful no-op. D-07 requires every skip branch to be auditable
 * with a structured `reason` code so operators can count silent skips by
 * cause over a 24h window.
 *
 * Best-effort: never throws. The caller's primary flow must not depend on
 * audit success.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/** Canonical reason codes — extend with care, never overload. */
export type NotificationSkipReason =
  | "no_recipient"
  | "recipient_suppressed"
  | "no_primary_endpoint"
  | "duplicate_suppressed"
  | "test_mode_suppressed"
  | "dispatcher_unavailable"
  | "lifecycle_noop"
  | "email_disabled"
  | "rate_limited"
  | "no_due_items"
  | "dry_run"
  | "concurrent_run_blocked"
  | "slack_not_configured"
  | "no_channels_configured";

const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";

export interface NotificationSkipArgs {
  reason: NotificationSkipReason;
  sourceFunction: string;
  lifecycleEventType?: string | null;
  sourceEventType?: string | null;
  targetId?: string | null;
  recipientId?: string | null;
  recipientEmail?: string | null;
  channel?: "email" | "slack" | "webhook" | "in_app" | null;
  orgId?: string | null;
  extra?: Record<string, unknown>;
}

/**
 * Insert a `notification_skipped` audit row. Never throws — failures are
 * logged to console only.
 */
export async function recordNotificationSkipped(
  supabase: SupabaseClient,
  args: NotificationSkipArgs,
): Promise<void> {
  try {
    const metadata: Record<string, unknown> = {
      reason: args.reason,
      source_function: args.sourceFunction,
      lifecycle_event_type: args.lifecycleEventType ?? null,
      source_event_type: args.sourceEventType ?? null,
      target_id: args.targetId ?? null,
      recipient_id: args.recipientId ?? null,
      recipient_email: args.recipientEmail ?? null,
      channel: args.channel ?? null,
      timestamp: new Date().toISOString(),
      ...(args.extra ?? {}),
    };

    const { error } = await supabase.from("audit_logs").insert({
      org_id: args.orgId || SYSTEM_ORG_SENTINEL,
      action: "notification_skipped",
      entity_type: "notification",
      entity_id: args.targetId ?? null,
      metadata,
    });

    if (error) {
      console.error("[notification-skip-audit] insert failed", error);
    }
  } catch (err) {
    console.error("[notification-skip-audit] unexpected failure", err);
  }
}
