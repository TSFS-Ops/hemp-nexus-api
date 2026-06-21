// Batch 13 — Evaluate risk flags on a bank-detail submission.
// Admin/compliance trigger. Looks at holder-vs-company mismatch, third-party
// account, country mismatch, duplicate fingerprint and missing evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  accountHolderLikelyMismatch,
  REGISTRY_BANK_DETAIL_B13_RISK_FLAG_TYPES,
  type RegistryBankDetailB13RiskFlagType,
  type RegistryBankDetailB13RiskLevel,
} from "../_shared/registry-bank-details-b13.ts";
import { deobfuscate } from "../_shared/registry-bank-details.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({ submission_id: z.string().uuid() });

function json(req: Request, body: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function highestRiskLevel(levels: RegistryBankDetailB13RiskLevel[]): RegistryBankDetailB13RiskLevel {
  const order: RegistryBankDetailB13RiskLevel[] = ["low", "medium", "high", "blocked"];
  let max: RegistryBankDetailB13RiskLevel = "low";
  for (const l of levels) if (order.indexOf(l) > order.indexOf(max)) max = l;
  return max;
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

    const { data: sub } = await svc.from("registry_bank_detail_submissions")
      .select("*").eq("id", parsed.data.submission_id).maybeSingle();
    if (!sub) return json(req, { error: "not_found" }, 404);

    const flags: { type: RegistryBankDetailB13RiskFlagType; level: RegistryBankDetailB13RiskLevel; details: Record<string, unknown> }[] = [];
    const holder = deobfuscate(sub.enc_account_holder_name as string | null);
    const companyName = String(sub.company_name ?? "");

    if (holder && companyName && accountHolderLikelyMismatch(holder, companyName)) {
      flags.push({ type: "account_holder_mismatch", level: "medium", details: {} });
    }
    if (sub.is_third_party === true) {
      flags.push({ type: "third_party_account", level: "high", details: {} });
    }
    if (sub.account_holder_kind === "individual") {
      flags.push({ type: "individual_holder_for_company", level: "high", details: {} });
    }
    if (sub.bank_country_code && sub.country_code && String(sub.bank_country_code).toUpperCase() !== String(sub.country_code).toUpperCase()) {
      flags.push({ type: "bank_country_company_mismatch", level: "medium", details: { bank: sub.bank_country_code, company: sub.country_code } });
    }
    if (sub.account_fingerprint) {
      const { data: dupes } = await svc.from("registry_bank_detail_submissions")
        .select("id, company_reference").eq("account_fingerprint", sub.account_fingerprint).neq("id", sub.id).limit(5);
      if (dupes && dupes.length > 0) {
        const otherCompany = dupes.some((d: { company_reference: string }) => d.company_reference !== sub.company_reference);
        if (otherCompany) {
          flags.push({ type: "duplicate_fingerprint_on_other_company", level: "high", details: { matches: dupes.length } });
          await svc.from("registry_bank_detail_events").insert({
            submission_id: sub.id, audit_event_name: "registry_bank_detail_duplicate_fingerprint_detected",
            previous_status: null, new_status: null, actor_id: user.id, payload: { matches: dupes.length },
          });
        }
      }
    }
    if (!sub.evidence_metadata_captured) {
      flags.push({ type: "evidence_missing", level: "medium", details: {} });
    }

    for (const f of flags) {
      if (!REGISTRY_BANK_DETAIL_B13_RISK_FLAG_TYPES.includes(f.type)) continue;
      await svc.from("registry_bank_detail_risk_flags").insert({
        submission_id: sub.id, flag_type: f.type, risk_level: f.level, details: f.details, raised_by: user.id,
      });
      await svc.from("registry_bank_detail_events").insert({
        submission_id: sub.id, audit_event_name: "registry_bank_detail_risk_flag_added",
        previous_status: null, new_status: null, actor_id: user.id, payload: { flag_type: f.type, level: f.level },
      });
    }

    const level = highestRiskLevel(flags.map((f) => f.level));
    await svc.from("registry_bank_detail_submissions").update({
      risk_level: level,
      mismatch_flags: flags.map((f) => f.type),
    }).eq("id", sub.id);

    return json(req, { ok: true, risk_level: level, flags: flags.map((f) => f.type) });
  } catch (err) {
    console.error("registry-bank-detail-risk-evaluate error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
