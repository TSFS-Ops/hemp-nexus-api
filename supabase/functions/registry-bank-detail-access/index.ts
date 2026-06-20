// Batch 4 — M006 Bank-detail access audit + unmasked access gate.
// Three modes:
//   - log_masked_view: records that an authorised viewer saw the masked record.
//   - request_unmasked: records an unmasked-access request with reason.
//   - read_unmasked:   admin/compliance only; returns deobfuscated values and
//                      writes a registry_bank_detail_unmasked_viewed audit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { deobfuscate } from "../_shared/registry-bank-details.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  mode: z.enum(["log_masked_view", "request_unmasked", "read_unmasked"]),
  reason: z.string().max(2000).optional(),
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
    const isAdmin = roleSet.has("platform_admin") || roleSet.has("compliance_owner");

    if (input.mode === "log_masked_view") {
      await svc.from("registry_bank_detail_access_log").insert({
        submission_id: input.submission_id, actor_id: user.id, access_type: "masked_view", reason: input.reason ?? null, approved: true,
      });
      await svc.from("registry_bank_detail_events").insert({
        submission_id: input.submission_id, audit_event_name: "registry_bank_detail_masked_viewed", previous_status: null, new_status: null, actor_id: user.id, payload: {},
      });
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.mode === "request_unmasked") {
      if (!input.reason || input.reason.length < 20) {
        return withCors(req, new Response(JSON.stringify({ error: "reason_required" }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_bank_detail_access_log").insert({
        submission_id: input.submission_id, actor_id: user.id, access_type: "unmasked_request", reason: input.reason, approved: false,
      });
      await svc.from("registry_bank_detail_events").insert({
        submission_id: input.submission_id, audit_event_name: "registry_bank_detail_unmasked_access_requested", previous_status: null, new_status: null, actor_id: user.id, reason: input.reason, payload: {},
      });
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // read_unmasked
    if (!isAdmin) return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    if (!input.reason || input.reason.length < 20) {
      return withCors(req, new Response(JSON.stringify({ error: "reason_required" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const { data: row } = await svc.from("registry_bank_detail_submissions")
      .select("id, enc_account_holder_name, enc_bank_name, enc_account_number, enc_branch_code, enc_swift_bic, enc_iban")
      .eq("id", input.submission_id).maybeSingle();
    if (!row) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));

    await svc.from("registry_bank_detail_access_log").insert({
      submission_id: input.submission_id, actor_id: user.id, access_type: "unmasked_view", reason: input.reason, approved: true,
    });
    await svc.from("registry_bank_detail_events").insert({
      submission_id: input.submission_id, audit_event_name: "registry_bank_detail_unmasked_viewed", previous_status: null, new_status: null, actor_id: user.id, reason: input.reason, payload: {},
    });
    await svc.from("event_store").insert({
      event_name: "registry_bank_detail_unmasked_viewed", aggregate_id: input.submission_id, aggregate_type: "registry_bank_detail_submission", actor_id: user.id, payload: { reason: input.reason },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      unmasked: {
        account_holder_name: deobfuscate(row.enc_account_holder_name as string | null),
        bank_name: deobfuscate(row.enc_bank_name as string | null),
        account_number: deobfuscate(row.enc_account_number as string | null),
        branch_code: deobfuscate(row.enc_branch_code as string | null),
        swift_bic: deobfuscate(row.enc_swift_bic as string | null),
        iban: deobfuscate(row.enc_iban as string | null),
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-bank-detail-access error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
