// Batch 1 — Business Decision Register writer (M018).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  BUSINESS_DECISION_CATEGORIES,
  BUSINESS_DECISION_STATUSES,
  BUSINESS_DECISION_MIN_RATIONALE_LENGTH,
  type BusinessDecisionCategory,
  type BusinessDecisionStatus,
} from "../_shared/business-decisions.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  action: z.enum(["create", "update_status", "supersede"]),
  decision_id: z.string().uuid().optional(),
  title: z.string().min(5).max(200).optional(),
  category: z.enum(BUSINESS_DECISION_CATEGORIES as readonly [BusinessDecisionCategory, ...BusinessDecisionCategory[]]).optional(),
  decision_key: z.string().min(2).max(120).optional(),
  status: z.enum(BUSINESS_DECISION_STATUSES as readonly [BusinessDecisionStatus, ...BusinessDecisionStatus[]]).optional(),
  rationale: z.string().min(BUSINESS_DECISION_MIN_RATIONALE_LENGTH).max(2000),
  is_public: z.boolean().optional(),
  effective_at: z.string().datetime().optional(),
  review_at: z.string().datetime().optional(),
  expiry_at: z.string().datetime().optional(),
  owner_role: z.string().max(60).optional(),
  evidence_url: z.string().url().optional(),
  supersedes_decision_id: z.string().uuid().optional(),
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

    let decisionId = input.decision_id ?? null;
    let previousStatus: BusinessDecisionStatus | null = null;
    let auditEvent = "business_decision_status_changed";
    const nextStatus = input.status ?? "proposed";

    if (input.action === "create") {
      if (!input.title || !input.category || !input.decision_key) {
        return withCors(req, new Response(
          JSON.stringify({ error: "create_requires_title_category_key" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ));
      }
      const { data: inserted, error: insErr } = await svc
        .from("business_decisions")
        .insert({
          title: input.title,
          category: input.category,
          decision_key: input.decision_key,
          status: nextStatus,
          rationale: input.rationale,
          is_public: input.is_public ?? false,
          effective_at: input.effective_at ?? null,
          review_at: input.review_at ?? null,
          expiry_at: input.expiry_at ?? null,
          owner_role: input.owner_role ?? null,
          evidence_url: input.evidence_url ?? null,
          created_by: user.id,
          approved_by: nextStatus === "approved" ? user.id : null,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      decisionId = inserted!.id;
      auditEvent = "business_decision_recorded";
    } else {
      if (!decisionId) {
        return withCors(req, new Response(
          JSON.stringify({ error: "decision_id_required" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ));
      }
      const { data: existing } = await svc
        .from("business_decisions")
        .select("status")
        .eq("id", decisionId)
        .single();
      previousStatus = (existing?.status ?? null) as BusinessDecisionStatus | null;

      if (input.action === "supersede") {
        if (!input.supersedes_decision_id) {
          return withCors(req, new Response(
            JSON.stringify({ error: "supersedes_decision_id_required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ));
        }
        await svc.from("business_decisions")
          .update({ status: "superseded", superseded_by: decisionId })
          .eq("id", input.supersedes_decision_id);
        auditEvent = "business_decision_superseded";
      }

      if (input.status) {
        const { error: updErr } = await svc
          .from("business_decisions")
          .update({
            status: input.status,
            approved_by: input.status === "approved" ? user.id : null,
            effective_at: input.effective_at ?? null,
            review_at: input.review_at ?? null,
            expiry_at: input.expiry_at ?? null,
          })
          .eq("id", decisionId);
        if (updErr) throw updErr;
      }
    }

    const { error: evtErr } = await svc.from("business_decision_events").insert({
      decision_id: decisionId,
      previous_status: previousStatus,
      new_status: nextStatus,
      reason: input.rationale,
      actor_id: user.id,
      audit_event_name: auditEvent,
    });
    if (evtErr) throw evtErr;

    await svc.from("event_store").insert({
      event_name: auditEvent,
      aggregate_id: decisionId,
      aggregate_type: "business_decision",
      actor_id: user.id,
      payload: {
        action: input.action,
        previous_status: previousStatus,
        new_status: nextStatus,
        reason: input.rationale,
      },
    }).catch(() => {/* event_store schema variance tolerated */});

    return withCors(req, new Response(
      JSON.stringify({ ok: true, decision_id: decisionId, status: nextStatus, audit_event: auditEvent }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  } catch (err) {
    console.error("business-decision-record error", err);
    return withCors(req, new Response(
      JSON.stringify({ error: "internal_error", message: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    ));
  }
});
