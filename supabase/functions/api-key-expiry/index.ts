import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";

/**
 * API Key Expiry Automation — Public API V1 · Sandprod Batch 3
 *
 *  1. Disables expired keys (status='expired').
 *  2. Production keys: three distinct warning windows at 30 / 14 / 3 days
 *     before expiry, each gated by its own column so each window emits
 *     exactly once per key.
 *  3. Sandbox keys: single warning window (≤ 7 days) using a distinct
 *     column so it cannot collide with production warning state.
 *
 * Auth: INTERNAL_CRON_KEY required (no service-role fallback).
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  try {
    const internalKey = req.headers.get("x-internal-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    const expectedKey = Deno.env.get("INTERNAL_CRON_KEY");
    if (!expectedKey) {
      console.error("[api-key-expiry] INTERNAL_CRON_KEY not configured — refusing to run.");
      throw new ApiException("SERVER_NOT_CONFIGURED", "Server not configured", 503);
    }
    if (!internalKey || internalKey !== expectedKey) {
      throw new ApiException("UNAUTHORIZED", "Internal authentication required", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const addDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

    let expiredCount = 0;
    const warnCounts: Record<string, number> = { sandbox: 0, prod_30d: 0, prod_14d: 0, prod_3d: 0 };

    // 1. Disable expired keys
    const { data: expiredKeys, error: expiredError } = await supabase
      .from("api_keys")
      .select("id, org_id, name, environment, expires_at")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lte("expires_at", now.toISOString());
    if (expiredError) throw expiredError;

    if (expiredKeys && expiredKeys.length > 0) {
      const keyIds = expiredKeys.map((k) => k.id);
      const { error: updateError } = await supabase
        .from("api_keys")
        .update({ status: "expired", revoked_at: now.toISOString(), revoked_reason: "auto: expiry sweeper" })
        .in("id", keyIds);
      if (updateError) throw updateError;
      expiredCount = expiredKeys.length;

      for (const key of expiredKeys) {
        await supabase.from("audit_logs").insert({
          org_id: key.org_id,
          action: "apikey.expired",
          entity_type: "api_key",
          entity_id: key.id,
          metadata: { name: key.name, environment: key.environment, expires_at: key.expires_at, automated: true },
        });
      }
    }

    // 2. Production expiry warnings at 30 / 14 / 3 days
    const prodWindows: Array<{ days: number; column: string; audit: string; label: "prod_30d" | "prod_14d" | "prod_3d" }> = [
      { days: 30, column: "expiry_warning_30d_sent_at", audit: "api.production_key.expiry_warning_30d", label: "prod_30d" },
      { days: 14, column: "expiry_warning_14d_sent_at", audit: "api.production_key.expiry_warning_14d", label: "prod_14d" },
      { days: 3,  column: "expiry_warning_3d_sent_at",  audit: "api.production_key.expiry_warning_3d",  label: "prod_3d"  },
    ];
    for (const w of prodWindows) {
      const cutoff = addDays(w.days);
      const { data: rows, error } = await supabase
        .from("api_keys")
        .select("id, org_id, name, expires_at")
        .eq("status", "active")
        .eq("environment", "production")
        .is(w.column, null)
        .not("expires_at", "is", null)
        .lte("expires_at", cutoff.toISOString())
        .gt("expires_at", now.toISOString());
      if (error) throw error;
      if (!rows || rows.length === 0) continue;

      const ids = rows.map((r) => r.id);
      const { error: stampErr } = await supabase
        .from("api_keys").update({ [w.column]: now.toISOString() }).in("id", ids);
      if (stampErr) throw stampErr;
      warnCounts[w.label] = rows.length;

      for (const r of rows) {
        await supabase.from("audit_logs").insert({
          org_id: r.org_id,
          action: w.audit,
          entity_type: "api_key",
          entity_id: r.id,
          metadata: { name: r.name, environment: "production", expires_at: r.expires_at, window_days: w.days, automated: true },
        });
      }
    }

    // 3. Sandbox single-warning window (≤ 7 days)
    const sandboxCutoff = addDays(7);
    const { data: sboxRows, error: sboxErr } = await supabase
      .from("api_keys")
      .select("id, org_id, name, expires_at")
      .eq("status", "active")
      .eq("environment", "sandbox")
      .is("sandbox_expiry_warning_sent_at", null)
      .not("expires_at", "is", null)
      .lte("expires_at", sandboxCutoff.toISOString())
      .gt("expires_at", now.toISOString());
    if (sboxErr) throw sboxErr;

    if (sboxRows && sboxRows.length > 0) {
      const ids = sboxRows.map((r) => r.id);
      await supabase.from("api_keys").update({ sandbox_expiry_warning_sent_at: now.toISOString() }).in("id", ids);
      warnCounts.sandbox = sboxRows.length;
      for (const r of sboxRows) {
        await supabase.from("audit_logs").insert({
          org_id: r.org_id,
          action: "api.sandbox_key.expiry_warning",
          entity_type: "api_key",
          entity_id: r.id,
          metadata: { name: r.name, environment: "sandbox", expires_at: r.expires_at, automated: true },
        });
      }
    }

    return new Response(
      JSON.stringify({ message: "API key expiry automation complete", expired: expiredCount, warnings: warnCounts }),
      { status: 200, headers: { "Content-Type": "application/json", ...headers } },
    );
  } catch (error) {
    console.error(`[${requestId}] API key expiry job error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
