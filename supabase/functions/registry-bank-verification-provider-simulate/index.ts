// Batch 14 — Provider SIMULATION ONLY. Records a test-only provider outcome.
// Never calls a real external provider. Never returns API-verified status.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_PROVIDER_OUTCOME_TO_STATUS,
  REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES,
  REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL,
} from "../_shared/registry-bank-verification.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  request_id: z.string().uuid(),
  provider_config_id: z.string().uuid().optional(),
  simulated_outcome: z.enum(REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES),
  reason: z.string().min(3).max(2000),
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

    // Test mode must be ON.
    const { data: tm } = await svc.from("admin_settings").select("value").eq("key", "test_mode_bypass").maybeSingle();
    const testModeOn = (tm?.value as { enabled?: boolean } | null)?.enabled === true;
    if (!testModeOn) return json(req, 409, { ok: false, error: "test_mode_required", message: REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL });

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { error: "invalid_body", details: parsed.error.flatten() });
    const input = parsed.data;

    const { data: vr } = await svc.from("registry_bank_detail_verification_requests")
      .select("id, submission_id, verification_status").eq("id", input.request_id).maybeSingle();
    if (!vr) return json(req, 404, { error: "request_not_found" });

    const newStatus = REGISTRY_BANK_PROVIDER_OUTCOME_TO_STATUS[input.simulated_outcome];

    // Provider configs in sandbox/test mode can never set status to verified.
    const { data: result, error: rErr } = await svc.from("registry_bank_detail_provider_results").insert({
      request_id: vr.id,
      submission_id: vr.submission_id,
      provider_config_id: input.provider_config_id ?? null,
      simulated: true, // always true in Batch 14
      outcome: input.simulated_outcome,
      provider_raw_excerpt: { simulated: true, label: REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL },
      recorded_by: user.id,
    }).select("id").single();
    if (rErr) return json(req, 500, { error: "insert_failed", details: rErr.message });

    await svc.from("registry_bank_detail_verification_requests").update({
      verification_status: newStatus,
    }).eq("id", vr.id);

    await svc.from("registry_bank_detail_verification_events").insert({
      request_id: vr.id, submission_id: vr.submission_id,
      audit_event_name: "registry_bank_verification_provider_simulated",
      previous_status: vr.verification_status, new_status: newStatus,
      actor_id: user.id, reason: input.reason,
      payload: { simulated_outcome: input.simulated_outcome, result_id: result.id, test_only: true },
    });
    await svc.from("registry_bank_detail_verification_events").insert({
      request_id: vr.id, submission_id: vr.submission_id,
      audit_event_name: "registry_bank_verification_provider_result_recorded",
      previous_status: vr.verification_status, new_status: newStatus,
      actor_id: user.id, reason: input.reason,
      payload: { result_id: result.id, simulated: true },
    });

    // Important: provider_matched is NOT API-verified. Caller must run promote-to-verified.
    return json(req, 200, {
      ok: true, simulated: true, verification_status: newStatus,
      api_verified: false, label: REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL,
    });
  } catch (err) {
    console.error("registry-bank-verification-provider-simulate error", err);
    return json(req, 500, { error: "internal_error" });
  }
});
