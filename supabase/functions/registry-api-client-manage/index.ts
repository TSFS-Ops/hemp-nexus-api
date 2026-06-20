// Batch 5 — M016 API Client / Admin Management.
// Audited admin-only entry point for creating clients, issuing keys,
// suspending clients, and revoking keys. All status mutations flow through
// this function (table triggers block direct status changes from non-service
// callers).
//
// Canonical audit events:
//   registry_api_client_created, registry_api_client_updated,
//   registry_api_client_suspended, registry_api_key_created,
//   registry_api_key_revoked
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_API_ENVIRONMENTS,
  REGISTRY_API_SCOPES,
  generateApiKey,
  hashApiKey,
} from "../_shared/registry-institutional-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CreateClient = z.object({
  action: z.literal("create_client"),
  client_code: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  environment: z.enum(REGISTRY_API_ENVIRONMENTS).default("sandbox"),
  scopes: z.array(z.enum(REGISTRY_API_SCOPES)).min(1),
  organization_id: z.string().uuid().optional(),
  contact_email: z.string().email().optional(),
  rate_limit_per_minute: z.number().int().min(1).max(10000).default(60),
  rate_limit_per_day: z.number().int().min(1).max(10000000).default(10000),
  admin_notes: z.string().max(2000).optional(),
});

const UpdateClient = z.object({
  action: z.literal("update_client"),
  client_id: z.string().uuid(),
  scopes: z.array(z.enum(REGISTRY_API_SCOPES)).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(10000).optional(),
  rate_limit_per_day: z.number().int().min(1).max(10000000).optional(),
  admin_notes: z.string().max(2000).optional(),
  billing_readiness_tier: z.string().max(60).optional(),
});

const SuspendClient = z.object({
  action: z.literal("suspend_client"),
  client_id: z.string().uuid(),
  reason: z.string().min(20).max(2000),
});

const ReactivateClient = z.object({
  action: z.literal("reactivate_client"),
  client_id: z.string().uuid(),
  reason: z.string().min(20).max(2000),
});

const CreateKey = z.object({
  action: z.literal("create_key"),
  client_id: z.string().uuid(),
  expires_at: z.string().datetime().optional(),
});

const RevokeKey = z.object({
  action: z.literal("revoke_key"),
  key_id: z.string().uuid(),
  reason: z.string().min(20).max(2000),
});

const BodySchema = z.discriminatedUnion("action", [
  CreateClient, UpdateClient, SuspendClient, ReactivateClient, CreateKey, RevokeKey,
]);

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;

    async function audit(name: string, payload: Record<string, unknown>, clientId: string | null, keyId: string | null, reason?: string) {
      await svc.from("registry_api_audit_events").insert({ audit_event_name: name, client_id: clientId, key_id: keyId, actor_id: user.id, reason: reason ?? null, payload }).catch(() => {});
      await svc.from("event_store").insert({ event_name: name, aggregate_type: "registry_api", actor_id: user.id, payload }).catch(() => {});
    }

    if (input.action === "create_client") {
      const { data: row, error } = await svc.from("registry_api_clients").insert({
        client_code: input.client_code,
        display_name: input.display_name,
        environment: input.environment,
        scopes: input.scopes,
        organization_id: input.organization_id ?? null,
        contact_email: input.contact_email ?? null,
        rate_limit_per_minute: input.rate_limit_per_minute,
        rate_limit_per_day: input.rate_limit_per_day,
        admin_notes: input.admin_notes ?? null,
        status: "active",
        created_by: user.id,
      }).select("id").single();
      if (error) throw error;
      await audit("registry_api_client_created", { client_code: input.client_code, environment: input.environment, scopes: input.scopes }, row.id, null);
      return withCors(req, new Response(JSON.stringify({ ok: true, client_id: row.id }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "update_client") {
      const patch: Record<string, unknown> = {};
      if (input.scopes) patch.scopes = input.scopes;
      if (typeof input.rate_limit_per_minute === "number") patch.rate_limit_per_minute = input.rate_limit_per_minute;
      if (typeof input.rate_limit_per_day === "number") patch.rate_limit_per_day = input.rate_limit_per_day;
      if (input.admin_notes !== undefined) patch.admin_notes = input.admin_notes;
      if (input.billing_readiness_tier !== undefined) patch.billing_readiness_tier = input.billing_readiness_tier;
      const { error } = await svc.from("registry_api_clients").update(patch).eq("id", input.client_id);
      if (error) throw error;
      await audit("registry_api_client_updated", { patch }, input.client_id, null);
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "suspend_client") {
      const { error } = await svc.from("registry_api_clients").update({
        status: "suspended", suspended_at: new Date().toISOString(), suspended_by: user.id, suspended_reason: input.reason,
      }).eq("id", input.client_id);
      if (error) throw error;
      await audit("registry_api_client_suspended", { reason: input.reason }, input.client_id, null, input.reason);
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "reactivate_client") {
      const { error } = await svc.from("registry_api_clients").update({
        status: "active", suspended_at: null, suspended_by: null, suspended_reason: null,
      }).eq("id", input.client_id);
      if (error) throw error;
      await audit("registry_api_client_updated", { reactivated: true, reason: input.reason }, input.client_id, null, input.reason);
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "create_key") {
      const { data: client } = await svc.from("registry_api_clients").select("environment, status").eq("id", input.client_id).maybeSingle();
      if (!client) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      if (client.status !== "active") return withCors(req, new Response(JSON.stringify({ error: "client_not_active" }), { status: 409, headers: { "Content-Type": "application/json" } }));
      const { full, prefix } = generateApiKey(client.environment as "sandbox" | "production");
      const hash = await hashApiKey(full);
      const { data: row, error } = await svc.from("registry_api_keys").insert({
        client_id: input.client_id, key_prefix: prefix, key_hash: hash,
        environment: client.environment, status: "active",
        expires_at: input.expires_at ?? null, created_by: user.id,
      }).select("id").single();
      if (error) throw error;
      await audit("registry_api_key_created", { prefix, environment: client.environment }, input.client_id, row.id);
      // Return raw key ONCE; never readable again.
      return withCors(req, new Response(JSON.stringify({ ok: true, key_id: row.id, key_prefix: prefix, api_key: full, notice: "Store this API key now. It will not be shown again." }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "revoke_key") {
      const { data: key } = await svc.from("registry_api_keys").select("client_id").eq("id", input.key_id).maybeSingle();
      if (!key) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      const { error } = await svc.from("registry_api_keys").update({
        status: "revoked", revoked_at: new Date().toISOString(), revoked_by: user.id, revoked_reason: input.reason,
      }).eq("id", input.key_id);
      if (error) throw error;
      await audit("registry_api_key_revoked", { reason: input.reason }, key.client_id, input.key_id, input.reason);
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return withCors(req, new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-api-client-manage error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
