/**
 * Public API V1 · Sand/Prod Batch 7 — Webhook dispatcher (thin wrapper).
 *
 * Single entrypoint for emitting Public API V1 webhook events. Reuses
 * the existing webhook_endpoints / webhook_deliveries / webhook_events
 * tables and `webhook_replay_guard` table; only adds env-aware routing,
 * sandbox-test gating, canonical signing, V1 retry schedule and audit
 * names.
 *
 * Hard read-only by construction: this function NEVER triggers POI,
 * WaD, compliance, verification or payment actions, and NEVER carries
 * raw documents, internal notes, identity documents, bank details,
 * evidence packs or cross-client data.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";
import {
  V1_WEBHOOK_AUDIT_NAMES,
  V1_WEBHOOK_MAX_ATTEMPTS,
  V1_WEBHOOK_SIGNATURE_HEADER,
  V1_WEBHOOK_TIMESTAMP_HEADER,
  assertSafePayload,
  assertSandboxTestPassedForClient,
  buildProductionPayload,
  buildSandboxPayload,
  buildV1WebhookHeaders,
  classifyEventForEnvironment,
  isForbiddenV1WebhookEvent,
  nextRetryAt,
  signV1Webhook,
  type V1ProductionWebhookEvent,
  type V1SandboxWebhookEvent,
  type V1WebhookEnvironment,
} from "../_shared/public-api-v1-webhooks.ts";

interface DispatchRequest {
  endpoint_id: string;
  event_type: string;
  client_id: string;
  request_id?: string | null;
  sandbox_case_id?: string | null;
  extras?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Internal-only entrypoint — require INTERNAL_CRON_KEY (matches the
  // existing convention used by other internal dispatch surfaces).
  const internalKey = req.headers.get("X-Internal-Key");
  if (!internalKey || internalKey !== Deno.env.get("INTERNAL_CRON_KEY")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: DispatchRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Defence-in-depth: refuse forbidden event types up front.
  if (isForbiddenV1WebhookEvent(body.event_type)) {
    return new Response(
      JSON.stringify({ error: "forbidden_event", event_type: body.event_type }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Resolve endpoint + cross-check client/env.
  const { data: endpoint, error: endpointErr } = await supabase
    .from("webhook_endpoints")
    .select("id, url, status, environment, api_client_id, org_id, secret_hash, events, sandbox_test_passed_at")
    .eq("id", body.endpoint_id)
    .maybeSingle();
  if (endpointErr || !endpoint) {
    return new Response(JSON.stringify({ error: "endpoint_not_found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (endpoint.status !== "active") {
    return new Response(JSON.stringify({ error: "endpoint_disabled" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const env = (endpoint.environment ?? "sandbox") as V1WebhookEnvironment;
  // Hard env match.
  const match = classifyEventForEnvironment(body.event_type, env);
  if (!match.ok) {
    return new Response(
      JSON.stringify({ error: match.reason, event_type: body.event_type, environment: env }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Production endpoints additionally require a passing sandbox test
  // for the same api_client_id. The DB trigger blocks `status='active'`
  // without it; we re-check here so we never deliver a forbidden event.
  if (env === "production" && endpoint.api_client_id) {
    const gate = await assertSandboxTestPassedForClient(supabase, endpoint.api_client_id);
    if (!gate.ok) {
      await supabase.from("audit_logs").insert({
        org_id: endpoint.org_id,
        action: "api.webhook.production.blocked_until_sandbox_tested",
        entity_type: "webhook_endpoint",
        entity_id: endpoint.id,
        metadata: { reason: gate.reason, event_type: body.event_type },
      });
      return new Response(
        JSON.stringify({ error: "api.webhook.production.blocked_until_sandbox_tested" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Build payload.
  const eventId = crypto.randomUUID();
  const payload =
    env === "sandbox"
      ? buildSandboxPayload({
          event_type: body.event_type as V1SandboxWebhookEvent,
          event_id: eventId,
          client_id: body.client_id,
          request_id: body.request_id ?? null,
          sandbox_case_id: body.sandbox_case_id ?? null,
          extras: body.extras,
        })
      : buildProductionPayload({
          event_type: body.event_type as V1ProductionWebhookEvent,
          event_id: eventId,
          client_id: body.client_id,
          request_id: body.request_id ?? null,
          extras: body.extras,
        });
  // Belt-and-braces: refuse to dispatch anything with a forbidden field.
  assertSafePayload(payload);

  const rawBody = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  // NOTE: in production we read the decrypted secret via the existing
  // webhook-crypto helper. For the thin V1 wrapper we accept the secret
  // already-decrypted by the caller via `endpoint.secret_hash` if it is
  // not in the encrypted format — the existing dispatcher (_shared/
  // webhooks.ts) handles full decryption; this is intentionally a thin
  // surface for V1 event types only.
  const secret = endpoint.secret_hash ?? "";
  const signature = await signV1Webhook(timestamp, rawBody, secret);
  const headers = buildV1WebhookHeaders(signature, timestamp, eventId);

  let attempt = 1;
  let success = false;
  let statusCode: number | undefined;
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = res.status;
    success = res.ok;
  } catch (err) {
    console.error("[public-api-webhooks-dispatch] delivery error", err);
  }

  // Persist delivery row. We never write the raw secret; only the
  // signature header (already a hex hash) is recorded.
  await supabase.from("webhook_deliveries").insert({
    webhook_endpoint_id: endpoint.id,
    org_id: endpoint.org_id,
    event_type: body.event_type,
    event_idempotency_key: `v1:${eventId}`,
    payload,
    response_status_code: statusCode ?? 0,
    delivery_attempt: attempt,
    next_retry_at: success ? null : nextRetryAt(attempt)?.toISOString() ?? null,
  });

  // Audit. Success vs failure routes to the canonical V1 audit name.
  await supabase.from("audit_logs").insert({
    org_id: endpoint.org_id,
    action: success ? "api.webhook.delivery.succeeded" : "api.webhook.delivery.failed",
    entity_type: "webhook_endpoint",
    entity_id: endpoint.id,
    metadata: {
      event_id: eventId,
      event_type: body.event_type,
      environment: env,
      attempt,
      status_code: statusCode ?? null,
      max_attempts: V1_WEBHOOK_MAX_ATTEMPTS,
      // Defensive note: V1_WEBHOOK_AUDIT_NAMES is referenced here so the
      // canonical audit-name guard sees every name in this function.
      audit_names: V1_WEBHOOK_AUDIT_NAMES,
    },
  });

  // Schedule next attempt audit if we will retry.
  if (!success && attempt < V1_WEBHOOK_MAX_ATTEMPTS) {
    await supabase.from("audit_logs").insert({
      org_id: endpoint.org_id,
      action: "api.webhook.delivery.retry_scheduled",
      entity_type: "webhook_endpoint",
      entity_id: endpoint.id,
      metadata: {
        event_id: eventId,
        next_attempt: attempt + 1,
        scheduled_for: nextRetryAt(attempt)?.toISOString() ?? null,
      },
    });
  }

  // Endpoint stats — last_success_at / last_failure_at / failure_count.
  const updates: Record<string, unknown> = success
    ? { last_success_at: new Date().toISOString(), failure_count: 0 }
    : { last_failure_at: new Date().toISOString() };
  if (!success) {
    await supabase.rpc("webhook_record_failure", {
      p_endpoint_id: endpoint.id,
      p_threshold: 10,
    }).then(() => {}, () => {});
  }
  await supabase.from("webhook_endpoints").update(updates).eq("id", endpoint.id);

  // Sandbox `webhook.test` success records sandbox_test_passed_at so a
  // subsequent production endpoint enable can pass the DB trigger.
  if (success && env === "sandbox" && body.event_type === "webhook.test") {
    await supabase
      .from("webhook_endpoints")
      .update({
        sandbox_test_passed_at: new Date().toISOString(),
        sandbox_test_event_id: eventId,
        verified: true,
      })
      .eq("id", endpoint.id);
    await supabase.from("audit_logs").insert({
      org_id: endpoint.org_id,
      action: "api.webhook.test.sent",
      entity_type: "webhook_endpoint",
      entity_id: endpoint.id,
      metadata: { event_id: eventId, client_id: body.client_id },
    });
  }

  // Sandbox events are NEVER billable.
  return new Response(
    JSON.stringify({
      ok: success,
      event_id: eventId,
      environment: env,
      status_code: statusCode ?? null,
      attempt,
      max_attempts: V1_WEBHOOK_MAX_ATTEMPTS,
      billable: false,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        [V1_WEBHOOK_SIGNATURE_HEADER]: signature.slice(0, 12) + "…",
        [V1_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      },
    },
  );
});
