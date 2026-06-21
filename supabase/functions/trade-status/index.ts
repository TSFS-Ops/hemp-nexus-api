import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";

/**
 * Trade Status endpoint - returns only approval outcome, not sensitive KYC data.
 * Supports both JWT and API key authentication.
 */
Deno.serve(async (req: Request) => {
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    if (authCtx.isApiKey) {
      requireScope(authCtx, "trade-status");
    }

    // Get org_id from query params (GET) or body (POST)
    let orgId: string | null = null;
    if (req.method === "GET") {
      const url = new URL(req.url);
      orgId = url.searchParams.get("org_id");
    } else {
      const body = await req.json();
      orgId = body.org_id;
    }

    if (!orgId) {
      throw new ApiException("VALIDATION_ERROR", "org_id is required", 400);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orgId)) {
      throw new ApiException("VALIDATION_ERROR", "org_id must be a valid UUID", 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin
      .from("trade_approvals")
      .select("status, approved_at, risk_band, valid_until")
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) {
      throw new ApiException("INTERNAL_ERROR", error.message, 500);
    }

    return new Response(
      JSON.stringify({
        org_id: orgId,
        approved_to_trade: data?.status === "approved",
        trade_status: data?.status || "not_approved",
        approved_at: data?.approved_at || null,
        risk_band: data?.risk_band || null,
        valid_until: data?.valid_until || null,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Trade status error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
