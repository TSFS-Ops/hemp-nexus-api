/**
 * admin-notification-preferences
 *
 * Compliance-review endpoint: returns the cross-user join of
 *   profiles
 *   ⨝ notification_preferences      (preferences jsonb, updated_at)
 *   ⨝ suppressed_emails (email)     (unsubscribe / bounce / complaint)
 *
 * Filters (query string or JSON body):
 *   search        — case-insensitive ILIKE over email / full_name
 *   org_id        — restrict to a single organisation
 *   suppression   — 'any' | 'none' | 'unsubscribe' | 'bounce' | 'complaint'
 *   channel       — restrict to users where preferences.<channel>.enabled = false
 *                   (channel name validated against ALLOWED_CHANNELS)
 *   limit (≤500), offset
 *
 * Access:
 *   - Authenticated JWT only.
 *   - Caller must hold platform_admin OR auditor OR org_admin.
 *   - org_admin is auto-scoped to their own organisation; they cannot
 *     read prefs for users in another org. platform_admin / auditor are
 *     unrestricted.
 *
 * Never returns raw auth.users rows; only the safe public-profile
 * projection plus prefs/suppression. Always logs a single
 * `notification_preferences.admin_viewed` audit row.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";

const PLATFORM_ROLES = ["platform_admin", "auditor"];
const ALL_ADMIN_ROLES = ["platform_admin", "auditor", "org_admin"];
const ALLOWED_CHANNELS = [
  "email",
  "in_app",
  "engagement_email",
  "engagement_in_app",
  "binding_review_email",
  "binding_review_in_app",
  "dispute_email",
  "dispute_in_app",
  "system_email",
  "marketing_email",
];

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const cors = handleCors(req, allowedOrigins);
    if (cors) return cors;
    if (req.method !== "GET" && req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- Auth ----------------------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new ApiException("UNAUTHORIZED", "Missing authentication", 401);
    }
    const token = authHeader.slice(7);
    const { data: claims, error: claimsErr } = await admin.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      throw new ApiException("UNAUTHORIZED", "Invalid token", 401);
    }
    const callerId = claims.claims.sub as string;

    const { data: rolesRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
    const isPlatform = roles.some((r) => PLATFORM_ROLES.includes(r));
    const isAdminTier = roles.some((r) => ALL_ADMIN_ROLES.includes(r));
    if (!isAdminTier) {
      throw new ApiException(
        "FORBIDDEN",
        "Notification preference review requires platform_admin, auditor or org_admin.",
        403,
      );
    }

    // --- Filters -------------------------------------------------------
    const url = new URL(req.url);
    const params = req.method === "POST" ? (await req.json().catch(() => ({}))) : Object.fromEntries(url.searchParams);
    const search       = (params.search ?? null) as string | null;
    let   orgIdFilter  = (params.org_id ?? null) as string | null;
    const suppression  = (params.suppression ?? "any") as string;
    const channel      = (params.channel ?? null) as string | null;
    const limit        = Math.min(parseInt(String(params.limit ?? "100")), 500);
    const offset       = Math.max(0, parseInt(String(params.offset ?? "0")));

    if (channel && !ALLOWED_CHANNELS.includes(channel)) {
      throw new ApiException("VALIDATION_ERROR", `Unknown channel '${channel}'`, 400);
    }
    if (!["any", "none", "unsubscribe", "bounce", "complaint"].includes(suppression)) {
      throw new ApiException("VALIDATION_ERROR", `Invalid suppression filter`, 400);
    }

    // org_admin is forcibly scoped to their own org.
    if (!isPlatform) {
      const { data: prof } = await admin
        .from("profiles").select("org_id").eq("id", callerId).maybeSingle();
      const callerOrgId = prof?.org_id as string | undefined;
      if (!callerOrgId) {
        throw new ApiException("FORBIDDEN", "Caller has no organisation context", 403);
      }
      if (orgIdFilter && orgIdFilter !== callerOrgId) {
        throw new ApiException("FORBIDDEN", "Cross-org reads require platform_admin or auditor.", 403);
      }
      orgIdFilter = callerOrgId;
    }

    // --- Build profile query ------------------------------------------
    let q = admin
      .from("profiles")
      .select(
        "id, email, full_name, org_id, status, created_at, organizations:org_id(name)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (orgIdFilter) q = q.eq("org_id", orgIdFilter);
    if (search) {
      const safe = search.replace(/[%_,]/g, "\\$&").slice(0, 200);
      q = q.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
    }

    const { data: profiles, error: profErr, count } = await q;
    if (profErr) handleDatabaseError(profErr, requestId);

    // --- Fetch prefs + suppression for the page ------------------------
    const userIds = (profiles ?? []).map((p: { id: string }) => p.id);
    const emails  = (profiles ?? [])
      .map((p: { email: string | null }) => (p.email ?? "").toLowerCase())
      .filter(Boolean);

    const [{ data: prefs }, { data: suppressed }] = await Promise.all([
      userIds.length
        ? admin.from("notification_preferences")
            .select("user_id, preferences, updated_at")
            .in("user_id", userIds)
        : Promise.resolve({ data: [] as Array<{ user_id: string; preferences: Record<string, unknown>; updated_at: string }> }),
      emails.length
        ? admin.from("suppressed_emails")
            .select("email, reason, created_at, metadata")
            .in("email", emails)
        : Promise.resolve({ data: [] as Array<{ email: string; reason: string; created_at: string; metadata: unknown }> }),
    ]);

    const prefsByUser = new Map<string, { preferences: Record<string, any>; updated_at: string }>();
    for (const p of (prefs ?? []) as any[]) prefsByUser.set(p.user_id, { preferences: p.preferences ?? {}, updated_at: p.updated_at });
    const suppByEmail = new Map<string, { reason: string; created_at: string; metadata: unknown }>();
    for (const s of (suppressed ?? []) as any[]) suppByEmail.set((s.email ?? "").toLowerCase(), s);

    // --- Compose + filter ---------------------------------------------
    type Row = {
      user_id: string;
      email: string | null;
      full_name: string | null;
      org_id: string | null;
      org_name: string | null;
      account_status: string | null;
      created_at: string;
      preferences: Record<string, any>;
      preferences_updated_at: string | null;
      suppression_reason: string | null;
      suppression_at: string | null;
    };

    const allRows: Row[] = (profiles ?? []).map((p: any) => {
      const supp = suppByEmail.get((p.email ?? "").toLowerCase());
      const pref = prefsByUser.get(p.id);
      return {
        user_id:                p.id,
        email:                  p.email ?? null,
        full_name:              p.full_name ?? null,
        org_id:                 p.org_id ?? null,
        org_name:               p.organizations?.name ?? null,
        account_status:         p.status ?? null,
        created_at:             p.created_at,
        preferences:            pref?.preferences ?? {},
        preferences_updated_at: pref?.updated_at ?? null,
        suppression_reason:     supp?.reason ?? null,
        suppression_at:         supp?.created_at ?? null,
      };
    });

    const filtered = allRows.filter((r) => {
      if (suppression === "none"  && r.suppression_reason !== null) return false;
      if (suppression !== "any" && suppression !== "none" && r.suppression_reason !== suppression) return false;
      if (channel) {
        const ch = r.preferences?.[channel];
        const enabled = typeof ch === "boolean" ? ch : (ch?.enabled !== false);
        if (enabled) return false; // we only want disabled-for-channel users
      }
      return true;
    });

    // --- Audit the admin view (best-effort) ----------------------------
    try {
      await admin.from("admin_audit_logs").insert({
        admin_user_id: callerId,
        action: "notification_preferences.admin_viewed",
        target_type: "notification_preferences",
        target_id: null,
        details: {
          request_id: requestId,
          filters: { search, org_id: orgIdFilter, suppression, channel },
          returned: filtered.length,
          page_size: limit,
          offset,
        },
      });
    } catch (e) {
      console.warn(`[${requestId}] audit insert failed:`, e);
    }

    return new Response(
      JSON.stringify({
        items: filtered,
        totalCount: count ?? filtered.length,
        page: { limit, offset },
        filters: { search, org_id: orgIdFilter, suppression, channel },
        requestId,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err instanceof Error ? err : new Error("Unknown error"), requestId, headers);
  }
});
