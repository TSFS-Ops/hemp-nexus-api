import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    console.log(`[${requestId}] GET /audit-logs`);

    // Parse query parameters
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const action = url.searchParams.get("action");
    const entityType = url.searchParams.get("entity_type");
    const entityId = url.searchParams.get("entity_id");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");

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

    if (startDate) {
      try {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          throw new ApiException(
            "VALIDATION_ERROR",
            "Invalid start_date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)",
            400
          );
        }
        query = query.gte("created_at", start.toISOString());
      } catch (error) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Invalid start_date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)",
          400
        );
      }
    }

    if (endDate) {
      try {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          throw new ApiException(
            "VALIDATION_ERROR",
            "Invalid end_date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)",
            400
          );
        }
        query = query.lte("created_at", end.toISOString());
      } catch (error) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Invalid end_date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)",
          400
        );
      }
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
          start_date: startDate || null,
          end_date: endDate || null,
        },
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
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
