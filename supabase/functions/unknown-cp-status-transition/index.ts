// P012 — Admin/system structured status transition for unknown-counterparty cases.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";
import {
  UNKNOWN_CP_ADMIN_ACTIONS,
  UNKNOWN_CP_STATUS_LABEL,
  UNKNOWN_CP_STATUS_COPY,
  UNKNOWN_CP_STATUS_GROUP,
  UNKNOWN_CP_INTERNAL_ONLY_STATUSES,
  type UnknownCpAdminAction,
} from "../_shared/unknown-cp-timeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  facilitation_case_id: z.string().uuid(),
  action: z.enum(Object.keys(UNKNOWN_CP_ADMIN_ACTIONS) as [UnknownCpAdminAction, ...UnknownCpAdminAction[]]),
  reason_code: z.string().min(2).max(80).optional(),
  internal_note: z.string().max(2000).optional(),
  outcome_reason_code: z.string().max(80).optional(),
  closure_reason_code: z.string().max(80).optional(),
  known_counterparty_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Role gates
    const { data: roles } = await svc
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isPlatformAdmin = roleSet.has("platform_admin");
    const isAdmin =
      isPlatformAdmin ||
      roleSet.has("compliance_owner") ||
      roleSet.has("compliance_admin") ||
      roleSet.has("admin");

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (input.action === "reopen_case" && !isPlatformAdmin) {
      return new Response(JSON.stringify({ error: "reopen_requires_platform_admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: caseRow, error: caseErr } = await svc
      .from("facilitation_cases")
      .select("id, requesting_user_id, requesting_org_id, trade_request_id, poi_engagement_id")
      .eq("id", input.facilitation_case_id)
      .single();
    if (caseErr || !caseRow) {
      return new Response(JSON.stringify({ error: "case_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: overlay } = await svc
      .from("unknown_cp_case_overlays")
      .select("*")
      .eq("facilitation_case_id", input.facilitation_case_id)
      .maybeSingle();

    const mapping = UNKNOWN_CP_ADMIN_ACTIONS[input.action];
    const previousStatus = overlay?.user_facing_status ?? null;
    const newStatus = mapping.newStatus;
    const statusGroup = UNKNOWN_CP_STATUS_GROUP[newStatus];

    // Upsert overlay
    const overlayPatch: Record<string, unknown> = {
      facilitation_case_id: input.facilitation_case_id,
      poi_id: caseRow.poi_engagement_id ?? null,
      user_facing_status: newStatus,
      status_group: statusGroup,
      reopen_allowed: isPlatformAdmin && statusGroup === "closed",
    };
    if (input.outcome_reason_code) overlayPatch.outcome_reason_code = input.outcome_reason_code;
    if (input.closure_reason_code) overlayPatch.closure_reason_code = input.closure_reason_code;
    if (input.known_counterparty_id) overlayPatch.known_counterparty_id = input.known_counterparty_id;
    if (input.action === "reopen_case") {
      overlayPatch.reopened_at = new Date().toISOString();
      overlayPatch.reopened_by = user.id;
    }

    const { error: upsertErr } = await svc
      .from("unknown_cp_case_overlays")
      .upsert(overlayPatch, { onConflict: "facilitation_case_id" });
    if (upsertErr) throw upsertErr;

    // Visibility: outreach_prepared internal-only; everything else user-visible.
    const userVisible = !UNKNOWN_CP_INTERNAL_ONLY_STATUSES.has(newStatus);

    const { error: evtErr } = await svc.from("unknown_cp_timeline_events").insert({
      facilitation_case_id: input.facilitation_case_id,
      poi_id: caseRow.poi_engagement_id ?? null,
      previous_status: previousStatus,
      new_status: newStatus,
      status_label: UNKNOWN_CP_STATUS_LABEL[newStatus],
      user_visible: userVisible,
      user_facing_copy: UNKNOWN_CP_STATUS_COPY[newStatus],
      internal_note: input.internal_note ?? null,
      reason_code: input.reason_code ?? null,
      actor_id: user.id,
      actor_role: isPlatformAdmin ? "platform_admin" : "admin",
      actor_type: isPlatformAdmin ? "platform_admin" : "admin",
      source: `admin_action:${input.action}`,
      audit_event_name: mapping.audit,
      metadata: input.metadata ?? {},
    });
    if (evtErr) throw evtErr;

    // Event-store audit (best-effort)
    await svc.from("event_store").insert({
      event_name: mapping.audit,
      aggregate_id: input.facilitation_case_id,
      aggregate_type: "unknown_cp_case",
      actor_id: user.id,
      payload: {
        previous_status: previousStatus,
        new_status: newStatus,
        action: input.action,
        reason_code: input.reason_code ?? null,
        outcome_reason_code: input.outcome_reason_code ?? null,
        closure_reason_code: input.closure_reason_code ?? null,
        poi_id: caseRow.poi_engagement_id ?? null,
        trade_request_id: caseRow.trade_request_id,
        requester_user_id: caseRow.requesting_user_id,
        requester_org_id: caseRow.requesting_org_id,
      },
    }).catch(() => {/* event_store schema variance tolerated */});

    return new Response(
      JSON.stringify({ ok: true, new_status: newStatus, status_group: statusGroup, user_visible: userVisible }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("unknown-cp-status-transition error", err);
    return new Response(JSON.stringify({ error: "internal_error", message: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
