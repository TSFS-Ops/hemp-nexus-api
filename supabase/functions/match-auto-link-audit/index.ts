// =============================================================================
// match-auto-link-audit
// =============================================================================
// Returns the auto-link audit history for a given match: which buyer/seller
// slot was filled by the auto_link_engagement_on_signup trigger, when, and
// which signing-up profile triggered it.
//
// Source: admin_audit_logs entries with action = 'engagement.auto_linked'.
// The trigger writes one log row per profile insert that linked one or more
// engagements; the row's `details.filled_slots[]` array contains an entry per
// affected match with { match_id, engagement_id, filled_slot }.
//
// Auth: JWT only. Caller must hold one of: platform_admin, auditor, org_admin.
// API-key access is intentionally not granted (admin forensic surface).
//
// Endpoints:
//   GET /match-auto-link-audit?match_id=<uuid>
//   POST /match-auto-link-audit  { "match_id": "<uuid>" }
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { cacheHeaders } from "../_shared/cache.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = ["platform_admin", "auditor", "org_admin"];

interface FilledSlotEntry {
  match_id: string | null;
  engagement_id: string | null;
  filled_slot: "buyer" | "seller" | null;
}

interface AutoLinkLogRow {
  id: string;
  created_at: string;
  target_id: string | null; // profile id (auth user id) of the new signup
  details: {
    user_email?: string | null;
    org_id?: string | null;
    linked_engagement_count?: number | null;
    welcome_email_dispatched?: boolean | null;
    filled_slots?: FilledSlotEntry[] | null;
  } | null;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET" && req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate (JWT only — admin forensic endpoint)
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    if (authCtx.isApiKey) {
      throw new ApiException(
        "FORBIDDEN",
        "API-key access is not permitted on this admin forensic endpoint.",
        403
      );
    }

    // Authorize: must hold an admin/auditor role
    const { data: callerRoles, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authCtx.userId);
    if (roleErr) handleDatabaseError(roleErr, requestId);
    const roleNames = (callerRoles || []).map((r: { role: string }) => r.role);
    if (!roleNames.some((r) => ADMIN_ROLES.includes(r))) {
      throw new ApiException(
        "FORBIDDEN",
        "Auto-link audit details are restricted to platform admins, auditors, and org admins.",
        403
      );
    }

    // Resolve match_id from query string or body
    let matchId: string | null = null;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      matchId = typeof body?.match_id === "string" ? body.match_id : null;
    } else {
      matchId = new URL(req.url).searchParams.get("match_id");
    }

    if (!matchId || !UUID_RE.test(matchId)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "match_id is required and must be a valid UUID.",
        400
      );
    }

    console.log(`[${requestId}] match-auto-link-audit match_id=${matchId} user=${authCtx.userId}`);

    // Confirm the match exists and capture current slot state for context
    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id, metadata, created_at, state, poi_state")
      .eq("id", matchId)
      .maybeSingle();

    if (matchErr) handleDatabaseError(matchErr, requestId);
    if (!match) {
      throw new ApiException("NOT_FOUND", "Match not found.", 404);
    }

    // Pull all auto-link audit rows that mention this match in their
    // details.filled_slots[] array. Postgres jsonb @> containment is the
    // cheapest accurate match.
    const containmentFilter = JSON.stringify({
      filled_slots: [{ match_id: matchId }],
    });

    const { data: rawLogs, error: logsErr } = await supabase
      .from("admin_audit_logs")
      .select("id, created_at, target_id, details")
      .eq("action", "engagement.auto_linked")
      .filter("details", "cs", containmentFilter)
      .order("created_at", { ascending: false })
      .limit(200);

    if (logsErr) handleDatabaseError(logsErr, requestId);

    const logs = (rawLogs || []) as AutoLinkLogRow[];

    // Collect distinct profile ids so we can hydrate triggering-profile detail
    const profileIds = Array.from(
      new Set(
        logs
          .map((l) => l.target_id)
          .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
      )
    );

    let profilesById: Record<string, { id: string; org_id: string | null; full_name: string | null }> = {};
    if (profileIds.length > 0) {
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("id, org_id, full_name")
        .in("id", profileIds);
      if (profilesErr) handleDatabaseError(profilesErr, requestId);
      profilesById = Object.fromEntries(
        (profiles || []).map((p: { id: string; org_id: string | null; full_name: string | null }) => [p.id, p])
      );
    }

    // Project one entry per slot-fill for this match (a single trigger run
    // can fill multiple matches; we only return the rows that touch ours).
    const entries = logs.flatMap((log) => {
      const slots = Array.isArray(log.details?.filled_slots) ? log.details!.filled_slots! : [];
      return slots
        .filter((s) => s && s.match_id === matchId)
        .map((s) => {
          const profile = log.target_id ? profilesById[log.target_id] : undefined;
          return {
            audit_log_id: log.id,
            timestamp: log.created_at,
            filled_slot: s.filled_slot,                 // 'buyer' | 'seller' | null
            engagement_id: s.engagement_id,
            triggering_profile: {
              profile_id: log.target_id,
              org_id: log.details?.org_id ?? profile?.org_id ?? null,
              email: log.details?.user_email ?? null,   // captured at trigger time
              full_name: profile?.full_name ?? null,
            },
            welcome_email_dispatched: log.details?.welcome_email_dispatched ?? null,
          };
        });
    });

    return new Response(
      JSON.stringify({
        match: {
          id: match.id,
          creator_org_id: match.org_id,
          buyer_org_id: match.buyer_org_id,
          seller_org_id: match.seller_org_id,
          // OWNERSHIP: `metadata.tradeSide` is the **creator's** declared
          // side at the time the match record was created (creator-owned,
          // not viewer- or counterparty-owned). Never read as the
          // counterparty's side. See _shared/auto-link-trigger_integration_test.ts:260.
          declared_trade_side: (match.metadata as { tradeSide?: string } | null)?.tradeSide ?? null,
          state: match.state,
          poi_state: match.poi_state,
          created_at: match.created_at,
        },
        auto_link_events: entries,
        total: entries.length,
        request_id: requestId,
      }),
      {
        status: 200,
        headers: {
          ...headers,
          ...cacheHeaders("private-short"),
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
      requestId,
      headers
    );
  }
});
