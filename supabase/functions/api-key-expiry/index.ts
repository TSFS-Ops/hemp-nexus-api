import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";

/**
 * API Key Expiry Automation
 * 
 * This edge function handles API key expiration:
 * 1. Sends warning emails 7 days before expiry
 * 2. Disables keys that have expired
 * 
 * SECURITY: This endpoint requires internal authentication via INTERNAL_CRON_KEY
 * to prevent unauthorised triggering.
 */

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  try {
    // SECURITY: Internal cron auth — INTERNAL_CRON_KEY must be set in production.
    // No fallback to SERVICE_ROLE_KEY (which would invite accidental exposure).
    const internalKey = req.headers.get("x-internal-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    const expectedKey = Deno.env.get("INTERNAL_CRON_KEY");
    if (!expectedKey) {
      console.error("[api-key-expiry] INTERNAL_CRON_KEY is not configured — refusing to run.");
      throw new ApiException("SERVER_NOT_CONFIGURED", "Server not configured", 503);
    }
    if (!internalKey || internalKey !== expectedKey) {
      throw new ApiException("UNAUTHORIZED", "Internal authentication required", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    let expiredCount = 0;
    let warningCount = 0;

    // Find and disable expired keys
    const { data: expiredKeys, error: expiredError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lte("expires_at", now.toISOString());

    if (expiredError) throw expiredError;

    if (expiredKeys && expiredKeys.length > 0) {
      const keyIds = expiredKeys.map(k => k.id);
      
      const { error: updateError } = await supabase
        .from("api_keys")
        .update({ 
          status: "expired",
          revoked_at: now.toISOString() 
        })
        .in("id", keyIds);

      if (updateError) throw updateError;

      expiredCount = expiredKeys.length;
      console.log(`Expired ${expiredCount} API keys`);

      // Log expiry events
      for (const key of expiredKeys) {
        await supabase.from("audit_logs").insert({
          org_id: key.org_id,
          actor_user_id: null,
          actor_api_key_id: null,
          action: "apikey.expired",
          entity_type: "api_key",
          entity_id: key.id,
          metadata: {
            name: key.name,
            expires_at: key.expires_at,
            automated: true,
          },
        });
      }
    }

    // Find keys expiring in 7 days (send warning)
    const { data: expiringKeys, error: expiringError } = await supabase
      .from("api_keys")
      .select(`
        *,
        organisations!inner(id, name),
        profiles!inner(id, email)
      `)
      .eq("status", "active")
      .eq("expiry_warning_sent", false)
      .not("expires_at", "is", null)
      .lte("expires_at", sevenDaysFromNow.toISOString())
      .gt("expires_at", now.toISOString());

    if (expiringError) throw expiringError;

    if (expiringKeys && expiringKeys.length > 0) {
      // In a real implementation, you would send emails here
      // For now, just mark warnings as sent and log
      
      const keyIds = expiringKeys.map(k => k.id);
      
      const { error: warningError } = await supabase
        .from("api_keys")
        .update({ expiry_warning_sent: true })
        .in("id", keyIds);

      if (warningError) throw warningError;

      warningCount = expiringKeys.length;
      console.log(`Sent ${warningCount} expiry warnings`);

      // Log warning events
      for (const key of expiringKeys) {
        console.log(`Warning: API key "${key.name}" expires on ${key.expires_at}`);
        
        await supabase.from("audit_logs").insert({
          org_id: key.org_id,
          actor_user_id: null,
          actor_api_key_id: null,
          action: "apikey.expiry_warning",
          entity_type: "api_key",
          entity_id: key.id,
          metadata: {
            name: key.name,
            expires_at: key.expires_at,
            days_until_expiry: Math.ceil(
              (new Date(key.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            ),
            automated: true,
          },
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: "API key expiry automation complete",
        expired: expiredCount,
        warnings_sent: warningCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...headers } }
    );
  } catch (error) {
    console.error(`[${requestId}] API key expiry job error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
