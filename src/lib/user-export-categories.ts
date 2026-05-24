/**
 * DATA-005 Phase 1 — client mirror of
 * supabase/functions/_shared/user-export-categories.ts
 *
 * Both files MUST stay in sync. Enforced by
 * scripts/check-user-export-categories.mjs.
 */

export const ALLOWED_USER_EXPORT_CATEGORIES = [
  "profile",
  "org_memberships",
  "notification_prefs",
  "my_trade_requests",
  "my_matches",
  "my_engagements",
  "my_billing_usage",
  "my_documents",
] as const;

export type UserExportCategory =
  (typeof ALLOWED_USER_EXPORT_CATEGORIES)[number];

export const FORBIDDEN_USER_EXPORT_CATEGORIES = [
  "passwords",
  "password_hashes",
  "api_keys",
  "webhook_secrets",
  "auth_tokens",
  "session_tokens",
  "reset_tokens",
  "payment_card_data",
  "admin_notes",
  "privileged_legal_notes",
  "raw_audit_logs",
  "other_users_personal_data",
  "unrelated_org_data",
] as const;

export const PHASE1_AUDIT_NAMES = [
  "data.user_export_requested",
  "data.user_export_scope_resolved",
  "data.user_export_blocked_or_declined",
] as const;

export const PHASE2_AUDIT_NAMES = [
  "data.user_export_generated",
  "data.user_export_downloaded",
  "data.user_export_file_destroyed",
] as const;

export const USER_EXPORT_CATEGORY_LABELS: Record<UserExportCategory, string> = {
  profile: "Profile",
  org_memberships: "Organisation memberships",
  notification_prefs: "Notification preferences",
  my_trade_requests: "My trade requests",
  my_matches: "My matches",
  my_engagements: "My engagements",
  my_billing_usage: "My billing & credit usage",
  my_documents: "Documents I uploaded",
};
