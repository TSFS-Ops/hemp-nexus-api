/**
 * D4c-1 — Initiator recipient resolver (shared helper).
 *
 * Given an engagement id, return the set of recipients that may be
 * notified on the INITIATING organisation's side (org admins of the
 * org that created the engagement, plus platform admins who belong
 * to that same initiating org row in `profiles` if any).
 *
 * ════════════════════════════════════════════════════════════════════
 * SAFETY CONTRACT — READ BEFORE EDITING
 * ════════════════════════════════════════════════════════════════════
 * This resolver is the SOLE recipient-derivation surface for D4c
 * initiator alerts. It MUST NEVER, under any circumstances, return:
 *
 *   • the counterparty email (`poi_engagements.counterparty_email`);
 *   • users belonging to the counterparty org
 *     (`poi_engagements.counterparty_org_id`);
 *   • candidate organisations surfaced by the binding resolver
 *     (`poi_engagements.binding_candidates` or any equivalent column);
 *   • the disputed counterparty's identity in any form;
 *   • profile rows located via the binding resolver;
 *   • any external/unregistered counterparty contact.
 *
 * Candidate organisations are flagged as a forbidden recipient group
 * in the canonical event catalogue (`src/lib/batch-d-events.ts`,
 * `RecipientGroup = "candidate_org"`). This helper enforces that
 * contract at the recipient-resolution layer so a future caller
 * cannot accidentally widen the recipient set.
 *
 * D4c-1 SCOPE: this file only RESOLVES recipients. It does NOT send
 * email, does NOT enqueue, does NOT touch templates. Outbound wiring
 * is deferred to D4c-2.
 * ════════════════════════════════════════════════════════════════════
 */

// Minimal structural type so this helper can be exercised by a fake
// client in tests without importing the full Supabase SDK types here.
export interface InitiatorRecipientsClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
        eq?: (col: string, val: unknown) => {
          // chained filter for profiles
          // (used as: from('profiles').select(...).eq('org_id',x).eq('status','active'))
          // returns a thenable resolving to { data, error }
          then?: never;
        } & Promise<{ data: unknown; error: unknown }>;
      } & Promise<{ data: unknown; error: unknown }>;
    };
  };
}

export interface InitiatorRecipient {
  user_id: string;
  email: string;
  role: "org_admin" | "platform_admin";
}

export type ResolveInitiatorRecipientsResult =
  | {
      ok: true;
      engagement_id: string;
      initiating_org_id: string;
      recipients: InitiatorRecipient[];
    }
  | {
      ok: false;
      engagement_id: string;
      reason:
        | "engagement_not_found"
        | "initiating_org_unknown"
        | "no_eligible_admins"
        | "lookup_failed";
      detail?: string;
    };

/**
 * Optional suppression checker. If provided, the resolver removes any
 * recipient whose email is hard-suppressed (bounce/complaint). Per the
 * signed Workflow Decision Form: marketing unsubscribe MUST NOT block
 * essential transactional notices, but hard-bounce / complaint
 * suppression MUST still be honoured. The split is the caller's
 * responsibility — pass a function that only flags hard suppression.
 */
export type HardSuppressionChecker = (
  emails: string[],
) => Promise<Set<string>>;

interface EngagementRow {
  id: string;
  org_id: string | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  org_id: string;
  status: string;
}

interface UserRoleRow {
  user_id: string;
  role: string;
}

/**
 * Resolve initiator-side recipients for a Pending Engagement.
 *
 * @param client    A Supabase-like client with service-role privileges.
 *                  RLS on `profiles` / `user_roles` / `poi_engagements`
 *                  is bypassed by service-role; callers MUST only use
 *                  this helper from a trusted server context.
 * @param engagementId  UUID of the engagement.
 * @param checkHardSuppression  Optional async callback; receives candidate
 *                  emails, returns the subset that is hard-suppressed.
 */
