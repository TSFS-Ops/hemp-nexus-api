import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

/**
 * Signing Keys Management - ECDSA P-256 Key Registry
 *
 * POST   - Register a new public key
 * GET    - List org's signing keys
 * PATCH  - Revoke or rotate a key
 */

const RegisterKeySchema = z.object({
  key_id: z.string().min(1).max(128),
  public_key_jwk: z.object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1),
    y: z.string().min(1),
  }).passthrough(),
});

const RevokeKeySchema = z.object({
  key_id: z.string().min(1).max(128),
  reason: z.string().max(512).optional(),
  rotate_to_key_id: z.string().max(128).optional(),
});

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const admin = createClient(supabaseUrl, serviceKey);

    // ── POST: Register key ──
    if (req.method === "POST") {
      assertIdempotencyKey(req);
      const body = await req.json();
      const parsed = RegisterKeySchema.parse(body);

      // Validate key is importable
      try {
        await crypto.subtle.importKey(
          "jwk",
          parsed.public_key_jwk as JsonWebKey,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"]
        );
      } catch {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Invalid ECDSA P-256 public key - could not import",
          400
        );
      }

      const { data: key, error } = await admin
        .from("signing_keys")
        .insert({
          org_id: orgId,
          key_id: parsed.key_id,
          algorithm: "ECDSA-P256",
          public_key_jwk: parsed.public_key_jwk,
          status: "active",
          created_by: authCtx.isApiKey ? null : authCtx.userId,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new ApiException(
            "CONFLICT",
            `Key ID '${parsed.key_id}' already exists for this organisation`,
            409
          );
        }
        throw new ApiException("INTERNAL_ERROR", error.message, 500);
      }

      // Audit
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        action: "signing_key.registered",
        entity_type: "signing_key",
        entity_id: key.id,
        metadata: { key_id: parsed.key_id, algorithm: "ECDSA-P256" },
      });

      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          data: {
            id: key.id,
            key_id: key.key_id,
            algorithm: key.algorithm,
            status: key.status,
            created_at: key.created_at,
          },
        }),
        { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── GET: List keys ──
    if (req.method === "GET") {
      const { data: keys, error } = await admin
        .from("signing_keys")
        .select("id, key_id, algorithm, status, created_at, revoked_at, rotated_to")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(
        JSON.stringify({ status: "SUCCESS", data: keys || [] }),
        { headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── PATCH: Revoke/rotate key ──
    if (req.method === "PATCH") {
      const body = await req.json();
      const parsed = RevokeKeySchema.parse(body);

      // Find active key
      const { data: existingKey } = await admin
        .from("signing_keys")
        .select("id, status")
        .eq("org_id", orgId)
        .eq("key_id", parsed.key_id)
        .eq("status", "active")
        .maybeSingle();

      if (!existingKey) {
        throw new ApiException(
          "NOT_FOUND",
          `No active key with ID '${parsed.key_id}' found`,
          404
        );
      }

      // If rotating, verify the target key exists and is active
      let rotatedToId: string | null = null;
      if (parsed.rotate_to_key_id) {
        const { data: targetKey } = await admin
          .from("signing_keys")
          .select("id, status")
          .eq("org_id", orgId)
          .eq("key_id", parsed.rotate_to_key_id)
          .eq("status", "active")
          .maybeSingle();

        if (!targetKey) {
          throw new ApiException(
            "NOT_FOUND",
            `Rotation target key '${parsed.rotate_to_key_id}' not found or not active`,
            404
          );
        }
        rotatedToId = targetKey.id;
      }

      const newStatus = parsed.rotate_to_key_id ? "rotated" : "revoked";

      const { error: updateErr } = await admin
        .from("signing_keys")
        .update({
          status: newStatus,
          revoked_at: new Date().toISOString(),
          revoked_by: authCtx.isApiKey ? null : authCtx.userId,
          revoked_reason: parsed.reason || null,
          rotated_to: rotatedToId,
        })
        .eq("id", existingKey.id);

      if (updateErr) throw new ApiException("INTERNAL_ERROR", updateErr.message, 500);

      // Audit
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        action: `signing_key.${newStatus}`,
        entity_type: "signing_key",
        entity_id: existingKey.id,
        metadata: {
          key_id: parsed.key_id,
          reason: parsed.reason,
          rotated_to: parsed.rotate_to_key_id || null,
        },
      });

      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          data: {
            key_id: parsed.key_id,
            new_status: newStatus,
            rotated_to: parsed.rotate_to_key_id || null,
          },
        }),
        { headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    console.error(`[${requestId}] Signing keys error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
