// Batch 17 — registry-operations-audit
// Safe admin audit activity view. Returns only safe summaries — never raw
// provider payloads, raw bank fields, full API keys, or personal contacts.
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { requireOpsAdmin } from "../_shared/registry-operations-auth.ts";

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "account_number", "iban", "branch_code", "swift", "bic", "account_holder", "bank_code",
  "provider_payload", "raw_provider_result", "raw_provider_payload",
  "full_api_key", "api_key_secret", "secret_key",
  "email", "phone", "msisdn",
]);

function safeSummary(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 200) continue;
    if (typeof v === "object" && v !== null) continue; // do not nest raw objects
    out[k] = v;
  }
  return out;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const auth = await requireOpsAdmin(req);
    if (!auth.ok) return auth.response;
    const { svc, user } = auth;

    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1), 500);
    const eventName = url.searchParams.get("event_name");
    const since = url.searchParams.get("since"); // ISO

    let q = svc.from("event_store")
      .select("id,event_name,aggregate_id,aggregate_type,actor_id,payload,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (eventName) q = q.eq("event_name", eventName);
    if (since) q = q.gte("created_at", since);

    // Scope to registry-related events to keep the view relevant and safe.
    const { data } = await q;
    const events = (data ?? []).filter((e: any) => typeof e.event_name === "string" && (e.event_name.startsWith("registry_") || e.event_name.startsWith("business_decision_")));

    const rows = events.map((e: any) => ({
      id: e.id,
      timestamp: e.created_at,
      event_name: e.event_name,
      module: typeof e.aggregate_type === "string" ? e.aggregate_type : "registry",
      actor_role: "admin",
      safe_object_reference: e.aggregate_id ?? null,
      safe_summary: safeSummary(e.payload),
      audit_reference: e.id,
    }));

    await svc.from("event_store").insert({
      event_name: "registry_operations_audit_viewed",
      aggregate_id: null,
      aggregate_type: "registry_operations",
      actor_id: user.id,
      payload: { returned: rows.length, event_name: eventName, since },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ events: rows }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("registry-operations-audit error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    }));
  }
});
