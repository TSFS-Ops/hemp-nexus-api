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
          // Legacy: stored value is a hash, cannot recover original secret
          // Log warning and skip this webhook
          console.warn(`Webhook ${endpoint.id} uses legacy hash format - cannot sign properly. Please recreate the webhook.`);
          secret = endpoint.secret_hash; // Fallback - signature verification will fail on recipient side
        }
      } catch (err) {
        console.error(`Failed to decrypt webhook secret for ${endpoint.id}:`, err);
        return { success: false, error: "Failed to decrypt webhook secret" };
      }

      const result = await deliverWebhook(
        endpoint.url, 
        payload, 
        secret,
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
 * Notify counterparty about intent confirmation
 * This creates an in-app notification and triggers their webhooks
 */
export async function notifyCounterpartyIntent(
  supabase: SupabaseClient,
  matchData: {
    matchId: string;
    hash: string;
    confirmedAt: string;
    confirmingPartyId: string;
    confirmingPartyName: string;
    counterpartyId: string;
    counterpartyName: string;
    commodity: string;
    quantity: number;
    quantityUnit: string;
    priceAmount: number;
    priceCurrency: string;
  }
): Promise<void> {
  try {
    console.log(`Notifying counterparty ${matchData.counterpartyName} about intent confirmation`);

    // Find the counterparty's organization by looking up matches where they are buyer/seller
    // This searches for any org that has been involved with this counterparty ID
    const { data: relatedMatches, error: matchError } = await supabase
      .from("matches")
      .select("org_id, buyer_id, seller_id")
      .or(`buyer_id.eq.${matchData.counterpartyId},seller_id.eq.${matchData.counterpartyId}`)
      .limit(1);

    if (matchError) {
      console.error("Error finding counterparty org:", matchError);
    }

    // If we found a related org, trigger their webhooks
    if (relatedMatches && relatedMatches.length > 0) {
      const counterpartyOrgId = relatedMatches[0].org_id;
      
      // Trigger intent.received event for the counterparty
      await triggerWebhooks(supabase, counterpartyOrgId, "intent.received", {
        matchId: matchData.matchId,
        hash: matchData.hash,
        confirmedAt: matchData.confirmedAt,
        interestedParty: {
          id: matchData.confirmingPartyId,
          name: matchData.confirmingPartyName,
        },
        yourRole: matchData.counterpartyId === relatedMatches[0].buyer_id ? "buyer" : "seller",
        commodity: matchData.commodity,
        quantity: {
          amount: matchData.quantity,
          unit: matchData.quantityUnit,
        },
        price: {
          amount: matchData.priceAmount,
          currency: matchData.priceCurrency,
        },
        note: "A counterparty has confirmed interest in this match. No obligation has been created.",
        actionUrl: `/dashboard/matches/${matchData.matchId}`,
      });

      console.log(`Counterparty webhook triggered for org: ${counterpartyOrgId}`);
    }

    // Also create a match_events entry for the counterparty notification
    const notificationPayload = JSON.stringify({
      type: "counterparty_notified",
      counterpartyId: matchData.counterpartyId,
      counterpartyName: matchData.counterpartyName,
      notifiedAt: new Date().toISOString(),
    });

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(notificationPayload));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const payloadHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // Get the previous event hash for chaining
    const { data: lastEvent } = await supabase
      .from("match_events")
      .select("payload_hash")
      .eq("match_id", matchData.matchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Insert notification event into the chain
    await supabase.from("match_events").insert({
      match_id: matchData.matchId,
      org_id: (await supabase.from("matches").select("org_id").eq("id", matchData.matchId).single()).data?.org_id,
      event_type: "counterparty.notified",
      event_data: {
        counterpartyId: matchData.counterpartyId,
        counterpartyName: matchData.counterpartyName,
        notificationMethod: "webhook",
        message: `${matchData.confirmingPartyName} has confirmed interest in your ${matchData.commodity} opportunity`,
      },
      payload_hash: payloadHash,
      previous_event_hash: lastEvent?.payload_hash || null,
    });

    console.log(`Counterparty notification event recorded for match: ${matchData.matchId}`);
  } catch (error) {
    console.error("Error notifying counterparty:", error);
    // Don't throw - this is a non-critical background operation
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
