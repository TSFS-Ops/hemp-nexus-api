/**
 * admin-run-lifecycle
 * -------------------
 * Temporary admin-authenticated endpoint that triggers the `lifecycle-scheduler`
 * edge function server-side using the stored INTERNAL_CRON_KEY and returns the
 * scheduler's JSON result verbatim.
 *
 * Auth: requires a logged-in user with role `platform_admin` (checked via the
 * shared authenticateRequest + requireRole helpers). API keys are rejected.
 *
 * Audit: writes an `admin.lifecycle_scheduler.invoked` row to `audit_logs`
 * including the requesting user, scheduler HTTP status, and a short trace id.
 *
 * Remove this function once the post-maintenance run is no longer needed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { assertAal2 } from "../_shared/aal.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const internalKey = Deno.env.get("INTERNAL_CRON_KEY");

    if (!internalKey) {
      throw new ApiException(
        "CONFIG_ERROR",
        "INTERNAL_CRON_KEY is not configured on the server",
        500,
      );
    }

    // ── Auth: must be a logged-in platform_admin (no API keys) ──
    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    if (authCtx.isApiKey) {
      throw new ApiException(
        "FORBIDDEN",
        "API keys cannot invoke this endpoint",
        403,
      );
    }
    requireRole(authCtx, "platform_admin");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── SEC-001: AAL2 / MFA enforcement for manual state-override ──
    // `lifecycle-scheduler` mutates POI / engagement / breach state.
    await assertAal2(req.headers.get("Authorization"), {
      adminClient,
      callerUserId: authCtx.userId,
      action: "admin.lifecycle_scheduler.invoke",
    });

    // ── Invoke lifecycle-scheduler with the internal cron key ──
    const startedAt = Date.now();
    const schedulerUrl = `${supabaseUrl}/functions/v1/lifecycle-scheduler`;
    const upstream = await fetch(schedulerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalKey,
        // Supabase Edge Runtime requires an apikey header for function invocation
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ triggeredBy: "admin-run-lifecycle", requestId }),
    });

    const durationMs = Date.now() - startedAt;
    const rawText = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }

    // ── Audit ──
    await adminClient.from("audit_logs").insert({
      action: "admin.lifecycle_scheduler.invoked",
      actor_user_id: authCtx.userId,
      org_id: authCtx.orgId,
      metadata: {
        request_id: requestId,
        upstream_status: upstream.status,
        duration_ms: durationMs,
        ok: upstream.ok,
      },
    });

    return new Response(
      JSON.stringify({
        ok: upstream.ok,
        upstreamStatus: upstream.status,
        durationMs,
        requestId,
        result: parsed,
      }),
      {
        status: upstream.ok ? 200 : 502,
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error(`[${requestId}] admin-run-lifecycle error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
