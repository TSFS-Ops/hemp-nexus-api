/**
 * DATA-005 Phase 1 — SSOT for user self-export categories (Deno).
 *
 * Mirror in src/lib/user-export-categories.ts MUST stay in sync.
 * Enforced by scripts/check-user-export-categories.mjs.
 *
 * Phase 1: scope resolution only — no payload data is fetched, no
 * file is generated. Phase 2 (DATA-005-FU-EXPORT-LIFECYCLE-001) will
 * execute the resolved category list against the user's data.
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

/**
 * Categories that MUST NEVER appear in a self-export payload, even by
 * mistake. The scope resolver strips these. The prebuild guard
 * (check-user-export-categories.mjs) also fails the build if any of
 * these strings are introduced as legitimate category enum members.
 */
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

const ALLOWED_SET: ReadonlySet<string> = new Set(
  ALLOWED_USER_EXPORT_CATEGORIES,
);
const FORBIDDEN_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_USER_EXPORT_CATEGORIES,
);

export interface ResolveExportScopeResult {
  /** Final allowed categories after stripping unknown + forbidden. */
  resolved: UserExportCategory[];
  /** Requested categories the resolver explicitly removed. */
  stripped: string[];
  /** True when nothing survived — caller should mark request `blocked`. */
  empty: boolean;
}

/**
 * resolveExportScope — Phase 1 contract.
 *
 * Pure function: no DB access, no payload fetch. Returns the subset
 * of requested categories that are allowed for self-export, scoped
 * to the supplied user and their authorised org memberships.
 *
 * Forbidden categories are NEVER returned, even if explicitly requested.
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
    if (FORBIDDEN_SET.has(c)) {
      stripped.push(c);
      continue;
    }
    if (!ALLOWED_SET.has(c)) {
      stripped.push(c);
      continue;
    }
    resolved.push(c as UserExportCategory);
  }
  return { resolved, stripped, empty: resolved.length === 0 };
}

/**
 * Phase-2 canonical audit names. Declared for the registry/guard so
 * Phase 1 cannot accidentally emit them.
 */
export const PHASE2_AUDIT_NAMES = [
  "data.user_export_generated",
  "data.user_export_downloaded",
  "data.user_export_file_destroyed",
] as const;

export const PHASE1_AUDIT_NAMES = [
  "data.user_export_requested",
  "data.user_export_scope_resolved",
  "data.user_export_blocked_or_declined",
] as const;
