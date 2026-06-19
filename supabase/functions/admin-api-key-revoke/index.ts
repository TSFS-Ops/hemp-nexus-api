// Public API V1 · Sandprod Batch 3 — Admin-driven API key revocation.
//
// Marks an api_key as status=revoked. Gateway rejects with the standard
// `revoked_key` error. Revocation is immediate, append-only on the row,
// and the raw secret is never re-exposed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { assertAal2 } from "../_shared/aal.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResp = handleCors(req, allowedOrigins);
    if (corsResp) return corsResp;
    if (req.method !== "POST") throw new ApiException("METHOD_NOT_ALLOWED", "POST only", 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const key_id = body.key_id as string | undefined;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!key_id) throw new ApiException("VALIDATION_ERROR", "key_id required", 400);
    if (reason.length < 10) throw new ApiException("VALIDATION_ERROR", "Reason (min 10 chars) required.", 400);

    const { data: existing, error: fetchErr } = await supabase
      .from("api_keys")
      .select("id, org_id, environment, status, api_client_id")
      .eq("id", key_id).single();
    if (fetchErr || !existing) throw new ApiException("NOT_FOUND", "API key not found", 404);

    const env = existing.environment as "sandbox" | "production" | null;
    if (env === "production") {
      requireRole(authCtx, "platform_admin");
      await assertAal2(req.headers.get("authorization"), {
        adminClient: supabase, callerUserId: actorUserId, action: "admin.api_production_key_revoke",
      });
    }

    if (existing.status === "revoked") {
      return new Response(JSON.stringify({ ok: true, already: "revoked" }),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } });
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase.from("api_keys").update({
      status: "revoked",
      revoked_at: nowIso,
      revoked_reason: reason,
    }).eq("id", key_id);
    if (updErr) handleDatabaseError(updErr, requestId);

    await supabase.from("audit_logs").insert({
      org_id: existing.org_id,
      actor_user_id: actorUserId,
      actor_api_key_id: actorApiKeyId,
      action: env === "production" ? "api.production_key.revoked" : "api.sandbox_key.revoked",
      entity_type: "api_key",
      entity_id: key_id,
      metadata: { environment: env, api_client_id: existing.api_client_id, reason, request_id: requestId },
    });

    return new Response(JSON.stringify({ ok: true, key_id, status: "revoked" }),
      { status: 200, headers: { "Content-Type": "application/json", ...headers } });
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
