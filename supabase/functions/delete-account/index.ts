// Self-service account deletion (soft-delete + 30-day grace).
//
// Guards before allowing deletion:
//   1. Caller must be authenticated.
//   2. Caller cannot be the *sole* org_admin of an org that has other members.
//      (They must promote/transfer first to avoid orphaning the org.)
//   3. Caller's org cannot have any in-flight POIs (PENDING_APPROVAL, ELIGIBLE,
//      COMPLETION_REQUESTED) — those represent live commercial obligations.
//
// On success:
//   - profile.status -> 'pending_deletion'
//   - PII anonymised (full_name, full_name_previous nulled, email rewritten
//     to a non-routable placeholder).
//   - deletion_requested_at stamped (drives 30-day grace job).
//   - All user_roles for this user revoked so they lose org access immediately.
//   - admin_audit_logs entry written (action: 'account.self_deleted').
//   - auth.users record signed out — they can sign back in within 30 days
//     to cancel deletion (hard-delete sweep handled by future scheduled job).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertNoLegalHold } from "../_shared/legal-hold.ts";


const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id",
};

const json = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));

const withRequestId = (req: Request, body: Record<string, unknown>) => ({
  ...body,
  request_id: req.headers.get("x-request-id") ?? crypto.randomUUID(),
});

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req); if (__pf) return __pf;
  if (req.method !== "POST") return json(req, withRequestId(req, { error: "method_not_allowed" }), 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Identify the caller from their JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(req, withRequestId(req, { error: "unauthorized" }), 401);
  const user = userData.user;

  // Parse confirmation payload.
  let body: { confirmation?: string; reason?: string; category?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }
  if (!body.confirmation || body.confirmation.trim().toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return json(req, 
      withRequestId(req, { error: "confirmation_mismatch", message: "Type your email exactly to confirm." }),
      400,
    );
  }

  // Reason is now MANDATORY so platform admins can see why users leave.
  const ALLOWED_CATEGORIES = new Set([
    "no_longer_needed",
    "switched_provider",
    "privacy_concerns",
    "missing_features",
    "too_complex",
    "cost",
    "other",
  ]);
  const reasonText = (body.reason ?? "").trim();
  const categoryRaw = (body.category ?? "").trim();
  if (reasonText.length < 5) {
    return json(req, 
      withRequestId(req, {
        error: "reason_required",
        message: "Tell us why you're leaving (at least 5 characters). This helps us improve.",
      }),
      400,
    );
  }
  if (!ALLOWED_CATEGORIES.has(categoryRaw)) {
    return json(req, 
      withRequestId(req, {
        error: "category_required",
        message: "Pick a reason category before deleting your account.",
      }),
      400,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Look up profile + org.
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, org_id, status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr || !profile) return json(req, withRequestId(req, { error: "profile_not_found" }), 404);
  if (profile.status === "pending_deletion") {
    return json(req, withRequestId(req, { error: "already_pending_deletion" }), 409);
  }

  // 3. Sole-admin guard.
  const { data: callerRoles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const isOrgAdmin = (callerRoles ?? []).some((r) => r.role === "org_admin");

  if (isOrgAdmin) {
    const { data: orgMembers } = await admin
      .from("profiles")
      .select("id")
      .eq("org_id", profile.org_id)
      .neq("status", "pending_deletion");
    const memberIds = (orgMembers ?? []).map((m) => m.id).filter((id) => id !== user.id);

    if (memberIds.length > 0) {
      const { data: otherAdmins } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "org_admin")
        .in("user_id", memberIds);
      if ((otherAdmins ?? []).length === 0) {
        return json(req, 
          withRequestId(req, {
            error: "sole_org_admin",
            message:
              "You are the only admin for this organisation. Promote a colleague to admin before deleting your account.",
          }),
          409,
        );
      }
    }
  }

  // 4. Active commercial obligation guard.
  const { count: activePoiCount } = await admin
    .from("pois")
    .select("id", { count: "exact", head: true })
    .eq("org_id", profile.org_id)
    .in("state", ["PENDING_APPROVAL", "ELIGIBLE", "COMPLETION_REQUESTED"]);

  if ((activePoiCount ?? 0) > 0) {
    return json(req, 
      withRequestId(req, {
        error: "active_obligations",
        message: `Your organisation has ${activePoiCount} live trade(s) in progress. Resolve or cancel them before deleting your account.`,
      }),
      409,
    );
  }

  // 4b. DATA-003: legal hold check. Block self-deletion if an active hold
  //     covers the user or their org.
  const holdCheck = await assertNoLegalHold(
    admin,
    [
      { scope_type: "user", scope_id: user.id },
      ...(profile.org_id ? [{ scope_type: "org" as const, scope_id: profile.org_id }] : []),
    ],
    {
      action: "delete-account.self_delete",
      actorUserId: user.id,
      actorOrgId: profile.org_id,
      requestId: req.headers.get("x-request-id"),
    },
  );
  if (holdCheck.blocked) {
    return json(req,
      withRequestId(req, {
        error: "legal_hold_active",
        code: holdCheck.code,
        message: holdCheck.message,
        legal_hold_id: holdCheck.activeHold?.id ?? null,
      }),
      409,
    );
  }

  // 5. Anonymise + soft-delete profile.
  const placeholderEmail = `deleted+${user.id}@deleted.izenzo.local`;

  const { error: updateErr } = await admin
    .from("profiles")
    .update({
      status: "pending_deletion",
      deletion_requested_at: new Date().toISOString(),
      deletion_reason: reasonText.slice(0, 500),
      deletion_category: categoryRaw,
      full_name: null,
      full_name_previous: null,
      email: placeholderEmail,
    })
    .eq("id", user.id);
  if (updateErr) {
    console.error("[delete-account] profile update failed", updateErr);
    return json(req, withRequestId(req, { error: "update_failed" }), 500);
  }

  // 6. Revoke all roles.
  await admin.from("user_roles").delete().eq("user_id", user.id);

  // 6b. Batch O DATA-004: scrub PII out of email logs + notifications
  //     so the deleted user's address/name are not left behind during
  //     the 30-day grace window.
  try {
    await admin.rpc("scrub_user_pii", { p_user_id: user.id });
  } catch (e) {
    console.warn("[delete-account] scrub_user_pii warning", e);
  }

  // 7. Audit log.
  await admin.from("admin_audit_logs").insert({
    admin_user_id: user.id,
    action: "account.self_deleted",
    target_type: "profile",
    target_id: user.id,
    details: {
      org_id: profile.org_id,
      reason: reasonText,
      category: categoryRaw,
      grace_period_days: 30,
    },
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
  });

  // 8. Sign the user out (best-effort — auth user kept for 30-day grace).
  try {
    await admin.auth.admin.signOut(user.id);
  } catch (e) {
    console.warn("[delete-account] signOut warning", e);
  }

  return json(req, {
    ok: true,
    grace_period_days: 30,
    message:
      "Account scheduled for deletion. Sign in within 30 days to cancel.",
  });
});
