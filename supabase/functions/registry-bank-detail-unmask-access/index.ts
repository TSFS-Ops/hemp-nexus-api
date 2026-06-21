// Batch 13 — Elevated, reasoned unmask access to bank-detail raw fields.
// Distinct from registry-bank-detail-access:
//   - Always requires a reason (>=20 chars).
//   - Always requires platform_admin / compliance_owner.
//   - Writes to BOTH registry_bank_detail_access_log AND the new
//     registry_bank_detail_unmask_access_logs ledger, with the list of
//     fields that were actually returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { deobfuscate } from "../_shared/registry-bank-details.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FIELDS = [
  "account_holder_name", "bank_name", "account_number", "branch_code", "swift_bic", "iban",
] as const;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  reason: z.string().min(20).max(2000),
  fields: z.array(z.enum(FIELDS)).min(1).optional(),
});

function json(req: Request, body: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, { error: "unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, { error: "invalid_body" }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return json(req, { error: "forbidden" }, 403);
    }

    const { data: row } = await svc.from("registry_bank_detail_submissions")
      .select("id, enc_account_holder_name, enc_bank_name, enc_account_number, enc_branch_code, enc_swift_bic, enc_iban")
      .eq("id", parsed.data.submission_id).maybeSingle();
    if (!row) return json(req, { error: "not_found" }, 404);

    const requested = parsed.data.fields ?? Array.from(FIELDS);
    const all: Record<string, string> = {
      account_holder_name: deobfuscate(row.enc_account_holder_name as string | null),
      bank_name: deobfuscate(row.enc_bank_name as string | null),
      account_number: deobfuscate(row.enc_account_number as string | null),
      branch_code: deobfuscate(row.enc_branch_code as string | null),
      swift_bic: deobfuscate(row.enc_swift_bic as string | null),
      iban: deobfuscate(row.enc_iban as string | null),
    };
    const unmasked: Record<string, string> = {};
    for (const f of requested) unmasked[f] = all[f];

    await svc.from("registry_bank_detail_unmask_access_logs").insert({
      submission_id: parsed.data.submission_id, actor_id: user.id, reason: parsed.data.reason, fields_viewed: requested,
    });
    await svc.from("registry_bank_detail_access_log").insert({
      submission_id: parsed.data.submission_id, actor_id: user.id, access_type: "unmasked_view", reason: parsed.data.reason, approved: true,
    });
    await svc.from("registry_bank_detail_events").insert({
      submission_id: parsed.data.submission_id, audit_event_name: "registry_bank_detail_unmask_viewed",
      previous_status: null, new_status: null, actor_id: user.id, reason: parsed.data.reason, payload: { fields: requested },
    });
    await svc.from("event_store").insert({
      event_name: "registry_bank_detail_unmask_viewed", aggregate_id: parsed.data.submission_id,
      aggregate_type: "registry_bank_detail_submission", actor_id: user.id, payload: { fields: requested, reason: parsed.data.reason },
    }).catch(() => {});

    return json(req, { ok: true, unmasked });
  } catch (err) {
    console.error("registry-bank-detail-unmask-access error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
