import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Webhook Retry Background Job
 * 
 * This edge function processes failed webhook deliveries with exponential backoff.
 * It should be called periodically via cron (e.g., every 5 minutes).
 * 
 * Retry Strategy:
 * - Attempt 1: Immediate (handled in original delivery)
 * - Attempt 2: 5 minutes later
 * - Attempt 3: 30 minutes later (exponential backoff)
 * - After max retries: Mark as dead letter
 */

Deno.serve(async (req) => {
  const headers = corsHeaders("*", req.headers.get("origin"));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch deliveries that need retry
    const now = new Date().toISOString();
    const { data: deliveries, error: fetchError } = await supabase
      .from("webhook_deliveries")
      .select(`
        *,
        webhook_endpoints!inner(
          id,
          url,
          secret_hash,
          status
        )
      `)
      .lte("next_retry_at", now)
      .lt("delivery_attempt", supabase.rpc("COALESCE", { column: "max_retries", default: 3 }))
      .eq("is_dead_letter", false)
      .eq("webhook_endpoints.status", "active")
      .limit(50);

    if (fetchError) throw fetchError;

    if (!deliveries || deliveries.length === 0) {
      return new Response(
        JSON.stringify({ message: "No webhooks to retry", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } }
      );
    }

    console.log(`Processing ${deliveries.length} webhook retries`);

    let successCount = 0;
    let failCount = 0;
    let deadLetterCount = 0;

    // Process each delivery
    for (const delivery of deliveries) {
      const endpoint = delivery.webhook_endpoints;
      const attempt = delivery.delivery_attempt + 1;
      
      try {
        // Reconstruct payload
        const payload = {
          event: delivery.event_type,
          data: delivery.payload,
          timestamp: new Date().toISOString(),
          orgId: delivery.org_id,
        };

        // Generate signature
        const payloadStr = JSON.stringify(payload);
        const signature = await generateSignature(payloadStr, endpoint.secret_hash);

        // Attempt delivery
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": delivery.event_type,
            "X-Webhook-Timestamp": payload.timestamp,
            "X-Webhook-Retry-Attempt": attempt.toString(),
          },
          body: payloadStr,
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        const responseBody = await response.text();

        if (response.ok) {
          // Success - update delivery record
          await supabase
            .from("webhook_deliveries")
            .update({
              response_status_code: response.status,
              response_body: responseBody.substring(0, 1000),
              delivery_attempt: attempt,
              next_retry_at: null, // Clear retry schedule
              error_message: null,
            })
            .eq("id", delivery.id);

          successCount++;
          console.log(`✓ Retry successful for ${endpoint.url} (attempt ${attempt})`);
        } else {
          // Failed but will retry
          const nextRetry = calculateNextRetry(attempt);
          const isMaxed = attempt >= (delivery.max_retries || 3);

          await supabase
            .from("webhook_deliveries")
            .update({
              response_status_code: response.status,
              response_body: responseBody.substring(0, 1000),
              delivery_attempt: attempt,
              next_retry_at: isMaxed ? null : nextRetry,
              is_dead_letter: isMaxed,
              error_message: isMaxed ? `Max retries (${attempt}) exceeded` : null,
            })
            .eq("id", delivery.id);

          if (isMaxed) {
            deadLetterCount++;
            console.log(`✗ Max retries reached for ${endpoint.url}`);
          } else {
            failCount++;
            console.log(`⟳ Will retry ${endpoint.url} at ${nextRetry}`);
          }
        }
      } catch (error) {
        // Network error
        const attempt = delivery.delivery_attempt + 1;
        const nextRetry = calculateNextRetry(attempt);
        const isMaxed = attempt >= (delivery.max_retries || 3);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        await supabase
          .from("webhook_deliveries")
          .update({
            delivery_attempt: attempt,
            next_retry_at: isMaxed ? null : nextRetry,
            is_dead_letter: isMaxed,
            error_message: isMaxed ? `Max retries: ${errorMessage}` : errorMessage,
          })
          .eq("id", delivery.id);

        if (isMaxed) {
          deadLetterCount++;
        } else {
          failCount++;
        }
        
        console.error(`Error retrying webhook ${delivery.id}:`, errorMessage);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Webhook retry processing complete",
        processed: deliveries.length,
        successful: successCount,
        failed: failCount,
        deadLetters: deadLetterCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...headers } }
    );
  } catch (error) {
    console.error("Webhook retry job error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...headers } }
    );
  }
});

/**
 * Generate HMAC-SHA256 signature for webhook payload
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
 * Calculate next retry time with exponential backoff
 * Attempt 2: 5 minutes
 * Attempt 3: 30 minutes
 * Attempt 4+: 2 hours
 */
function calculateNextRetry(attempt: number): string {
  const delays = [0, 5, 30, 120]; // minutes
  const delayMinutes = delays[attempt] || 120;
  
  const nextRetry = new Date();
  nextRetry.setMinutes(nextRetry.getMinutes() + delayMinutes);
  
  return nextRetry.toISOString();
}
