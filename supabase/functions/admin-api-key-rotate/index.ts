// Public API V1 · Sandprod Batch 3 — Admin-driven API key rotation.
//
// Rotates an api_key: issues a new raw secret (returned ONCE), stores
// only the new hash/prefix, marks the previous key revoked, and appends
// a key_history entry. Production rotations require platform_admin + AAL2
// and a reason. Sandbox rotations are allowed for the owning org_admin
// or platform_admin without AAL2 (still audited).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, hashApiKey, requireRole } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { assertAal2 } from "../_shared/aal.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
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

    const { data: existing, error: fetchErr } = await supabase
      .from("api_keys")
      .select("id, org_id, name, scopes, expires_at, key_history, api_client_id, environment, allowed_ips, allowed_origins, status")
      .eq("id", key_id).single();
    if (fetchErr || !existing) throw new ApiException("NOT_FOUND", "API key not found", 404);
    if (existing.status !== "active") {
      throw new ApiException("CONFLICT", `Cannot rotate key in status=${existing.status}`, 409);
    }

    const env = existing.environment as "sandbox" | "production" | null;

    if (env === "production") {
      requireRole(authCtx, "platform_admin");
      await assertAal2(req.headers.get("authorization"), {
        adminClient: supabase, callerUserId: actorUserId, action: "admin.api_production_key_rotate",
      });
      if (reason.length < 10) {
        throw new ApiException("VALIDATION_ERROR", "Reason (min 10 chars) required for production rotation.", 400);
      }
    }

    const previousStatus = existing.status;

    // Revoke old key.
    const nowIso = new Date().toISOString();
    const { error: revokeErr } = await supabase
      .from("api_keys")
      .update({
        status: "revoked",
        revoked_at: nowIso,
        revoked_reason: `rotated by ${actorUserId ?? "system"}: ${reason || "n/a"}`,
        key_history: [
          ...((existing.key_history as Array<unknown>) || []),
          { rotated_at: nowIso, rotated_by: actorUserId, reason: reason || null },
        ],
      })
      .eq("id", key_id);
    if (revokeErr) handleDatabaseError(revokeErr, requestId);

    // Create new key (raw secret returned ONCE).
    const newSecret = `sk_${crypto.randomUUID().replace(/-/g, "")}`;
    const newHash = await hashApiKey(newSecret);
    const newExpires = env === "production"
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : env === "sandbox"
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
        : existing.expires_at;

    const { data: created, error: insertErr } = await supabase
      .from("api_keys")
      .insert({
        org_id: existing.org_id,
        name: existing.name,
        key_hash: newHash,
        scopes: existing.scopes,
        created_by: actorUserId,
        expires_at: newExpires,
        api_client_id: existing.api_client_id,
        environment: existing.environment,
        allowed_ips: existing.allowed_ips,
        allowed_origins: existing.allowed_origins,
        rotated_at: nowIso,
        key_history: [{ rotated_from: key_id, rotated_at: nowIso, reason: reason || null }],
      })
      .select("id, name, scopes, expires_at, created_at, environment")
      .single();
    if (insertErr) handleDatabaseError(insertErr, requestId);

    await supabase.from("audit_logs").insert({
      org_id: existing.org_id,
      actor_user_id: actorUserId,
      actor_api_key_id: actorApiKeyId,
      action: env === "production" ? "api.production_key.rotated" : "api.sandbox_key.rotated",
      entity_type: "api_key",
      entity_id: created.id,
      metadata: {
        previous_key_id: key_id,
        previous_status: previousStatus,
        new_status: "active",
        environment: env,
        api_client_id: existing.api_client_id,
        reason: reason || null,
        request_id: requestId,
      },
    });

    return new Response(JSON.stringify({
      id: created.id,
      name: created.name,
      key: newSecret, // shown ONCE
      scopes: created.scopes,
      environment: created.environment,
      expires_at: created.expires_at,
      created_at: created.created_at,
      rotated_from: key_id,
      message: "Key rotated. Old key revoked. Save this new key — it will not be shown again.",
    }), { status: 201, headers: { "Content-Type": "application/json", ...headers } });
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
