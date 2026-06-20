// Batch 1 — Registry Module Readiness state transition (M019).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders, handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_READINESS_STATES,
  type RegistryReadinessState,
} from "../_shared/registry-readiness.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  module_code: z.string().regex(/^M0(0[1-9]|1[0-9])$/),
  new_state: z.enum(REGISTRY_READINESS_STATES as readonly [RegistryReadinessState, ...RegistryReadinessState[]]),
  reason: z.string().min(20).max(500),
  surface: z.string().min(1).max(80).optional(),
  country_code: z.string().min(2).max(8).optional(),
  provider: z.string().min(1).max(80).optional(),
  evidence_url: z.string().url().optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      }));
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(
        JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ));
    }
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: roles } = await svc
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAuthorised =
      roleSet.has("platform_admin") || roleSet.has("compliance_owner");
    if (!isAuthorised) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      }));
    }

    const { data: moduleRow, error: modErr } = await svc
      .from("registry_modules")
      .select("module_code, current_state")
      .eq("module_code", input.module_code)
      .single();
    if (modErr || !moduleRow) {
      return withCors(req, new Response(JSON.stringify({ error: "module_not_found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      }));
    }

    const previous = moduleRow.current_state as RegistryReadinessState;

    const { error: histErr } = await svc.from("registry_readiness_states").insert({
      module_code: input.module_code,
      country_code: input.country_code ?? null,
      provider: input.provider ?? null,
      surface: input.surface ?? "default",
      previous_state: previous,
      new_state: input.new_state,
      reason: input.reason,
      evidence_url: input.evidence_url ?? null,
      actor_id: user.id,
      audit_event_name: "registry_readiness_state_changed",
    });
    if (histErr) throw histErr;

    // Only update current_state when the transition targets the default surface (no scoping)
    if (!input.country_code && !input.provider && (!input.surface || input.surface === "default")) {
      const { error: updErr } = await svc
        .from("registry_modules")
        .update({ current_state: input.new_state })
        .eq("module_code", input.module_code);
      if (updErr) throw updErr;
    }

    await svc.from("event_store").insert({
      event_name: "registry_readiness_state_changed",
      aggregate_id: input.module_code,
      aggregate_type: "registry_module",
      actor_id: user.id,
      payload: {
        previous_state: previous,
        new_state: input.new_state,
        surface: input.surface ?? "default",
        country_code: input.country_code ?? null,
        provider: input.provider ?? null,
        reason: input.reason,
      },
    }).catch(() => {/* event_store schema variance tolerated */});

    return withCors(req, new Response(
      JSON.stringify({ ok: true, module_code: input.module_code, previous_state: previous, new_state: input.new_state }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  } catch (err) {
    console.error("registry-readiness-transition error", err);
    return withCors(req, new Response(
      JSON.stringify({ error: "internal_error", message: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    ));
  }
});
