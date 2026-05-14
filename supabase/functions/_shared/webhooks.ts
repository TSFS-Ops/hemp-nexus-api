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
 * Deliver webhook to a single endpoint
 */
async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string,
  webhookEndpointId: string,
  supabase: SupabaseClient,
  eventIdempotencyKey?: string | null,
): Promise<{ success: boolean; statusCode?: number; error?: string; idempotent?: boolean }> {
  const body = JSON.stringify(payload);
  const signature = await generateSignature(body, secret);

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
      },
      body,
    });

    responseStatusCode = response.status;
    responseBody = await response.text();

    // Calculate next retry time if failed
    let nextRetry = null;
    if (!response.ok) {
      const retryDate = new Date();
      retryDate.setMinutes(retryDate.getMinutes() + 5); // First retry in 5 minutes
      nextRetry = retryDate.toISOString();
    }

    // Log successful or failed delivery attempt
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: webhookEndpointId,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: responseStatusCode,
      response_body: responseBody.substring(0, 1000),
      delivery_attempt: 1,
      next_retry_at: nextRetry,
    });

    return {
      success: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    console.error(`Webhook delivery failed to ${url}:`, error);
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Schedule retry on network error
    const retryDate = new Date();
    retryDate.setMinutes(retryDate.getMinutes() + 5);

    // Log failed delivery attempt
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: webhookEndpointId,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: 0,
      error_message: errorMessage,
      delivery_attempt: 1,
      next_retry_at: retryDate.toISOString(),
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Trigger webhooks for a specific event
 * This runs in the background and doesn't block the response
 */
export async function triggerWebhooks(
  supabase: SupabaseClient,
  orgId: string,
  event: string,
  data: Record<string, any>
): Promise<void> {
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
        supabase
      );

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
