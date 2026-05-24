/**
 * aal-preflight
 * ─────────────
 * Read-only utility endpoint. Tells the caller whether their CURRENT
 * Bearer-token session satisfies the AAL2 / MFA requirement for a given
 * mutating action, WITHOUT executing the action.
 *
 * Purpose: let the UI (or an admin operator) check "would my next call
 * to admin-credit-org / admin-match-legacy-repair / etc succeed on the
 * MFA gate?" before triggering the real mutation. This avoids burning
 * idempotency keys or producing audit noise just to probe AAL.
 *
 * Contract:
 *   POST /aal-preflight
 *   Body: { action: string }
 *   Auth: Authorization: Bearer <JWT> (required)
 *
 *   200 OK { ok: true,  ready: true,  observed_aal, action, requires_aal2: true,
 *            user_id, has_verified_mfa_factor }
 *   200 OK { ok: true,  ready: false, observed_aal, action, requires_aal2: true,
 *            user_id, has_verified_mfa_factor, reason: "MFA_REQUIRED" | "NO_MFA_FACTOR" }
 *   200 OK { ok: true,  ready: true,  action, requires_aal2: false } // action not gated
 *   400      { ok: false, code: "INVALID_BODY" | "UNKNOWN_ACTION" }
 *   401      { ok: false, code: "UNAUTHENTICATED" }
 *
 * Never throws MFA_REQUIRED. This endpoint is intentionally introspective
 * and DOES NOT mutate state, dispatch notifications, or write audit rows.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { readAal } from "../_shared/aal.ts";

// Registry of mutating actions and whether they require AAL2.
// Keep in sync with assertAal2() call-sites under supabase/functions/.
// If a new aal2-gated endpoint is added, add its action key here.
export const ACTION_AAL_REQUIREMENTS: Record<string, "aal2" | "aal1"> = {
  // Money / credit movement
  "admin.credit_org": "aal2",
  // Lifecycle / state overrides
  "admin.lifecycle_scheduler.invoke": "aal2",
  "admin.match_legacy_repair": "aal2",
  "admin.match_legacy_archive": "aal2",
  "admin.match_corrections": "aal2",
  "admin.counterparty_corrections": "aal2",
  "admin.manual_override": "aal2",
  "admin.risk_item_resolve": "aal2",
  "admin.named_contact_override": "aal2",
  // Challenge lifecycle sensitive transitions
  "match_challenge.transition_outcome_recorded": "aal2",
  "match_challenge.transition_closed_no_action": "aal2",
  "match_challenge.platform_admin_override": "aal2",
  "match_challenge.break_glass": "aal2",
  // Compliance / governance
  "dd.approval_rejected": "aal2",
  "programme.budget_update": "aal2",
  "programme.participant_archive": "aal2",
  "programme.fund_flow_create": "aal2",
  "programme.report_sensitive_view": "aal2",
  "notification_preference.admin_change": "aal2",
  "notification_preference.sensitive_change": "aal2",
  // SEC-001 — newly gated sensitive platform_admin mutations
  "entity.mutate": "aal2",
  "organisation.mutate": "aal2",
  "authority.bind": "aal2",
  "trade.approval_override": "aal2",
  "pending_engagement.send_outreach": "aal2",
  "reputation.recalculate": "aal2",
  // DATA-010 Phase 1 — sensitive admin export gate
  "export.admin_pii_export": "aal2",
  // DATA-003 Phase 1 — legal hold apply/release (admin-legal-hold)
  "admin.legal_hold": "aal2",
  // SEC-001 follow-up — fixture password-recovery dispatch (admin-only)
  "admin.user_recovery_dispatch": "aal2",
  // SEC-001 follow-up — governance-doc validation (token burn + status change)
  "governance.doc_validate": "aal2",
  // DATA-009 Phase 2 — residency review approve/decline (platform_admin)
  "data_009.approve_residency_review": "aal2",
  "data_009.decline_residency_review": "aal2",
  // break-glass uses fresh password re-auth via GoTrue, not the JWT aal
  // claim, so it is intentionally NOT listed here as aal2-gated for
  // preflight purposes. See scripts/check-aal-registry-drift.mjs allowlist.
};


const BodySchema = z.object({
  action: z.string().min(1).max(128),
}).strict();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return withCors(req, new Response(
      JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    ));
  }

  // Parse body
  let parsed: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const r = BodySchema.safeParse(raw);
    if (!r.success) {
      return withCors(req, new Response(
        JSON.stringify({ ok: false, code: "INVALID_BODY", issues: r.error.flatten() }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ));
    }
    parsed = r.data;
  } catch {
    return withCors(req, new Response(
      JSON.stringify({ ok: false, code: "INVALID_BODY" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return withCors(req, new Response(
      JSON.stringify({ ok: false, code: "UNAUTHENTICATED" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));
  }

  // Verify caller via auth.getUser (does NOT escalate JWT aal).
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return withCors(req, new Response(
      JSON.stringify({ ok: false, code: "UNAUTHENTICATED" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));
  }
  const userId = userData.user.id;

  // Look up the registered requirement for this action.
  const requirement = ACTION_AAL_REQUIREMENTS[parsed.action];
  if (!requirement) {
    return withCors(req, new Response(
      JSON.stringify({
        ok: false,
        code: "UNKNOWN_ACTION",
        message: `Action '${parsed.action}' is not in the AAL registry. Add it to ACTION_AAL_REQUIREMENTS if it is a real aal2-gated endpoint.`,
        known_actions: Object.keys(ACTION_AAL_REQUIREMENTS),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
  }

  const observedAal = readAal(authHeader);

  // Check whether the user has any verified TOTP factor — useful so the
  // UI can distinguish "needs to enrol" from "enrolled but session is aal1".
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let hasVerifiedFactor = false;
  try {
    const { data: factors } = await admin
      .schema("auth" as never)
      .from("mfa_factors")
      .select("id, status, factor_type")
      .eq("user_id", userId)
      .eq("status", "verified");
    hasVerifiedFactor = Array.isArray(factors) && factors.length > 0;
  } catch (e) {
    console.error("[aal-preflight] mfa_factors lookup failed:", e);
  }

  if (requirement === "aal1") {
    return withCors(req, new Response(
      JSON.stringify({
        ok: true,
        ready: true,
        action: parsed.action,
        requires_aal2: false,
        observed_aal: observedAal,
        user_id: userId,
        has_verified_mfa_factor: hasVerifiedFactor,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  }

  const ready = observedAal === "aal2";
  const reason = ready
    ? undefined
    : hasVerifiedFactor
      ? "MFA_REQUIRED"     // factor enrolled, but session was not MFA-challenged
      : "NO_MFA_FACTOR";   // user must enrol TOTP first at /desk/settings/security

  return withCors(req, new Response(
    JSON.stringify({
      ok: true,
      ready,
      action: parsed.action,
      requires_aal2: true,
      observed_aal: observedAal,
      user_id: userId,
      has_verified_mfa_factor: hasVerifiedFactor,
      ...(reason ? { reason } : {}),
      ...(reason === "MFA_REQUIRED"
        ? { remediation: "Sign in again and complete your TOTP challenge to upgrade the session to aal2." }
        : reason === "NO_MFA_FACTOR"
          ? { remediation: "Enrol an authenticator app at Desk → Settings → Security, then sign in again and complete the TOTP challenge." }
          : {}),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
});
