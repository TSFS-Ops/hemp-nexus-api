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

const _ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_USER_EXPORT_CATEGORIES);
const _FORBIDDEN_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_USER_EXPORT_CATEGORIES,
);

export interface ResolveExportScopeResult {
  resolved: UserExportCategory[];
  stripped: string[];
  empty: boolean;
}

/**
 * Pure mirror of the Deno helper in
 * supabase/functions/_shared/user-export-categories.ts. Used by tests and
 * for any future client-side pre-validation. Server is still authoritative.
 */
export function resolveExportScope(
  userId: string,
  _orgIds: string[],
  requestedCategories: readonly string[],
): ResolveExportScopeResult {
  if (!userId) {
    return { resolved: [], stripped: [...requestedCategories], empty: true };
  }
  const resolved: UserExportCategory[] = [];
  const stripped: string[] = [];
  const seen = new Set<string>();
  for (const raw of requestedCategories) {
    const c = String(raw ?? "").trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (_FORBIDDEN_SET.has(c) || !_ALLOWED_SET.has(c)) {
      stripped.push(c);
      continue;
    }
    resolved.push(c as UserExportCategory);
  }
  return { resolved, stripped, empty: resolved.length === 0 };
}
