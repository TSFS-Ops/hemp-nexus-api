import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { encryptSecret } from "../_shared/webhook-crypto.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";

const webhookCreateSchema = z.object({
  url: z.string().url("Invalid URL"),
  events: z.array(z.string()).min(1, "At least one event is required"),
  secret: z.string().min(16, "Secret must be at least 16 characters").optional(),
});

const webhookUpdateSchema = z.object({
  url: z.string().url("Invalid URL").optional(),
  events: z.array(z.string()).min(1, "At least one event is required").optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

Deno.serve(async (req) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "webhooks", artefact: false });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);

    // Normalize path
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "webhooks") parts.shift();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireScope(authCtx, 'webhooks');
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, "webhooks");

    // POST / - Create webhook endpoint
    if (req.method === "POST" && parts.length === 0) {
      // Server-side idempotency check (header is required for POST)
      const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required for POST", 400);
      }
      const { data: existing } = await supabase
        .from("idempotency_keys")
        .select("response_data, response_status_code")
        .eq("org_id", authCtx.orgId)
        .eq("idempotency_key", idempotencyKey)
        .eq("endpoint", "POST /webhooks")
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      const rawBody = await req.json();
      const body = webhookCreateSchema.parse(rawBody);

      // Generate secret if not provided
      const secret = body.secret || crypto.randomUUID();
      
      // Encrypt the secret for secure storage (NOT hash - we need to decrypt for HMAC)
      const encryptedSecret = await encryptSecret(secret);

      const { data: webhook, error } = await supabase
        .from("webhook_endpoints")
        .insert({
          org_id: authCtx.orgId,
          url: body.url,
          events: body.events,
          secret_hash: encryptedSecret, // Column still named secret_hash for backwards compat
          status: "active",
        })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "webhook.created",
        entity_type: "webhook",
        entity_id: webhook.id,
        metadata: { url: body.url, events: body.events, actor_ip: authCtx.actorIp ?? null, user_agent: authCtx.userAgent ?? null },
      });

      const responsePayload = {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        status: webhook.status,
        secret: body.secret ? undefined : secret, // Only return secret if auto-generated
        created_at: webhook.created_at,
        message: body.secret
          ? "Webhook created with your secret"
          : "Webhook created. Save the secret - you won't see it again!",
      };

      // Persist idempotency record so a retry returns the same response
      await supabase.from("idempotency_keys").insert({
        org_id: authCtx.orgId,
        idempotency_key: idempotencyKey,
        endpoint: "POST /webhooks",
        request_hash: "n/a",
        response_data: responsePayload,
        response_status_code: 201,
      });

      return new Response(JSON.stringify(responsePayload), {
        status: 201,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // GET / - List webhook endpoints
    if (req.method === "GET" && parts.length === 0) {
      const { data: webhooks, error } = await supabase
        .from("webhook_endpoints")
        .select("id, url, events, status, last_delivery_at, created_at, updated_at")
        .eq("org_id", authCtx.orgId)
        .order("created_at", { ascending: false });

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ data: webhooks }),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } }
      );
    }

    // GET /:id - Get webhook endpoint
    if (req.method === "GET" && parts.length === 1) {
      const webhookId = parts[0];

      const { data: webhook, error } = await supabase
        .from("webhook_endpoints")
        .select("id, url, events, status, last_delivery_at, created_at, updated_at")
        .eq("id", webhookId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (error) throw new ApiException("NOT_FOUND", "Webhook not found", 404);

      return new Response(
        JSON.stringify(webhook),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } }
      );
    }

    // PATCH /:id - Update webhook endpoint
    if (req.method === "PATCH" && parts.length === 1) {
      const webhookId = parts[0];
      const rawBody = await req.json();
      const body = webhookUpdateSchema.parse(rawBody);

      // Verify webhook belongs to org
      const { data: existing } = await supabase
        .from("webhook_endpoints")
        .select("id")
        .eq("id", webhookId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (!existing) {
        throw new ApiException("NOT_FOUND", "Webhook not found", 404);
      }

      // Security fix: explicit column allowlist. Never return secret_hash or
      // previous_secret_hash to API callers (encrypted ciphertext is still
      // sensitive; compromise of WEBHOOK_ENCRYPTION_KEY would retroactively
      // decrypt captured responses). Mirrors the GET endpoint column list.
      const { data: webhook, error } = await supabase
        .from("webhook_endpoints")
        .update(body)
        .eq("id", webhookId)
        .select("id, url, events, status, last_delivery_at, created_at, updated_at")
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "webhook.updated",
        entity_type: "webhook",
        entity_id: webhookId,
        metadata: { ...body, actor_ip: authCtx.actorIp ?? null, user_agent: authCtx.userAgent ?? null },
      });

      return new Response(
        JSON.stringify(webhook),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } }
      );
    }

    // POST /:id/rotate - Rotate webhook signing secret
    // Batch D — secret rotation with bounded grace window.
    // The new secret is returned ONCE in the response body. The old
    // secret is preserved in `previous_secret_hash` and remains valid
    // for inbound signature verification (when wired) for ROTATION_GRACE_MS.
    if (req.method === "POST" && parts.length === 2 && parts[1] === "rotate") {
      const webhookId = parts[0];

      const { data: existing, error: lookupErr } = await supabase
        .from("webhook_endpoints")
        .select("id, secret_hash")
        .eq("id", webhookId)
        .eq("org_id", authCtx.orgId)
        .maybeSingle();

      if (lookupErr || !existing) {
        throw new ApiException("NOT_FOUND", "Webhook not found", 404);
      }

      const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000; // 24h
      const newSecret = crypto.randomUUID();
      const newEncrypted = await encryptSecret(newSecret);
      const previousExpiresAt = new Date(Date.now() + ROTATION_GRACE_MS).toISOString();

      const { error: updateErr } = await supabase
        .from("webhook_endpoints")
        .update({
          secret_hash: newEncrypted,
          previous_secret_hash: existing.secret_hash,
          previous_secret_expires_at: previousExpiresAt,
        })
        .eq("id", webhookId)
        .eq("org_id", authCtx.orgId);

      if (updateErr) handleDatabaseError(updateErr, requestId);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "webhook.secret_rotated",
        entity_type: "webhook",
        entity_id: webhookId,
        metadata: {
          previous_secret_expires_at: previousExpiresAt,
          grace_window_ms: ROTATION_GRACE_MS,
          actor_ip: authCtx.actorIp ?? null,
          user_agent: authCtx.userAgent ?? null,
        },
      });

      return new Response(
        JSON.stringify({
          id: webhookId,
          secret: newSecret,
          previous_secret_expires_at: previousExpiresAt,
          message: "Secret rotated. Save it — you won't see it again. The previous secret remains valid for 24h.",
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } },
      );
    }

    // DELETE /:id - Delete webhook endpoint
    if (req.method === "DELETE" && parts.length === 1) {
      const webhookId = parts[0];

      const { error } = await supabase
        .from("webhook_endpoints")
        .delete()
        .eq("id", webhookId)
        .eq("org_id", authCtx.orgId);

      if (error) handleDatabaseError(error, requestId);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "webhook.deleted",
        entity_type: "webhook",
        entity_id: webhookId,
        metadata: { actor_ip: authCtx.actorIp ?? null, user_agent: authCtx.userAgent ?? null },
      });

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException("NOT_FOUND", "Endpoint not found", 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        new ApiException("VALIDATION_ERROR", error.errors[0].message, 400),
        requestId,
        headers
      );
    }
    return errorResponse(error as Error, requestId, headers);
  }
});
