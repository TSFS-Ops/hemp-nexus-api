// Batch 4 — M007 Verified Bank Detail Status state machine writer.
// Admin/compliance-only. The only path to `verified` requires verified_at,
// verified_by (admin acting), verification_method and expiry_at, plus an audit
// event. No external provider integration is wired in Batch 4.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_DETAIL_STATES,
  type RegistryBankDetailState,
} from "../_shared/registry-bank-details.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  next_status: z.enum(REGISTRY_BANK_DETAIL_STATES),
  rationale: z.string().min(10).max(2000),
  verification_method: z.string().max(120).optional(),
  expiry_at: z.string().datetime().optional(),
  failure_reason: z.string().max(2000).optional(),
});

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

    const { data: existing } = await svc.from("registry_bank_detail_submissions").select("id, status").eq("id", input.submission_id).maybeSingle();
    if (!existing) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));

    const previous = existing.status as RegistryBankDetailState;
    const now = new Date().toISOString();

    if (input.next_status === "verified") {
      if (!input.verification_method || !input.expiry_at) {
        return withCors(req, new Response(JSON.stringify({ error: "verified_requires_method_and_expiry" }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
    }

    const update: Record<string, unknown> = { status: input.next_status };
    if (input.next_status === "verified") {
      update.verified_at = now;
      update.verified_by = user.id;
      update.verification_method = input.verification_method;
      update.expiry_at = input.expiry_at;
    }
    if (input.next_status === "revoked") { update.revoked_at = now; update.revocation_reason = input.rationale; }
    if (input.next_status === "disputed") { update.disputed_at = now; update.dispute_reason = input.rationale; }
    if (input.next_status === "failed") update.failure_reason = input.failure_reason ?? input.rationale;

    await svc.from("registry_bank_detail_submissions").update(update).eq("id", input.submission_id);

    const events = ["registry_bank_detail_status_changed"];
    if (input.next_status === "revoked") events.push("registry_bank_detail_revoked");
    if (input.next_status === "disputed") events.push("registry_bank_detail_disputed");

    for (const ev of events) {
      await svc.from("registry_bank_detail_events").insert({
        submission_id: input.submission_id,
        audit_event_name: ev,
        previous_status: previous,
        new_status: input.next_status,
        reason: input.rationale,
        actor_id: user.id,
        payload: { method: input.verification_method ?? null, expiry_at: input.expiry_at ?? null },
      });
      await svc.from("event_store").insert({
        event_name: ev,
        aggregate_id: input.submission_id,
        aggregate_type: "registry_bank_detail_submission",
        actor_id: user.id,
        payload: { previous, next: input.next_status },
      }).catch(() => {});
    }

    return withCors(req, new Response(JSON.stringify({ ok: true, status: input.next_status }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-bank-detail-status-transition error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
