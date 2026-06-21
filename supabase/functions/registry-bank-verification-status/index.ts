// Batch 14 — Verification status read. Admin/compliance-only. No raw bank fields.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS,
  mapVerificationStatusToApiFlag,
  type RegistryBankVerificationStatus,
} from "../_shared/registry-bank-verification.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));

    const url = new URL(req.url);
    const submissionId = url.searchParams.get("submission_id");
    if (!submissionId) return withCors(req, new Response(JSON.stringify({ error: "submission_id_required" }), { status: 400, headers: { "Content-Type": "application/json" } }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: vr } = await svc.from("registry_bank_detail_verification_requests")
      .select("id, verification_status, verification_mode, expires_at, blocking_gates, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    const status: RegistryBankVerificationStatus = (vr?.verification_status as RegistryBankVerificationStatus) ?? "not_started";
    const now = new Date();
    const expired = vr?.expires_at ? new Date(vr.expires_at) < now : false;
    const effective: RegistryBankVerificationStatus = expired && status === "verified" ? "expired" : status;

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      submission_id: submissionId,
      verification_status: effective,
      verification_mode: vr?.verification_mode ?? null,
      expires_at: vr?.expires_at ?? null,
      api_payment_flag: mapVerificationStatusToApiFlag(effective),
      safe_label: REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS[effective],
      blocking_gates: vr?.blocking_gates ?? [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-bank-verification-status error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
