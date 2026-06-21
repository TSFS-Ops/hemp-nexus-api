// Batch 14 — Provider config CRUD. Platform admin only. No live calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_BANK_VERIFICATION_MODES } from "../_shared/registry-bank-verification.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  action: z.enum(["create", "update", "list"]),
  id: z.string().uuid().optional(),
  provider_name: z.string().min(2).max(120).optional(),
  provider_mode: z.enum(REGISTRY_BANK_VERIFICATION_MODES).optional(),
  supported_countries: z.array(z.string().length(2)).optional(),
  supported_account_fields: z.array(z.string()).optional(),
  credentials_status: z.enum(["absent", "configured_sandbox", "configured_production", "revoked"]).optional(),
  permitted_use_decision_id: z.string().uuid().optional(),
  timeout_ms: z.number().int().min(1000).max(60000).optional(),
  notes: z.string().max(2000).optional(),
});

function json(req: Request, status: number, body: unknown) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, 401, { error: "unauthorized" });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin")) return json(req, 403, { error: "platform_admin_required" });

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { error: "invalid_body", details: parsed.error.flatten() });
    const input = parsed.data;

    // Provider live mode requires an approved permitted_use business decision.
    if ((input.provider_mode === "provider_live") && !input.permitted_use_decision_id) {
      return json(req, 400, { error: "provider_live_requires_permitted_use_decision" });
    }

    if (input.action === "list") {
      const { data } = await svc.from("registry_bank_detail_provider_configs")
        .select("id, provider_name, provider_mode, supported_countries, credentials_status, is_live, last_health_check_at, created_at")
        .order("created_at", { ascending: false });
      return json(req, 200, { ok: true, configs: data ?? [] });
    }

    if (input.action === "create") {
      if (!input.provider_name || !input.provider_mode) return json(req, 400, { error: "name_and_mode_required" });
      // is_live is always false in Batch 14 — no live integration wired.
      const { data, error } = await svc.from("registry_bank_detail_provider_configs").insert({
        provider_name: input.provider_name,
        provider_mode: input.provider_mode,
        supported_countries: input.supported_countries ?? [],
        supported_account_fields: input.supported_account_fields ?? [],
        credentials_status: input.credentials_status ?? "absent",
        permitted_use_decision_id: input.permitted_use_decision_id ?? null,
        timeout_ms: input.timeout_ms ?? 10000,
        is_live: false,
        notes: input.notes ?? null,
        created_by: user.id,
      }).select("id").single();
      if (error) return json(req, 500, { error: "insert_failed", details: error.message });
      await svc.from("registry_bank_detail_verification_events").insert({
        audit_event_name: "registry_bank_verification_provider_config_created",
        actor_id: user.id, reason: "create",
        payload: { provider_config_id: data.id, provider_mode: input.provider_mode },
      });
      return json(req, 200, { ok: true, id: data.id });
    }

    if (input.action === "update") {
      if (!input.id) return json(req, 400, { error: "id_required" });
      const patch: Record<string, unknown> = { is_live: false };
      if (input.provider_mode) patch.provider_mode = input.provider_mode;
      if (input.supported_countries) patch.supported_countries = input.supported_countries;
      if (input.supported_account_fields) patch.supported_account_fields = input.supported_account_fields;
      if (input.credentials_status) patch.credentials_status = input.credentials_status;
      if (input.permitted_use_decision_id !== undefined) patch.permitted_use_decision_id = input.permitted_use_decision_id;
      if (input.timeout_ms) patch.timeout_ms = input.timeout_ms;
      if (input.notes !== undefined) patch.notes = input.notes;
      await svc.from("registry_bank_detail_provider_configs").update(patch).eq("id", input.id);
      await svc.from("registry_bank_detail_verification_events").insert({
        audit_event_name: "registry_bank_verification_provider_config_updated",
        actor_id: user.id, reason: "update", payload: { provider_config_id: input.id, patch },
      });
      return json(req, 200, { ok: true });
    }

    return json(req, 400, { error: "unknown_action" });
  } catch (err) {
    console.error("registry-bank-verification-provider-config error", err);
    return json(req, 500, { error: "internal_error" });
  }
});
