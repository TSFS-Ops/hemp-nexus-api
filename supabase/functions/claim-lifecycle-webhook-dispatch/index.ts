/**
 * Batch 7 — Claim lifecycle webhook dispatcher.
 *
 * Reads pending rows from public.claim_lifecycle_webhook_outbox, fans
 * them out to active webhook_endpoints subscribed to the matching
 * claim.* event, signs the payload with the endpoint's secret, and
 * records each delivery attempt in webhook_deliveries.
 *
 * Invocation:
 *   - Internal cron (X-Internal-Key header == INTERNAL_CRON_KEY).
 *   - Manual admin re-drive (X-Internal-Key header).
 *
 * Idempotency: each outbox row is locked via UPDATE ... WHERE status='pending'
 * RETURNING * before HTTP send; a successful send marks 'sent', a
 * failure schedules a retry per CLAIM_LIFECYCLE backoff ladder, and
 * exceeding CLAIM_LIFECYCLE_MAX_ATTEMPTS marks the row 'dead_letter'.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  CLAIM_LIFECYCLE_MAX_ATTEMPTS,
  CLAIM_LIFECYCLE_WEBHOOK_EVENTS,
  nextRetryDelaySeconds,
  type ClaimLifecycleWebhookEvent,
} from "../_shared/claim-lifecycle-webhooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!INTERNAL_KEY || req.headers.get("X-Internal-Key") !== INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Claim a batch of pending rows.
  const { data: pending, error } = await svc
    .from("claim_lifecycle_webhook_outbox")
    .select("id, event_type, aggregate_id, aggregate_type, payload, request_id, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: "outbox_read_failed", detail: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const validEvents = new Set<string>(CLAIM_LIFECYCLE_WEBHOOK_EVENTS);
  const results: Array<Record<string, unknown>> = [];

  for (const row of pending ?? []) {
    if (!validEvents.has(row.event_type)) {
      await svc.from("claim_lifecycle_webhook_outbox")
        .update({ status: "dead_letter", last_error: "unknown_event_type", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      continue;
    }

    // Lock the row by transitioning to 'dispatching'. If another worker
    // already took it, skip.
    const { data: lock } = await svc.from("claim_lifecycle_webhook_outbox")
      .update({ status: "dispatching", updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
    if (!lock) continue;

    // Fetch subscribed endpoints. We reuse webhook_endpoints; an endpoint
    // is subscribed when its `events` JSONB array contains this event_type
    // OR contains the wildcard "claim.*".
    const { data: endpoints } = await svc.from("webhook_endpoints")
      .select("id, url, status, secret_hash, events, org_id")
      .eq("status", "active");

    const targets = (endpoints ?? []).filter((ep: any) => {
      const evs = Array.isArray(ep.events) ? ep.events : [];
      return evs.includes(row.event_type) || evs.includes("claim.*");
    });

    let anyDelivered = false;
    let lastErr: string | null = null;

    for (const ep of targets) {
      const body = JSON.stringify({
        id: row.id,
        type: row.event_type as ClaimLifecycleWebhookEvent,
        aggregate_id: row.aggregate_id,
        aggregate_type: row.aggregate_type,
        request_id: row.request_id,
        delivered_at: new Date().toISOString(),
        data: row.payload ?? {},
      });
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = await hmacSha256Hex(ep.secret_hash ?? "", `${ts}.${body}`);

      try {
        const resp = await fetch(ep.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Claim-Webhook-Timestamp": ts,
            "X-Claim-Webhook-Signature": `sha256=${sig}`,
            "X-Claim-Webhook-Event": row.event_type,
            "X-Claim-Webhook-Request-Id": row.request_id ?? "",
          },
          body,
        });
        const ok = resp.status >= 200 && resp.status < 300;
        await svc.from("webhook_deliveries").insert({
          endpoint_id: ep.id,
          event_type: row.event_type,
          payload: row.payload,
          response_status: resp.status,
          delivery_status: ok ? "delivered" : "failed",
          attempt_number: row.attempts + 1,
        }).catch(() => {});
        if (ok) anyDelivered = true; else lastErr = `http_${resp.status}`;
        await resp.text().catch(() => {});
      } catch (err) {
        lastErr = (err as Error).message?.slice(0, 200) ?? "fetch_failed";
        await svc.from("webhook_deliveries").insert({
          endpoint_id: ep.id,
          event_type: row.event_type,
          payload: row.payload,
          delivery_status: "failed",
          attempt_number: row.attempts + 1,
          error_message: lastErr,
        }).catch(() => {});
      }
    }

    // No subscribers is success — drain the outbox row.
    if (targets.length === 0 || anyDelivered) {
      await svc.from("claim_lifecycle_webhook_outbox").update({
        status: "sent",
        attempts: row.attempts + 1,
        dispatched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", row.id);
      results.push({ id: row.id, status: "sent", targets: targets.length });
    } else {
      const nextAttempts = row.attempts + 1;
      const dead = nextAttempts >= CLAIM_LIFECYCLE_MAX_ATTEMPTS;
      const delay = nextRetryDelaySeconds(nextAttempts);
      await svc.from("claim_lifecycle_webhook_outbox").update({
        status: dead ? "dead_letter" : "pending",
        attempts: nextAttempts,
        last_error: lastErr,
        next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      results.push({ id: row.id, status: dead ? "dead_letter" : "retry", attempts: nextAttempts });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
