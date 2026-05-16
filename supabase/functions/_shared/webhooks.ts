import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptSecret, isEncryptedFormat } from "./webhook-crypto.ts";

export interface WebhookPayload {
  event: string;
  data: Record<string, any>;
  timestamp: string;
  orgId: string;
}

/**
 * Generate HMAC signature for webhook payload
 */
async function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Batch D — primary-path delivery timeout. Matches the retry worker (10s)
 * and the value advertised in src/pages/docs/Webhooks.tsx. A slow or hung
 * receiver can no longer block the parent function until the edge runtime
 * kills the whole invocation.
 */
const PRIMARY_DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Batch D — bounded response body read. We previously called
 * `response.text()` which fully buffered any payload before slicing to
 * 1000 chars; a malicious receiver could stream gigabytes. Reader caps at
 * 64 KB then aborts, and we still persist only the first 1000 chars.
 */
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

async function readBoundedResponseBody(response: Response): Promise<string> {
  if (!response.body) {
    // No streaming body — fall back to text() with a reasonable timeout
    // already enforced by the outer AbortSignal.
    try { return await response.text(); } catch { return ""; }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_RESPONSE_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    if (total >= MAX_RESPONSE_BODY_BYTES) {
      try { await reader.cancel("body-size-cap"); } catch { /* noop */ }
    }
  } catch {
    // Reader threw — return what we have.
  }
  const merged = new Uint8Array(Math.min(total, MAX_RESPONSE_BODY_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, merged.byteLength - offset);
    merged.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= merged.byteLength) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * Deliver webhook to a single endpoint
 */
async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string,
  webhookEndpointId: string,
  supabase: SupabaseClient,
  eventIdempotencyKey: string,
): Promise<{ success: boolean; statusCode?: number; error?: string; idempotent?: boolean }> {
  const body = JSON.stringify(payload);
  const signature = await generateSignature(body, secret);

  // POI-004 stage-2 / Batch D: structural dedupe by (endpoint, event idempotency key).
  // If a row already exists for this endpoint + key, we have already
  // delivered (or attempted to deliver) this logical event — do NOT POST
  // again. Returns idempotent:true so callers can distinguish from a fresh
  // delivery in metrics.
  {
    const { data: prior } = await supabase
      .from("webhook_deliveries")
      .select("id, response_status_code")
      .eq("webhook_endpoint_id", webhookEndpointId)
      .eq("event_idempotency_key", eventIdempotencyKey)
      .limit(1)
      .maybeSingle();
    if (prior) {
      console.log(
        `[webhooks] idempotent replay — skipping ${payload.event} for endpoint ${webhookEndpointId}`,
      );
      return {
        success: prior.response_status_code != null && prior.response_status_code >= 200 && prior.response_status_code < 300,
        statusCode: prior.response_status_code ?? undefined,
        idempotent: true,
      };
    }
  }

  let responseStatusCode = 0;
  let responseBody = "";
  let errorMessage = "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": payload.event,
        "X-Webhook-Timestamp": payload.timestamp,
        "X-Webhook-Idempotency-Key": eventIdempotencyKey,
      },
      body,
      // Batch D — bounded fetch. Without this, a hung receiver could
      // block the parent function for its entire wall-clock budget.
      signal: AbortSignal.timeout(PRIMARY_DELIVERY_TIMEOUT_MS),
    });

    responseStatusCode = response.status;
    // Batch D — read at most MAX_RESPONSE_BODY_BYTES before aborting the
    // stream. Persisted body is then truncated to 1000 chars as before.
    responseBody = await readBoundedResponseBody(response);

    // Calculate next retry time if failed
    let nextRetry = null;
    if (!response.ok) {
      const retryDate = new Date();
      retryDate.setMinutes(retryDate.getMinutes() + 5); // First retry in 5 minutes
      nextRetry = retryDate.toISOString();
    }

    // Log successful or failed delivery attempt. The unique index on
    // (webhook_endpoint_id, event_idempotency_key) is our last-line guard
    // against a race where two concurrent triggers both passed the lookup
    // above; we treat 23505 as a benign idempotent skip.
    const { error: insertError } = await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: webhookEndpointId,
      org_id: payload.orgId,
      event_type: payload.event,
      event_idempotency_key: eventIdempotencyKey,
      payload: payload.data,
      response_status_code: responseStatusCode,
      response_body: responseBody.substring(0, 1000),
      delivery_attempt: 1,
      next_retry_at: nextRetry,
    });
    if (insertError && (insertError as any).code === "23505") {
      console.log(
        `[webhooks] race resolved by unique index — duplicate ${payload.event} for endpoint ${webhookEndpointId}`,
      );
      return { success: response.ok, statusCode: response.status, idempotent: true };
    }

    return {
      success: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    console.error(`Webhook delivery failed to ${url}:`, error);
    errorMessage = error instanceof Error ? error.message : "Unknown error";
    // Batch D — surface timeout in the error_message so operators can
    // distinguish hung receivers from refused/5xx ones in logs.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      errorMessage = `timeout after ${PRIMARY_DELIVERY_TIMEOUT_MS}ms`;
    }

    // Schedule retry on network error
    const retryDate = new Date();
    retryDate.setMinutes(retryDate.getMinutes() + 5);

    // Log failed delivery attempt
    const { error: insertError } = await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: webhookEndpointId,
      org_id: payload.orgId,
      event_type: payload.event,
      event_idempotency_key: eventIdempotencyKey,
      payload: payload.data,
      response_status_code: 0,
      error_message: errorMessage,
      delivery_attempt: 1,
      next_retry_at: retryDate.toISOString(),
    });
    if (insertError && (insertError as any).code === "23505") {
      return { success: false, error: errorMessage, idempotent: true };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Trigger webhooks for a specific event
 * This runs in the background and doesn't block the response.
 *
 * `eventIdempotencyKey` (POI-004 stage-2): a stable per-logical-event key
 * (e.g. `poi.generated:<matchId>`). When supplied, the same event cannot
 * produce two `webhook_deliveries` rows for the same endpoint, even if the
 * upstream caller fires twice. Legacy callers that omit it remain
 * unconstrained.
 */
export async function triggerWebhooks(
  supabase: SupabaseClient,
  orgId: string,
  event: string,
  data: Record<string, any>,
  options?: { eventIdempotencyKey?: string | null }
): Promise<void> {
  const eventIdempotencyKey = options?.eventIdempotencyKey ?? null;
  try {
    // Fetch active webhook endpoints subscribed to this event
    const { data: endpoints, error } = await supabase
      .from("webhook_endpoints")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "active")
      .contains("events", [event]);

    if (error) {
      console.error("Error fetching webhook endpoints:", error);
      return;
    }

    if (!endpoints || endpoints.length === 0) {
      console.log(`No webhooks registered for event: ${event}`);
      return;
    }

    console.log(`Triggering ${endpoints.length} webhooks for event: ${event}`);

    const payload: WebhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
      orgId,
    };

    // Deliver to all endpoints (in parallel)
    const deliveryPromises = endpoints.map(async (endpoint) => {
      // Decrypt the secret for HMAC signing
      let secret: string;
      try {
        if (isEncryptedFormat(endpoint.secret_hash)) {
          secret = await decryptSecret(endpoint.secret_hash);
        } else {
          // Legacy format detected - skip detailed error messages to avoid info disclosure
          // Log warning without sensitive details
          console.warn(`Webhook endpoint requires migration to new format`);
          secret = endpoint.secret_hash; // Fallback
        }
      } catch (err) {
        console.error(`Webhook secret processing failed for endpoint`);
        return { success: false, error: "Webhook configuration error" };
      }

      const result = await deliverWebhook(
        endpoint.url,
        payload,
        secret,
        endpoint.id,
        supabase,
        eventIdempotencyKey,
      );

      // Idempotent replays must NOT touch the circuit breaker — they did
      // not represent a new delivery attempt.
      if (result.idempotent) {
        return result;
      }

      // Circuit breaker: atomic success/failure tracking
      if (result.success) {
        await supabase.rpc("webhook_record_success", { p_endpoint_id: endpoint.id });
        console.log(`Webhook delivered successfully to ${endpoint.url}`);
      } else {
        const { data: breakerResult } = await supabase.rpc("webhook_record_failure", {
          p_endpoint_id: endpoint.id,
          p_threshold: 10,
        });
        const tripped = Array.isArray(breakerResult) ? breakerResult[0]?.tripped : false;
        const newCount = Array.isArray(breakerResult) ? breakerResult[0]?.new_consecutive_failures : null;

        if (tripped) {
          console.warn(
            `[CIRCUIT BREAKER] Tripped for endpoint ${endpoint.id} (${endpoint.url}) after ${newCount} consecutive failures.`
          );
        }
        console.error(
          `Webhook delivery failed for ${endpoint.url}: ${result.error || result.statusCode} (consecutive_failures=${newCount})`
        );
      }

      return result;
    });

    await Promise.all(deliveryPromises);
  } catch (error) {
    console.error("Error in triggerWebhooks:", error);
  }
}

