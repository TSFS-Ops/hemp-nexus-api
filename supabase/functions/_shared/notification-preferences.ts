/**
 * notification-preferences
 * ------------------------
 * Batch M Fix 2: shared helper that reads notification_preferences for a
 * target user and decides whether a given notification (email, in-app or
 * Slack/admin) is allowed.
 *
 * Rules
 *  - Security and compliance categories are ALWAYS allowed (preferences
 *    cannot opt out of safety-critical messages).
 *  - Optional + preference key OFF → blocked. Caller MUST write
 *    `notification_skipped` with reason `preference_disabled`.
 *  - Optional + preference key absent in DB → falls back to the
 *    DEFAULT_PREFERENCES table below (true unless explicitly false).
 *  - Transactional category: blocked only when caller supplies a prefKey
 *    and that key is explicitly false. Default behaviour is allow.
 *  - On lookup error: fail-open (allow) and log — never block a delivery
 *    because of a preference-table outage.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  type EmailCategory,
  isBlockedByPreference,
} from "./email-categories.ts";
import { recordNotificationSkipped } from "./notification-skip-audit.ts";

/** Defaults mirror src/components/desk/settings/NotificationRulesTab.tsx. */
const DEFAULT_PREFERENCES: Record<string, boolean> = {
  poi_sealed: true,
  counterparty_action: true,
  weekly_summary: true,
  compliance_status: true,
  new_counterparty: false,
};

export interface PreferenceDecision {
  allowed: boolean;
  reason: "category_bypass" | "no_pref_key" | "default_on" | "user_on" | "user_off" | "lookup_error_fail_open";
  prefKey: string | null;
  category: EmailCategory;
}

export async function isPreferenceAllowed(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  prefKey: string | null,
  category: EmailCategory,
): Promise<PreferenceDecision> {
  // Safety-critical categories cannot be blocked by preferences.
  if (category === "security" || category === "compliance") {
    return { allowed: true, reason: "category_bypass", prefKey, category };
  }

  // No preference key mapped for this notification → allow.
  if (!prefKey) {
    return { allowed: true, reason: "no_pref_key", prefKey, category };
  }

  // No user → cannot look up preferences (e.g. anonymous/system-only flow);
  // allow but record category for caller.
  if (!userId) {
    return { allowed: true, reason: "no_pref_key", prefKey, category };
  }

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[notification-preferences] lookup failed — failing open", {
      userId,
      prefKey,
      error: error.message,
    });
    return { allowed: true, reason: "lookup_error_fail_open", prefKey, category };
  }

  const prefs = (data?.preferences as Record<string, boolean> | undefined) ?? {};
  const stored = prefs[prefKey];

  if (stored === undefined) {
    const fallback = DEFAULT_PREFERENCES[prefKey] ?? true;
    if (!fallback && isBlockedByPreference(category)) {
      return { allowed: false, reason: "default_on", prefKey, category };
    }
    return { allowed: fallback, reason: "default_on", prefKey, category };
  }

  if (stored === true) {
    return { allowed: true, reason: "user_on", prefKey, category };
  }

  // stored === false. Only block optional categories on explicit off.
  // Transactional still respects an explicit off (user opted out of e.g.
  // weekly digest), but security/compliance already returned above.
  return { allowed: false, reason: "user_off", prefKey, category };
}

/**
 * Convenience wrapper: when blocked, writes the canonical
 * `notification_skipped` audit row with reason `preference_disabled`.
 * Never throws.
 */
export async function checkAndAuditPreference(
  supabase: SupabaseClient,
  args: {
    userId: string | null | undefined;
    prefKey: string | null;
    category: EmailCategory;
    sourceFunction: string;
    sourceEventType?: string | null;
    channel: "email" | "slack" | "webhook" | "in_app";
    orgId?: string | null;
    targetId?: string | null;
  },
): Promise<PreferenceDecision> {
  const decision = await isPreferenceAllowed(
    supabase,
    args.userId,
    args.prefKey,
    args.category,
  );

  if (!decision.allowed) {
    await recordNotificationSkipped(supabase, {
      reason: "preference_disabled" as never, // extending union; canonical reason added in helper
      sourceFunction: args.sourceFunction,
      sourceEventType: args.sourceEventType ?? null,
      channel: args.channel,
      orgId: args.orgId ?? null,
      targetId: args.targetId ?? null,
      recipientId: args.userId ?? null,
      extra: {
        pref_key: args.prefKey,
        category: args.category,
        decision_reason: decision.reason,
      },
    });
  }

  return decision;
}
