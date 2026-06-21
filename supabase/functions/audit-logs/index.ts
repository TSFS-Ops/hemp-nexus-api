import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { cacheHeaders } from "../_shared/cache.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";

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

    // Authenticate
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    // JWT/console users can view their org's audit logs ONLY if they hold an
    // admin or auditor role. Plain org_members cannot read the audit trail.
    // API-key callers need explicit scope AND burn a token.
    if (authCtx.isApiKey) {
      requireScope(authCtx, 'audit_logs');
      await enforceTokenMetering(
        supabase,
        authCtx.orgId,
        authCtx.userId,
        "/audit-logs",
        requestId
      );
    } else {
      const AUDIT_VIEW_ROLES = ["platform_admin", "auditor", "org_admin"];
      const { data: callerRoles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authCtx.userId);
      const roleNames = (callerRoles || []).map((r: { role: string }) => r.role);
      if (!roleNames.some((r) => AUDIT_VIEW_ROLES.includes(r))) {
        throw new ApiException("FORBIDDEN", "Audit logs are restricted to admins and auditors.", 403);
      }
    }

    const url = new URL(req.url);
   console.log(`[${requestId}] ${req.method} /audit-logs`);

   // Parse query parameters (for GET) or body (for POST)
   let limit = 50;
   let offset = 0;
   let action: string | null = null;
   let entityType: string | null = null;
   let entityId: string | null = null;
   let requestIdFilter: string | null = null;
   let startDate: string | null = null;
   let endDate: string | null = null;

   if (req.method === "POST") {
     const body = await req.json();
     limit = Math.min(parseInt(body.limit || "50"), 100);
     offset = parseInt(body.offset || "0");
     action = body.action || null;
     entityType = body.entity_type || null;
     entityId = body.entity_id || null;
     requestIdFilter = body.request_id || null;
     startDate = body.start_date || null;
     endDate = body.end_date || null;
   } else {
     limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
     offset = parseInt(url.searchParams.get("offset") || "0");
     action = url.searchParams.get("action");
     entityType = url.searchParams.get("entity_type");
     entityId = url.searchParams.get("entity_id");
     requestIdFilter = url.searchParams.get("request_id");
     startDate = url.searchParams.get("start_date");
     endDate = url.searchParams.get("end_date");
   }

    // Build query
    let query = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .eq("org_id", authCtx.orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (action) {
      query = query.eq("action", action);
    }

    if (entityType) {
      query = query.eq("entity_type", entityType);
    }

    if (entityId) {
      query = query.eq("entity_id", entityId);
    }

    if (requestIdFilter) {
      query = query.filter("metadata->>request_id", "eq", requestIdFilter);
    }

    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Invalid start_date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)",
          400
        );
      }
      query = query.gte("created_at", start.toISOString());
    }

    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Invalid end_date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)",
          400
        );
      }
      query = query.lte("created_at", end.toISOString());
    }

    // Execute query
    const { data: logs, error, count } = await query;

    if (error) handleDatabaseError(error, requestId);

    console.log(`[${requestId}] Retrieved ${logs?.length || 0} audit logs (total: ${count || 0})`);

    return new Response(
      JSON.stringify({
        items: logs || [],
        totalCount: count || 0,
        limit,
        offset,
        filters: {
          action: action || null,
          entity_type: entityType || null,
          entity_id: entityId || null,
          request_id: requestIdFilter || null,
          start_date: startDate || null,
          end_date: endDate || null,
        },
      }),
      {
        status: 200,
        headers: { ...headers, ...cacheHeaders("private-short"), "Content-Type": "application/json" },
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
