// Batch 15 — registry-api-client-key-manage.
// Issues/revokes API keys with strict sandbox/production separation.
// Production keys may only be issued when lifecycle_status = production_active.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { hashApiKey } from "../_shared/registry-institutional-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CreateSchema = z.object({
  action: z.literal("create_key"),
  client_id: z.string().uuid(),
  key_type: z.enum(["sandbox", "production"]),
  label: z.string().min(1).max(120).optional(),
});
const RevokeSchema = z.object({
  action: z.literal("revoke_key"),
  key_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
const BodySchema = z.union([CreateSchema, RevokeSchema]);

function json(req: Request, s: number, b: unknown) {
  return withCors(req, new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } }));
}

async function isPlatformAdmin(svc: ReturnType<typeof createClient>, userId: string) {
  const { data } = await svc.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r: { role: string }) => r.role === "platform_admin" || r.role === "compliance_owner");
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req); if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(req, 401, { error: "unauthorized" });
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    if (!await isPlatformAdmin(svc, user.id)) return json(req, 403, { error: "forbidden" });

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json(req, 400, { error: "invalid_body" });

    if (parsed.data.action === "create_key") {
      const { client_id, key_type, label } = parsed.data;
      const { data: client } = await svc.from("registry_api_clients")
        .select("id, lifecycle_status").eq("id", client_id).maybeSingle();
      if (!client) return json(req, 404, { error: "client_not_found" });
      // Production keys gated on production_active
      if (key_type === "production" && client.lifecycle_status !== "production_active") {
        return json(req, 422, {
          error: "production_key_requires_production_active_lifecycle",
          lifecycle_status: client.lifecycle_status,
        });
      }
      // Generate a fresh key
      const random = crypto.getRandomValues(new Uint8Array(24));
      const suffix = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
      const env = key_type === "production" ? "production" : "sandbox";
      const apiKey = `rk_${env}_${suffix}`;
      const prefix = apiKey.split("_").slice(0, 3).join("_");
      const key_hash = await hashApiKey(apiKey);
      const { data: row, error } = await svc.from("registry_api_keys").insert({
        client_id, key_prefix: prefix, key_hash, environment: env, key_type, label: label ?? null,
        status: "active", created_by: user.id,
      }).select("id").single();
      if (error) return json(req, 500, { error: "insert_failed", detail: error.message });
      await svc.from("registry_api_audit_events").insert({
        audit_event_name: "registry_api_key_created", client_id, key_id: row.id, actor_id: user.id,
        payload: { key_type, label: label ?? null },
      }).catch(() => {});
      return json(req, 200, { ok: true, key_id: row.id, api_key: apiKey, key_type });
    }

    // revoke_key
    const { key_id, reason } = parsed.data;
    const { data: key } = await svc.from("registry_api_keys").select("id, client_id, status").eq("id", key_id).maybeSingle();
    if (!key) return json(req, 404, { error: "key_not_found" });
    const { error } = await svc.from("registry_api_keys").update({
      status: "revoked", revoked_at: new Date().toISOString(), revoked_by: user.id, revoked_reason: reason,
    }).eq("id", key_id);
    if (error) return json(req, 500, { error: "update_failed", detail: error.message });
    await svc.from("registry_api_audit_events").insert({
      audit_event_name: "registry_api_key_revoked", client_id: key.client_id, key_id, actor_id: user.id,
      reason, payload: { reason },
    }).catch(() => {});
    return json(req, 200, { ok: true });
  } catch (e) {
    console.error("client-key-manage error", e);
    return json(req, 500, { error: "internal_error" });
  }
});
