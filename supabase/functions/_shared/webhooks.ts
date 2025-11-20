import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
  supabase: SupabaseClient
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
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

    // Log successful delivery attempt
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: webhookEndpointId,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: responseStatusCode,
      response_body: responseBody.substring(0, 1000),
      delivery_attempt: 1,
    });

    return {
      success: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    console.error(`Webhook delivery failed to ${url}:`, error);
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log failed delivery attempt
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: webhookEndpointId,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: 0,
      error_message: errorMessage,
      delivery_attempt: 1,
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
      const result = await deliverWebhook(
        endpoint.url, 
        payload, 
        endpoint.secret_hash,
        endpoint.id,
        supabase
      );

      // Update last_delivery_at
      await supabase
        .from("webhook_endpoints")
        .update({ last_delivery_at: new Date().toISOString() })
        .eq("id", endpoint.id);

      if (!result.success) {
        console.error(
          `Webhook delivery failed for ${endpoint.url}: ${result.error || result.statusCode}`
        );
      } else {
        console.log(`Webhook delivered successfully to ${endpoint.url}`);
      }

      return result;
    });

    await Promise.all(deliveryPromises);
  } catch (error) {
    console.error("Error in triggerWebhooks:", error);
  }
}

/**
 * Verify webhook signature (for incoming webhooks if needed)
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await generateSignature(payload, secret);
  return signature === expectedSignature;
}