export async function resolveInitiatorRecipients(
  client: {
    from: (table: string) => any;
  },
  engagementId: string,
  checkHardSuppression?: HardSuppressionChecker,
): Promise<ResolveInitiatorRecipientsResult> {
  if (!engagementId || typeof engagementId !== "string") {
    return {
      ok: false,
      engagement_id: String(engagementId ?? ""),
      reason: "engagement_not_found",
      detail: "missing engagement_id",
    };
  }

  // 1. Load engagement — INTENTIONALLY select only the initiating
  //    org_id and id. We do NOT select counterparty_email,
  //    counterparty_org_id, binding_candidates, or any field that
  //    could leak counterparty/candidate identity into this code path.
  let eng: EngagementRow | null = null;
  try {
    const { data, error } = await client
      .from("poi_engagements")
      .select("id, org_id")
      .eq("id", engagementId)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        engagement_id: engagementId,
        reason: "lookup_failed",
        detail: String((error as { message?: string })?.message ?? error),
      };
    }
    eng = (data as EngagementRow | null) ?? null;
  } catch (e) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "lookup_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  if (!eng) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "engagement_not_found",
    };
  }

  const initiatingOrgId = eng.org_id;
  if (!initiatingOrgId) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "initiating_org_unknown",
    };
  }

  // 2. Load active profiles in the initiating org. Profiles model
  //    org membership in this codebase (one user → one org via
  //    `profiles.org_id`). Inactive / pending-deletion profiles are
  //    excluded.
  let profiles: ProfileRow[] = [];
  try {
    const { data, error } = await client
      .from("profiles")
      .select("id, email, org_id, status")
      .eq("org_id", initiatingOrgId)
      .eq("status", "active");
    if (error) {
      return {
        ok: false,
        engagement_id: engagementId,
        reason: "lookup_failed",
        detail: String((error as { message?: string })?.message ?? error),
      };
    }
    profiles = (data as ProfileRow[] | null) ?? [];
  } catch (e) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "lookup_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  if (profiles.length === 0) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "no_eligible_admins",
    };
  }

  // 3. Filter to users whose global role is org_admin OR platform_admin.
  //    Roles live in `public.user_roles` and are NOT scoped per org.
  //    We only return them here if they ALSO sit in a profile row
  //    belonging to the initiating org (intersection enforced above).
  const userIds = profiles.map((p) => p.id);
  let roles: UserRoleRow[] = [];
  try {
    // Tests inject a minimal client; in real Supabase usage this would
    // be `.in("user_id", userIds)`. We use a thin shim so the helper
    // is testable without taking a hard dependency on the SDK chain.
    const builder = client.from("user_roles").select("user_id, role");
    const res =
      typeof builder.in === "function"
        ? await builder.in("user_id", userIds)
        : await builder;
    const { data, error } = res as {
      data: UserRoleRow[] | null;
      error: unknown;
    };
    if (error) {
      return {
        ok: false,
        engagement_id: engagementId,
        reason: "lookup_failed",
        detail: String((error as { message?: string })?.message ?? error),
      };
    }
    roles = (data ?? []).filter((r) => userIds.includes(r.user_id));
  } catch (e) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "lookup_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const elevatedByUser = new Map<string, "org_admin" | "platform_admin">();
  for (const r of roles) {
    if (r.role === "platform_admin") {
      elevatedByUser.set(r.user_id, "platform_admin");
    } else if (
      r.role === "org_admin" &&
      elevatedByUser.get(r.user_id) !== "platform_admin"
    ) {
      elevatedByUser.set(r.user_id, "org_admin");
    }
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // 4. Build recipient list from the intersection: user must be in the
  //    initiating-org profile set AND hold an admin role.
  const seenUser = new Set<string>();
  const seenEmail = new Set<string>();
  const recipients: InitiatorRecipient[] = [];
  for (const [userId, role] of elevatedByUser.entries()) {
    if (seenUser.has(userId)) continue;
    const profile = profileById.get(userId);
    if (!profile) continue;
    const email = profile.email?.trim().toLowerCase();
    if (!email) continue;
    if (seenEmail.has(email)) continue;
    seenUser.add(userId);
    seenEmail.add(email);
    recipients.push({ user_id: userId, email, role });
  }

  if (recipients.length === 0) {
    return {
      ok: false,
      engagement_id: engagementId,
      reason: "no_eligible_admins",
    };
  }

  // 5. Honour hard suppression (bounce/complaint) if a checker is
  //    provided. Marketing unsubscribe is INTENTIONALLY not consulted
  //    here — operational/transactional D4c notices are not blocked by
  //    marketing unsubscribe per the signed workflow form.
  if (checkHardSuppression) {
    try {
      const suppressed = await checkHardSuppression(
        recipients.map((r) => r.email),
      );
      const remaining = recipients.filter((r) => !suppressed.has(r.email));
      if (remaining.length === 0) {
        return {
          ok: false,
          engagement_id: engagementId,
          reason: "no_eligible_admins",
          detail: "all candidates hard-suppressed",
        };
      }
      return {
        ok: true,
        engagement_id: engagementId,
        initiating_org_id: initiatingOrgId,
        recipients: remaining,
      };
    } catch (e) {
      return {
        ok: false,
        engagement_id: engagementId,
        reason: "lookup_failed",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    ok: true,
    engagement_id: engagementId,
    initiating_org_id: initiatingOrgId,
    recipients,
  };
}
