// Records a single audit event summarising a bulk POI confirmation action.
// Per-match audit rows are already written by the match/settle endpoint;
// this function captures the user-initiated batch as one entity for review.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

// Server-enforced cost — must match atomic_generate_poi.v_token_cost
const CREDITS_PER_POI = 1;

const BodySchema = z.object({
  batch_key: z.string().trim().min(1).max(100),
  attempted_match_ids: z.array(z.string().uuid()).min(1).max(500),
  succeeded_match_ids: z.array(z.string().uuid()).max(500),
  failed_match_ids: z.array(z.string().uuid()).max(500),
  error_summary: z.string().trim().max(500).optional().nullable(),
});

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }
    assertIdempotencyKey(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Invalid bulk audit payload",
        400,
        { errors: parsed.error.flatten().fieldErrors }
      );
    }

    const body = parsed.data;
    const succeededCount = body.succeeded_match_ids.length;
    const failedCount = body.failed_match_ids.length;
    const attemptedCount = body.attempted_match_ids.length;

    // Server is the source of truth for credit cost — never trust the client.
    const creditsCharged = succeededCount * CREDITS_PER_POI;

    const { error: insertErr } = await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "bulk_poi_confirm",
      entity_type: "match_batch",
      entity_id: null,
      metadata: {
        batch_key: body.batch_key,
        request_id: requestId,
        credits_per_match: CREDITS_PER_POI,
        credits_charged: creditsCharged,
        match_count_attempted: attemptedCount,
        match_count_succeeded: succeededCount,
        match_count_failed: failedCount,
        attempted_match_ids: body.attempted_match_ids,
        succeeded_match_ids: body.succeeded_match_ids,
        failed_match_ids: body.failed_match_ids,
        error_summary: body.error_summary ?? null,
      },
    });

    if (insertErr) {
      console.error(`[${requestId}] audit insert failed`, insertErr);
      throw new ApiException("AUDIT_WRITE_FAILED", "Failed to record audit event", 500);
    }

    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        credits_charged: creditsCharged,
        match_count_succeeded: succeededCount,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return errorResponse(error, requestId, headers);
  }
});
