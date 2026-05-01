/**
 * Admin User Journey Edge Function
 *
 * Returns a comprehensive, read-only view of a single user's lifecycle so
 * platform admins can answer "what has this person actually done, what are
 * they waiting on, and (if they left) why?" without spelunking the database.
 *
 * Surfaces:
 *   - Profile (incl. soft-delete reason/category/timestamp)
 *   - Roles
 *   - Organisation snapshot (name, status)
 *   - Token wallet balance + last 25 credit/token transactions (revenue trail)
 *   - Last 25 POIs the org has created (commercial activity)
 *   - Last 25 matches the org is party to
 *   - Last 25 trade requests the user authored
 *   - Pending trade-approval queue items waiting on this user / their org
 *   - Last 50 admin_audit_logs targeting this user
 *   - Last 50 audit_logs the user emitted
 *   - account.self_deleted entry (deletion reason + category, if present)
 *
 * Auth: platform_admin only. Read-only — never mutates anything except an
 * audit log entry recording who looked at whose journey (FOI/POPIA trail).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req); if (__pf) return __pf;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(req, { error: "Unauthorised" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return json(req, { error: "Invalid token" }, 401);
    const { data: isAdmin } = await admin.rpc("is_admin", { user_id: caller.id });
    if (!isAdmin) return json(req, { error: "Admin access required" }, 403);

    // ── Parse target user_id ─────────────────────────────────────────────
    let userId: string | null = null;
    if (req.method === "GET") {
      userId = new URL(req.url).searchParams.get("user_id");
    } else {
      try {
        const body = await req.json(req, );
        userId = body.user_id ?? null;
      } catch { /* allow */ }
    }
    if (!userId || !UUID_RE.test(userId)) {
      return json(req, { error: "Valid user_id (UUID) required" }, 400);
    }

    // ── Load profile ─────────────────────────────────────────────────────
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select(
        "id, email, full_name, full_name_previous, org_id, status, created_at, updated_at, deletion_requested_at, deletion_reason, deletion_category",
      )
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) return json(req, { error: profileErr.message }, 500);
    if (!profile) return json(req, { error: "Profile not found" }, 404);

    // ── Auth user (last sign-in, confirmation) ───────────────────────────
    let authUserSummary: Record<string, unknown> = {};
    try {
      const { data: au } = await admin.auth.admin.getUserById(userId);
      const u = au?.user;
      if (u) {
        authUserSummary = {
          email: u.email,
          email_confirmed_at: u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          created_at: u.created_at ?? null,
          providers: u.app_metadata?.providers ?? [],
        };
      }
    } catch (e) {
      console.warn("[admin-user-journey] auth lookup failed", e);
    }

    // ── Org snapshot ─────────────────────────────────────────────────────
    let organisation: Record<string, unknown> | null = null;
    if (profile.org_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("id, name, status, created_at")
        .eq("id", profile.org_id)
        .maybeSingle();
      organisation = org ?? null;
    }

    // ── Roles ────────────────────────────────────────────────────────────
    const { data: roles } = await admin
      .from("user_roles")
      .select("role, created_at")
      .eq("user_id", userId);

    // ── Token wallet + recent transactions (credit purchase trail) ───────
    let wallet: Record<string, unknown> | null = null;
    let tokenTransactions: any[] = [];
    if (profile.org_id) {
      const { data: w } = await admin
        .from("token_wallets")
        .select("id, balance, updated_at")
        .eq("org_id", profile.org_id)
        .maybeSingle();
      wallet = w ?? null;

      const { data: txs } = await admin
        .from("token_transactions")
        .select("id, type, amount, balance_before, balance_after, created_at, idempotency_key")
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: false })
        .limit(25);
      tokenTransactions = txs ?? [];
    }

    // ── Recent POIs ──────────────────────────────────────────────────────
    let pois: any[] = [];
    if (profile.org_id) {
      const { data } = await admin
        .from("pois")
        .select("id, state, poi_type, industry_code, jurisdiction_code, created_at, last_activity_at")
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: false })
        .limit(25);
      pois = data ?? [];
    }

    // ── Recent matches (org is party) ────────────────────────────────────
    let matches: any[] = [];
    if (profile.org_id) {
      const { data } = await admin
        .from("matches")
        .select("id, status, state, commodity, quantity_amount, quantity_unit, price_amount, price_currency, buyer_name, seller_name, created_at")
        .or(`buyer_org_id.eq.${profile.org_id},seller_org_id.eq.${profile.org_id},org_id.eq.${profile.org_id}`)
        .order("created_at", { ascending: false })
        .limit(25);
      matches = data ?? [];
    }

    // ── Trade requests authored by this user ─────────────────────────────
    const { data: tradeRequests } = await admin
      .from("trade_requests")
      .select("id, side, commodity, quantity_amount, quantity_unit, price_amount, price_currency, status, match_type, created_at")
      .eq("created_by", userId)
      .order("created_at", { ascending: false })
      .limit(25);

    // ── Pending trade approvals waiting on user / org ────────────────────
    let pendingApprovals: any[] = [];
    {
      // dd_approval_requests has assignee_user_id / org_id columns in many
      // setups — query defensively.
      const { data, error } = await admin
        .from("dd_approval_requests")
        .select("*")
        .or(`requester_user_id.eq.${userId}${profile.org_id ? `,org_id.eq.${profile.org_id}` : ""}`)
        .order("created_at", { ascending: false })
        .limit(25);
      if (!error) pendingApprovals = data ?? [];
    }

    // ── Admin audit logs targeting this user ─────────────────────────────
    const { data: adminAudit } = await admin
      .from("admin_audit_logs")
      .select("id, action, target_type, target_id, details, ip_address, created_at, admin_user_id")
      .or(`target_id.eq.${userId},admin_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(50);

    // ── Audit logs the user emitted ──────────────────────────────────────
    const { data: userAudit } = await admin
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, metadata, created_at")
      .eq("actor_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    // ── Notification dispatches (was the user notified of anything?) ─────
    let notifications: any[] = [];
    {
      const { data } = await admin
        .from("notifications")
        .select("id, kind, title, body, created_at, read_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(25);
      notifications = data ?? [];
    }

    // ── POI engagements where this user is the inviter / contact ─────────
    let poiEngagements: any[] = [];
    if (profile.org_id) {
      const { data } = await admin
        .from("poi_engagements")
        .select("*")
        .or(`invited_by_user_id.eq.${userId},org_id.eq.${profile.org_id}`)
        .order("created_at", { ascending: false })
        .limit(25);
      poiEngagements = data ?? [];
    }

    // ── Audit the lookup itself ──────────────────────────────────────────
    await admin.from("admin_audit_logs").insert({
      admin_user_id: caller.id,
      action: "user_journey.viewed",
      target_type: "profile",
      target_id: userId,
      details: { viewed_at: new Date().toISOString() },
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    return json(req, {
      profile: {
        ...profile,
        ...authUserSummary,
      },
      organisation,
      roles: (roles ?? []).map((r: any) => r.role),
      role_records: roles ?? [],
      wallet,
      token_transactions: tokenTransactions,
      pois,
      matches,
      trade_requests: tradeRequests ?? [],
      pending_approvals: pendingApprovals,
      admin_audit_logs: adminAudit ?? [],
      audit_logs: userAudit ?? [],
      notifications,
      poi_engagements: poiEngagements,
    });
  } catch (error) {
    console.error("[admin-user-journey] error", error);
    return json(req, { error: "Internal server error" }, 500);
  }
});
