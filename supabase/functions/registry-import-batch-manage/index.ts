// Batch 2 — M012 Import Batch lifecycle writer.
// Create / transition import batches with strict state machine and evidence
// requirements. Publication requires approved + business_decision evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  IMPORT_BATCH_STATES,
  IMPORT_BATCH_ALLOWED_TRANSITIONS,
  type ImportBatchState,
} from "../_shared/registry-import-batches.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CreateSchema = z.object({
  action: z.literal("create"),
  batch_reference: z.string().min(3).max(120),
  source_id: z.string().uuid(),
  country_code: z.string().min(2).max(8),
  licence_reference: z.string().min(2).max(200),
  permitted_uses: z.array(z.string().min(2).max(60)).min(1),
  schema_version: z.string().min(1).max(20).default("v0"),
  evidence_url: z.string().url(),
  reason: z.string().min(20).max(500),
});

const TransitionSchema = z.object({
  action: z.literal("transition"),
  batch_id: z.string().uuid(),
  new_state: z.enum(IMPORT_BATCH_STATES as readonly [ImportBatchState, ...ImportBatchState[]]),
  validation_summary: z.record(z.unknown()).optional(),
  evidence_url: z.string().url().optional(),
  business_decision_id: z.string().uuid().optional(),
  reason: z.string().min(20).max(500),
});

const BodySchema = z.discriminatedUnion("action", [CreateSchema, TransitionSchema]);

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

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAuthorised = roleSet.has("platform_admin") || roleSet.has("compliance_owner");
    if (!isAuthorised) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "create") {
      const { data, error } = await svc.from("registry_import_batches").insert({
        batch_reference: input.batch_reference,
        source_id: input.source_id,
        country_code: input.country_code,
        licence_reference: input.licence_reference,
        permitted_uses: input.permitted_uses,
        schema_version: input.schema_version,
        evidence_url: input.evidence_url,
        state: "draft",
        uploaded_by: user.id,
      }).select("id").single();
      if (error) throw error;
      const batchId = data!.id;

      await svc.from("registry_import_batch_events").insert({
        batch_id: batchId,
        previous_state: null,
        new_state: "draft",
        reason: input.reason,
        audit_event_name: "registry_import_batch_created",
        evidence_url: input.evidence_url,
        actor_id: user.id,
        payload: { source_id: input.source_id, country_code: input.country_code },
      });

      await svc.from("event_store").insert({
        event_name: "registry_import_batch_created",
        aggregate_id: batchId,
        aggregate_type: "registry_import_batch",
        actor_id: user.id,
        payload: { batch_reference: input.batch_reference, country_code: input.country_code },
      }).catch(() => {});

      return withCors(req, new Response(JSON.stringify({ ok: true, batch_id: batchId, state: "draft" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // ---- transition ------------------------------------------------------
    const { data: batch, error: getErr } = await svc
      .from("registry_import_batches")
      .select("id, state")
      .eq("id", input.batch_id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!batch) {
      return withCors(req, new Response(JSON.stringify({ error: "batch_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    }

    const previousState = batch.state as ImportBatchState;
    const allowed = IMPORT_BATCH_ALLOWED_TRANSITIONS[previousState] ?? [];
    if (!allowed.includes(input.new_state)) {
      return withCors(req, new Response(JSON.stringify({
        error: "invalid_transition", from: previousState, to: input.new_state,
      }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }

    // Hard rule: publish must reference an approved business_decision and evidence URL.
    if (input.new_state === "published") {
      if (!input.business_decision_id || !input.evidence_url) {
        return withCors(req, new Response(JSON.stringify({
          error: "publish_requires_business_decision_and_evidence",
        }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
      const { data: decision } = await svc
        .from("business_decisions")
        .select("status")
        .eq("id", input.business_decision_id)
        .maybeSingle();
      if (!decision || decision.status !== "approved") {
        return withCors(req, new Response(JSON.stringify({
          error: "business_decision_not_approved",
        }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
    }

    const update: Record<string, unknown> = { state: input.new_state };
    if (input.validation_summary) update.validation_summary = input.validation_summary;
    if (input.new_state === "approved") { update.approver_id = user.id; update.approved_at = new Date().toISOString(); }
    if (input.new_state === "published") update.published_at = new Date().toISOString();
    if (input.new_state === "rolled_back") update.rolled_back_at = new Date().toISOString();
    if (input.new_state === "pending_approval") update.reviewer_id = user.id;

    const { error: updErr } = await svc.from("registry_import_batches").update(update).eq("id", input.batch_id);
    if (updErr) throw updErr;

    const auditName =
      input.new_state === "published" ? "registry_import_batch_published" :
      input.new_state === "rolled_back" ? "registry_import_batch_rolled_back" :
      input.validation_summary ? "registry_import_batch_validation_recorded" :
      "registry_import_batch_state_changed";

    await svc.from("registry_import_batch_events").insert({
      batch_id: input.batch_id,
      previous_state: previousState,
      new_state: input.new_state,
      reason: input.reason,
      audit_event_name: auditName,
      evidence_url: input.evidence_url ?? null,
      actor_id: user.id,
      payload: {
        validation_summary: input.validation_summary ?? null,
        business_decision_id: input.business_decision_id ?? null,
      },
    });

    await svc.from("event_store").insert({
      event_name: auditName,
      aggregate_id: input.batch_id,
      aggregate_type: "registry_import_batch",
      actor_id: user.id,
      payload: { previous_state: previousState, new_state: input.new_state, reason: input.reason },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, batch_id: input.batch_id, previous_state: previousState, new_state: input.new_state, audit_event: auditName }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-import-batch-manage error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
