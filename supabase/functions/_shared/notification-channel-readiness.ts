/**
 * Phase 1 — SMS/WhatsApp Notification Channel Readiness Shell (Deno mirror).
 *
 * MUST stay in sync with src/lib/notification-channel-readiness.ts. Pinned
 * by scripts/check-notification-channel-readiness-parity.mjs.
 */

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_STATUSES = ["active", "not_configured", "disabled"] as const;
export type NotificationChannelStatus = (typeof NOTIFICATION_CHANNEL_STATUSES)[number];

export const PHASE_1_LOCKED_CHANNELS: ReadonlyArray<NotificationChannel> = ["sms", "whatsapp"];

export const NOTIFICATION_SKIP_REASONS = [
  "notification_skipped_provider_not_configured",
  "notification_provider_unavailable",
  "notification_template_not_approved",
  "notification_phone_missing_or_invalid",
  "notification_delivery_failed",
  "notification_suppressed_opt_out",
  "notification_channel_disabled",
  "notification_not_in_phase_1",
] as const;
export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASONS)[number];

export const NOTIFICATION_SAFE_LABELS = {
  not_configured:
    "SMS/WhatsApp is not configured. No external message was sent.",
  disabled:
    "This channel is disabled by Izenzo. No external message was sent.",
  credentials_missing:
    "Provider credentials are missing. No external message was sent.",
  template_not_approved:
    "Message template is not approved. No external message was sent.",
  manual_contact:
    "Izenzo logged manual contact outside the platform. This is not a system-sent message.",
} as const;

export const NOTIFICATION_CHANNEL_AUDIT_EVENT_NAMES = [
  "notification_channel_readiness_viewed",
  "notification_channel_readiness_label_updated",
  "notification_channel_skip_recorded",
  "manual_outreach_logged",
  "unknown_counterparty_engagement_confirmed",
] as const;
export type NotificationChannelAuditEventName =
  (typeof NOTIFICATION_CHANNEL_AUDIT_EVENT_NAMES)[number];

export const MANUAL_OUTREACH_AUTHORISED_ROLES = ["platform_admin", "support_admin"] as const;
export type ManualOutreachAuthorisedRole = (typeof MANUAL_OUTREACH_AUTHORISED_ROLES)[number];

export function maskPhone(e164: string): string {
  if (!e164) return "";
  const cleaned = e164.replace(/[^\d+]/g, "");
  if (cleaned.length < 5) return "***";
  const head = cleaned.startsWith("+") ? cleaned.slice(0, 3) : cleaned.slice(0, 2);
  const tail = cleaned.slice(-3);
  return `${head}******${tail}`;
}

export function looksLikeRawPhone(s: string): boolean {
  return /^\+?[0-9]{8,}$/.test(s.replace(/[^\d+]/g, ""));
}

export function isPhase1Locked(channel: NotificationChannel): boolean {
  return PHASE_1_LOCKED_CHANNELS.includes(channel);
}
