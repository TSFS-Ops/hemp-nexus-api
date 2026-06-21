/**
 * Phase 1 — SMS/WhatsApp Notification Channel Readiness Shell (SSOT, browser mirror).
 *
 * Pinned by:
 *   - scripts/check-notification-channel-readiness-parity.mjs (TS ↔ Deno mirror)
 *   - scripts/check-notification-no-live-sms-whatsapp-providers.mjs (no live SDKs)
 *   - scripts/check-notification-skipped-status-parity.mjs (skip reasons)
 *   - scripts/check-notification-channel-readiness-wording.mjs (safe labels)
 *
 * Mirror: supabase/functions/_shared/notification-channel-readiness.ts.
 */

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_STATUSES = ["active", "not_configured", "disabled"] as const;
export type NotificationChannelStatus = (typeof NOTIFICATION_CHANNEL_STATUSES)[number];

/**
 * Phase 1 contract: SMS and WhatsApp MUST be in one of these statuses and
 * MUST NOT enable live sending or test sends.
 */
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

/**
 * Phase 1 event→channel mapping. SMS and WhatsApp are NEVER allowed for any
 * system-sent event in Phase 1. Manual SMS/WhatsApp contact log is allowed
 * ONLY for unknown-counterparty facilitation.
 */
export interface ChannelMatrixRow {
  event: string;
  in_app: boolean;
  email: boolean;
  sms_system_send: false;
  whatsapp_system_send: false;
  manual_sms_whatsapp_log_allowed: boolean;
}

export const PHASE_1_EVENT_CHANNEL_MATRIX: ReadonlyArray<ChannelMatrixRow> = [
  { event: "known_cp_poi_issued",          in_app: true,  email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: false },
  { event: "unknown_cp_facilitation_alert",in_app: true,  email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: true  },
  { event: "poi_reminder",                 in_app: true,  email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: false },
  { event: "counterparty_response_received",in_app: true, email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: false },
  { event: "wad_ready",                    in_app: true,  email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: false },
  { event: "admin_compliance_alert",       in_app: true,  email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: false },
  { event: "security_login_alert",         in_app: true,  email: true,  sms_system_send: false, whatsapp_system_send: false, manual_sms_whatsapp_log_allowed: false },
] as const;

/** Audit event names — pinned by parity guard. */
export const NOTIFICATION_CHANNEL_AUDIT_EVENT_NAMES = [
  "notification_channel_readiness_viewed",
  "notification_channel_readiness_label_updated",
  "notification_channel_skip_recorded",
  "manual_outreach_logged",
  "unknown_counterparty_engagement_confirmed",
] as const;
export type NotificationChannelAuditEventName =
  (typeof NOTIFICATION_CHANNEL_AUDIT_EVENT_NAMES)[number];

/** Roles permitted to log manual SMS/WhatsApp contact (Phase 1). */
export const MANUAL_OUTREACH_AUTHORISED_ROLES = ["platform_admin", "support_admin"] as const;
export type ManualOutreachAuthorisedRole = (typeof MANUAL_OUTREACH_AUTHORISED_ROLES)[number];

/** Mask a phone number for display: keep country code + last 3 digits. */
export function maskPhone(e164: string): string {
  if (!e164) return "";
  const cleaned = e164.replace(/[^\d+]/g, "");
  if (cleaned.length < 5) return "***";
  const head = cleaned.startsWith("+") ? cleaned.slice(0, 3) : cleaned.slice(0, 2);
  const tail = cleaned.slice(-3);
  return `${head}******${tail}`;
}

/** Returns true if the value looks like a raw phone number (forbidden in logs/UI). */
export function looksLikeRawPhone(s: string): boolean {
  return /^\+?[0-9]{8,}$/.test(s.replace(/[^\d+]/g, ""));
}

export function isPhase1Locked(channel: NotificationChannel): boolean {
  return PHASE_1_LOCKED_CHANNELS.includes(channel);
}

export function isManualLogAllowedForEvent(event: string): boolean {
  const row = PHASE_1_EVENT_CHANNEL_MATRIX.find((r) => r.event === event);
  return !!row?.manual_sms_whatsapp_log_allowed;
}
