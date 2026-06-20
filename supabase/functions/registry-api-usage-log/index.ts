// Batch 5 — registry-api-usage-log. Internal admin/cron helper for tagging
// rate-limit hits onto the request log. Audited via registry_api_rate_limit_hit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const BodySchema = z.object({
  client_id: z.string().uuid(),
  key_id: z.string().uuid().optional(),
  environment: z.enum(["sandbox", "production"]),
  endpoint: z.string().min(1).max(120),
  scope_requested: z.string().max(120).optional(),
  scope_granted: z.boolean().default(false),
  rate_limited: z.boolean().default(false),
  result_state: z.string().min(1).max(60),
  status_code: z.number().int().min(100).max(599),
  request_id: z.string().min(1).max(120),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const provided = req.headers.get("x-internal-key") ?? "";
    if (!INTERNAL_CRON_KEY || provided !== INTERNAL_CRON_KEY) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const row = parsed.data;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await svc.from("registry_api_request_logs").insert({
      client_id: row.client_id, key_id: row.key_id ?? null, environment: row.environment,
      endpoint: row.endpoint, scope_requested: row.scope_requested ?? null,
      scope_granted: row.scope_granted, rate_limited: row.rate_limited,
      result_state: row.result_state, status_code: row.status_code, request_id: row.request_id,
    });
    if (row.rate_limited) {
      await svc.from("registry_api_audit_events").insert({
        audit_event_name: "registry_api_rate_limit_hit",
        client_id: row.client_id, key_id: row.key_id ?? null,
        payload: { endpoint: row.endpoint, request_id: row.request_id },
      });
      await svc.from("event_store").insert({
        event_name: "registry_api_rate_limit_hit", aggregate_type: "registry_api",
        payload: { client_id: row.client_id, endpoint: row.endpoint, request_id: row.request_id },
      }).catch(() => {});
    }
    return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-api-usage-log error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