// NOTE: notifyCounterpartyIntent function REMOVED per product requirement
// This API records trade request only - no outbound counterparty contact
// All counterparty communication is handled externally by the calling system

/**
 * Verify webhook signature for an inbound webhook.
 *
 * Returns true ONLY if both:
 *   1. The HMAC signature matches the payload + secret, AND
 *   2. (When `replay` is provided) the signature has not been seen before
 *      within the replay-guard window.
 *
 * Every decision (accept or reject) emits a single structured JSON line
 * via webhook-decision-log so operators can grep `function_edge_logs`
 * for `"evt":"webhook.decision"` and answer "did this webhook arrive,
 * verify, and survive replay protection?" without reading prose.
 *
 * Callers that omit `replay` get signature-only verification, but should
 * be migrated — replay protection is required for any webhook that has
 * side effects. See supabase/functions/_shared/replay-guard.ts for the
 * full design rationale.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  replay?: {
    supabase: SupabaseClient;
    source: string;
    timestampHeader?: string | null;
    /** Edge-function name, used in structured decision logs. */
    fnName?: string;
    /** Caller's own request id for log correlation. */
    requestId?: string | null;
  },
): Promise<{ ok: boolean; replayResponse?: Response }> {
  const { logWebhookDecision, signaturePrefix } = await import(
    "./webhook-decision-log.ts"
  );
  const fnName = replay?.fnName ?? "unknown";
  const requestId = replay?.requestId ?? null;
  const source = replay?.source;
  const sigPrefix = await signaturePrefix(signature);

  if (!signature || signature.length === 0) {
    logWebhookDecision({
      fn: fnName,
      phase: "signature",
      decision: "reject",
      reason: "missing_signature",
      source,
      requestId,
    });
    return { ok: false };
  }

  const expectedSignature = await generateSignature(payload, secret);
  // Constant-time-ish compare: lengths must match, then char-by-char.
  let signatureOk = signature.length === expectedSignature.length;
  if (signatureOk) {
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    signatureOk = mismatch === 0;
  }

  if (!signatureOk) {
    logWebhookDecision({
      fn: fnName,
      phase: "signature",
      decision: "reject",
      reason: "invalid_signature",
      source,
      signaturePrefix: sigPrefix,
      requestId,
    });
    return { ok: false };
  }

  logWebhookDecision({
    fn: fnName,
    phase: "signature",
    decision: "accept",
    reason: "ok",
    source,
    signaturePrefix: sigPrefix,
    requestId,
  });

  if (replay) {
    // Lazy import so functions that don't use replay don't pay for it.
    const { assertNotReplayed } = await import("./replay-guard.ts");
    const guard = await assertNotReplayed(replay.supabase, {
      source: replay.source,
      signature,
      timestampHeader: replay.timestampHeader,
      fnName: replay.fnName,
      requestId: replay.requestId,
    });
    if (!guard.ok) return { ok: false, replayResponse: guard.response };
  }

  return { ok: true };
}
