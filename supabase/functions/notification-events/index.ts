/**
 * notification-events
 *
 * Authenticated, paginated query for notification-related events scoped to
 * the caller's organisation:
 *
 *   • notification_preference.changed
 *   • notification_preference.admin_change
 *   • notification_preference.sensitive_change
 *   • notification.dispatched
 *   • notification.auto_resolve_failed
 *   • notification_skipped
 *
 * Access:
 *   - JWT callers must hold platform_admin / auditor / org_admin, OR pass
 *     ?scope=self (returns only rows whose actor_user_id or
 *     metadata.target_user_id equals the caller).
 *   - API-key callers need the `audit_logs` scope and burn a token.
 *
 * Filters (query string or JSON body):
 *   limit (max 100), offset, user_id, action, since, until, request_id.
 *
 * Notes:
 *   - `notification.auto_resolve_failed` rows are written against the
 *     system-sentinel org and are visible only to platform_admin / auditor.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { cacheHeaders } from "../_shared/cache.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";

const NOTIFICATION_ACTIONS = [
  "notification_preference.changed",
  "notification_preference.admin_change",
  "notification_preference.sensitive_change",
  "notification.dispatched",
  "notification.auto_resolve_failed",
  "notification_skipped",
] as const;

const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";
const ADMIN_VIEW_ROLES = ["platform_admin", "auditor", "org_admin"];
const PLATFORM_ROLES   = ["platform_admin", "auditor"];

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const cors = handleCors(req, allowedOrigins);
    if (cors) return cors;

    if (req.method !== "GET" && req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    // ---- Parse filters --------------------------------------------------
    const url = new URL(req.url);
    let limit = 50;
    let offset = 0;
    let action: string | null = null;
    let userIdFilter: string | null = null;
    let since: string | null = null;
    let until: string | null = null;
    let requestIdFilter: string | null = null;
    let scope: "org" | "self" = "org";

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      limit = Math.min(parseInt(String(body.limit ?? "50")), 100);
      offset = Math.max(0, parseInt(String(body.offset ?? "0")));
      action = body.action ?? null;
      userIdFilter = body.user_id ?? null;
      since = body.since ?? null;
      until = body.until ?? null;
      requestIdFilter = body.request_id ?? null;
      if (body.scope === "self") scope = "self";
    } else {
      limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
      offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0"));
      action = url.searchParams.get("action");
      userIdFilter = url.searchParams.get("user_id");
      since = url.searchParams.get("since");
      until = url.searchParams.get("until");
      requestIdFilter = url.searchParams.get("request_id");
      if (url.searchParams.get("scope") === "self") scope = "self";
    }

    if (action && !(NOTIFICATION_ACTIONS as readonly string[]).includes(action)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        `Unknown action. Allowed: ${NOTIFICATION_ACTIONS.join(", ")}`,
        400,
      );
    }

    // ---- Authorisation --------------------------------------------------
    let isPlatform = false;
    let isAdminTier = false;

    if (authCtx.isApiKey) {
      requireScope(authCtx, "audit_logs");
      await enforceTokenMetering(
        supabase, authCtx.orgId, authCtx.userId, "/notification-events", requestId,
      );
      isAdminTier = true; // API key gates by scope, treat as org-wide read.
    } else {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authCtx.userId);
      const roleNames = (roles ?? []).map((r: { role: string }) => r.role);
      isPlatform   = roleNames.some((r) => PLATFORM_ROLES.includes(r));
      isAdminTier  = roleNames.some((r) => ADMIN_VIEW_ROLES.includes(r));

      if (scope === "org" && !isAdminTier) {
        throw new ApiException(
          "FORBIDDEN",
          "Org-wide notification events require platform_admin, auditor or org_admin. Use scope=self to read your own events.",
          403,
        );
      }
      if (userIdFilter && userIdFilter !== authCtx.userId && !isAdminTier) {
        throw new ApiException(
          "FORBIDDEN",
          "Filtering by another user_id requires platform_admin, auditor or org_admin.",
          403,
        );
      }
    }

    // ---- Validate dates -------------------------------------------------
    function isoOrThrow(field: string, value: string | null): string | null {
      if (!value) return null;
      const d = new Date(value);
      if (isNaN(d.getTime())) {
        throw new ApiException(
          "VALIDATION_ERROR",
          `Invalid ${field} (expected ISO 8601, e.g. 2026-05-16T00:00:00Z)`,
          400,
        );
      }
      return d.toISOString();
    }
    const sinceIso = isoOrThrow("since", since);
    const untilIso = isoOrThrow("until", until);

    // ---- Build query ----------------------------------------------------
    // Org-sentinel rows (auto_resolve_failed) are returned only to
    // platform-tier callers; otherwise scope strictly to the caller's org.
    const orgScope: string[] = [authCtx.orgId];
    if (isPlatform || authCtx.isApiKey === false && isAdminTier === false ? false : isPlatform) {
      orgScope.push(SYSTEM_ORG_SENTINEL);
    }
    if (isPlatform && !orgScope.includes(SYSTEM_ORG_SENTINEL)) {
      orgScope.push(SYSTEM_ORG_SENTINEL);
    }

    let q = supabase
      .from("audit_logs")
      .select("id, org_id, actor_user_id, action, entity_type, entity_id, metadata, created_at", { count: "exact" })
      .in("org_id", orgScope)
      .in("action", action ? [action] : (NOTIFICATION_ACTIONS as readonly string[]))
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (scope === "self") {
      // Match rows authored by, or targeting, the caller.
      q = q.or(`actor_user_id.eq.${authCtx.userId},metadata->>target_user_id.eq.${authCtx.userId},metadata->>user_id.eq.${authCtx.userId}`);
    } else if (userIdFilter) {
      q = q.or(`actor_user_id.eq.${userIdFilter},metadata->>target_user_id.eq.${userIdFilter},metadata->>user_id.eq.${userIdFilter}`);
    }

    if (requestIdFilter) q = q.filter("metadata->>request_id", "eq", requestIdFilter);
    if (sinceIso)        q = q.gte("created_at", sinceIso);
    if (untilIso)        q = q.lte("created_at", untilIso);

    const { data, error, count } = await q;
    if (error) handleDatabaseError(error, requestId);

    console.log(
      `[${requestId}] /notification-events org=${authCtx.orgId} scope=${scope} returned=${data?.length ?? 0} total=${count ?? 0}`,
    );

    return new Response(
      JSON.stringify({
        items: data ?? [],
        totalCount: count ?? 0,
        limit,
        offset,
        filters: {
          action: action ?? null,
          user_id: userIdFilter ?? null,
          since: sinceIso,
          until: untilIso,
          request_id: requestIdFilter ?? null,
          scope,
        },
        requestId,
      }),
      {
        status: 200,
        headers: {
          ...headers,
          ...cacheHeaders("private-short"),
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err : new Error("Unknown error"),
      requestId,
      headers,
    );
  }
});
