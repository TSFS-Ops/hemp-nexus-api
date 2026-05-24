import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";

/**
 * §21 - Webhook Events Polling Fallback
 * 
 * GET /webhook-events
 *   ?since=<ISO timestamp>  - events after this timestamp (default: 24h ago)
 *   ?event_type=<type>      - filter by event type
 *   ?limit=<n>              - max results (default 100, max 500)
 *   ?cursor=<id>            - pagination cursor (last event ID from previous page)
 *
 * Returns webhook events for the authenticated org, ordered by created_at ASC.
 * This serves as a fallback for consumers whose webhook delivery fails.
 */

Deno.serve(async (req: Request) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "webhook-events", artefact: false });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    if (authCtx.isApiKey) requireScope(authCtx, "webhooks");

    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, "webhook-events");

    const url = new URL(req.url);
    const sinceParam = url.searchParams.get("since");
    const eventType = url.searchParams.get("event_type");
    const limitParam = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
    const cursor = url.searchParams.get("cursor");

    // Default: events from last 24 hours
    const since = sinceParam
      ? new Date(sinceParam).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from("webhook_deliveries")
      .select("id, webhook_endpoint_id, org_id, event_type, payload, response_status_code, delivery_attempt, delivered_at, created_at, next_retry_at, is_dead_letter")
      .eq("org_id", authCtx.orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limitParam);

    if (eventType) {
      query = query.eq("event_type", eventType);
    }

    if (cursor) {
      query = query.gt("id", cursor);
    }

    const { data, error } = await query;
    if (error) {
      throw new ApiException("INTERNAL_ERROR", error.message, 500);
    }

    const events = data || [];
    const nextCursor = events.length === limitParam ? events[events.length - 1]?.id : null;

    return new Response(
      JSON.stringify({
        data: events,
        pagination: {
          count: events.length,
          limit: limitParam,
          next_cursor: nextCursor,
          has_more: events.length === limitParam,
        },
        meta: {
          since,
          request_id: requestId,
        },
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(`[${requestId}] Webhook events polling error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
