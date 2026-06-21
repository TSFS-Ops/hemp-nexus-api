// Batch 9 — Approve and publish an import batch.
//
// Two actions:
//   - action='approve' moves batch state to 'approved'. Requires an
//     approved business_decision_id and evidence_url; cannot run if the
//     batch is missing source provenance (source_file_id), licence_reference
//     or country_code, or if validation has not completed.
//   - action='reject' moves the batch state to 'rejected' with rationale.
//   - action='publish' is allowed only on an 'approved' batch. Delegates to
//     atomic_publish_registry_import_batch which enforces every per-record
//     gate (quarantine, duplicate, validation).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ApproveSchema = z.object({
  action: z.literal("approve"),
  batch_id: z.string().uuid(),
  business_decision_id: z.string().uuid(),
  evidence_url: z.string().url(),
  rationale: z.string().min(20).max(2000),
});
const RejectSchema = z.object({
  action: z.literal("reject"),
  batch_id: z.string().uuid(),
  rationale: z.string().min(20).max(2000),
});
const PublishSchema = z.object({
  action: z.literal("publish"),
  batch_id: z.string().uuid(),
  acknowledged_imported_unverified: z.literal(true),
});
const BodySchema = z.discriminatedUnion("action", [ApproveSchema, RejectSchema, PublishSchema]);

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: batch } = await svc.from("registry_import_batches")
      .select("id, state, source_file_id, source_id, country_code, licence_reference, validation_summary")
      .eq("id", input.batch_id).maybeSingle();
    if (!batch) return withCors(req, new Response(JSON.stringify({ error: "batch_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));

    if (input.action === "approve") {
      if (!batch.source_file_id || !batch.licence_reference || !batch.country_code) {
        return withCors(req, new Response(JSON.stringify({ error: "missing_provenance_or_licence_or_country" }), { status: 422, headers: { "Content-Type": "application/json" } }));
      }
      if (!["validated", "pending_approval"].includes(batch.state)) {
        return withCors(req, new Response(JSON.stringify({ error: "batch_not_validated", state: batch.state }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      // Country must not be disabled.
      const { data: cov } = await svc.from("registry_country_coverage")
        .select("coverage_state, registry_data_state").eq("country_code", batch.country_code).maybeSingle();
      if (cov && (cov.coverage_state === "no_coverage")) {
        return withCors(req, new Response(JSON.stringify({ error: "country_disabled" }), { status: 422, headers: { "Content-Type": "application/json" } }));
      }
      // Business decision must be approved.
      const { data: bd } = await svc.from("business_decisions").select("status").eq("id", input.business_decision_id).maybeSingle();
      if (!bd || bd.status !== "approved") {
        return withCors(req, new Response(JSON.stringify({ error: "business_decision_not_approved" }), { status: 422, headers: { "Content-Type": "application/json" } }));
      }
      // Any open quarantine rows must be resolved first.
      const { count: qOpen } = await svc.from("registry_import_quarantine")
        .select("id", { count: "exact", head: true })
        .in("staging_id",
          (await svc.from("registry_import_records_staging").select("id").eq("batch_id", input.batch_id)).data?.map((r: { id: string }) => r.id) ?? [])
        .eq("status", "open");
      if ((qOpen ?? 0) > 0) {
        return withCors(req, new Response(JSON.stringify({ error: "open_quarantine_must_be_resolved", count: qOpen }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }

      await svc.from("registry_import_batches").update({
        state: "approved", approver_id: user.id, approved_at: new Date().toISOString(),
      }).eq("id", input.batch_id);
      await svc.from("registry_import_approval_events").insert({
        batch_id: input.batch_id, decision: "approved", decided_by: user.id,
        decision_rationale: input.rationale, evidence_url: input.evidence_url,
        business_decision_id: input.business_decision_id,
      });
      await svc.from("event_store").insert({
        event_name: "registry_import_publish_approved",
        aggregate_id: input.batch_id, aggregate_type: "registry_import_batch", actor_id: user.id,
        payload: { business_decision_id: input.business_decision_id },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ ok: true, state: "approved" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "reject") {
      await svc.from("registry_import_batches").update({ state: "rejected" }).eq("id", input.batch_id);
      await svc.from("registry_import_approval_events").insert({
        batch_id: input.batch_id, decision: "rejected", decided_by: user.id,
        decision_rationale: input.rationale,
      });
      await svc.from("event_store").insert({
        event_name: "registry_import_publish_rejected",
        aggregate_id: input.batch_id, aggregate_type: "registry_import_batch", actor_id: user.id,
        payload: {},
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ ok: true, state: "rejected" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // publish
    if (batch.state !== "approved") {
      return withCors(req, new Response(JSON.stringify({ error: "batch_not_approved", state: batch.state }), { status: 409, headers: { "Content-Type": "application/json" } }));
    }
    const { data: pubRes, error: pubErr } = await svc.rpc("atomic_publish_registry_import_batch", {
      p_batch_id: input.batch_id, p_actor: user.id,
    });
    if (pubErr) {
      await svc.from("event_store").insert({
        event_name: "registry_import_publish_failed",
        aggregate_id: input.batch_id, aggregate_type: "registry_import_batch", actor_id: user.id,
        payload: { error: pubErr.message },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ error: "publish_failed", message: pubErr.message }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }
    await svc.from("event_store").insert({
      event_name: "registry_import_search_index_created",
      aggregate_id: input.batch_id, aggregate_type: "registry_import_batch", actor_id: user.id,
      payload: { indexed: (pubRes as { indexed?: number })?.indexed ?? 0 },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, state: "published", result: pubRes }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-import-approve-publish error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
