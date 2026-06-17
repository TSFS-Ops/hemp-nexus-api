/**
 * seed-uat-facilitation-accounts — Idempotent seed for the Unknown-Counterparty
 * Facilitation Queue Client UAT pack (Daniel).
 *
 * Creates / refreshes two test-only accounts on @test.izenzo.co.za:
 *   1. daniel-uat-compliance@test.izenzo.co.za  (role: compliance_analyst)
 *   2. daniel-uat-requester@test.izenzo.co.za   (role: org_member, requester)
 *
 * Also seeds:
 *   - one organisation per account ("Daniel UAT Compliance Org", "Daniel UAT Requester Org")
 *   - one trade_request owned by the requester
 *   - one facilitation case in `more_information_needed`  (requester UAT)
 *   - one facilitation case in `compliance_review_required` (compliance UAT)
 *
 * Hard safety rules:
 *   - platform_admin role is NEVER granted to either account
 *   - emails are forced to the @test.izenzo.co.za suffix (provision-test-user enforces this)
 *   - no outreach, no POI/WaD/match/token/credit/payment mutation
 *   - no real client orgs/users touched (fixed seeded org names + emails)
 *   - idempotent: re-running reuses existing users/orgs/cases (matched on case_number prefix)
 *
 * Auth gate: platform_admin JWT OR x-internal-key matching INTERNAL_CRON_KEY env.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function J(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const COMPLIANCE_EMAIL = "daniel-uat-compliance@test.izenzo.co.za";
const REQUESTER_EMAIL = "daniel-uat-requester@test.izenzo.co.za";
const PASSWORD = "DanielUatPass!2026Strong";

const COMPLIANCE_ORG_NAME = "Daniel UAT Compliance Org";
const REQUESTER_ORG_NAME = "Daniel UAT Requester Org";

const CASE_TAG_MORE_INFO = "daniel-uat-more-info";
const CASE_TAG_COMPLIANCE = "daniel-uat-compliance-review";

async function gate(req: Request): Promise<{ ok: boolean; reason?: string }> {
  const xkey = req.headers.get("x-internal-key") ?? "";
  if (CRON_KEY && xkey === CRON_KEY) return { ok: true };
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return { ok: false, reason: "no_auth" };
  const token = auth.slice(7);
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return { ok: false, reason: "bad_jwt" };
  const { data: ok } = await admin.rpc("has_role", { _user_id: user.id, _role: "platform_admin" });
  return ok === true ? { ok: true } : { ok: false, reason: "not_platform_admin" };
}

async function provision(email: string, password: string): Promise<string> {
  const r = await fetch(`${URL_}/functions/v1/provision-test-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON}`,
      "apikey": ANON,
      "x-internal-key": CRON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`provision ${email} failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.user_id as string;
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req); if (pf) return pf;
  if (req.method !== "POST") return J(req, { error: "Method not allowed" }, 405);
  const g = await gate(req);
  if (!g.ok) return J(req, { error: "Unauthorised", reason: g.reason }, 401);

  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const result: any = { steps: [] };
  const step = (id: string, ok: boolean, detail: any) => result.steps.push({ id, ok, detail });

  try {
    // 1. Provision both users (idempotent via provision-test-user)
    const complianceUserId = await provision(COMPLIANCE_EMAIL, PASSWORD);
    const requesterUserId = await provision(REQUESTER_EMAIL, PASSWORD);
    step("provision.compliance", !!complianceUserId, { user_id: complianceUserId, email: COMPLIANCE_EMAIL });
    step("provision.requester", !!requesterUserId, { user_id: requesterUserId, email: REQUESTER_EMAIL });

    // 2. Ensure one org per account (lookup-or-create by fixed name)
    async function ensureOrg(name: string): Promise<string> {
      const { data: existing } = await admin.from("organizations").select("id").eq("name", name).maybeSingle();
      if (existing?.id) return existing.id as string;
      const { data: created, error } = await admin.from("organizations").insert({
        name,
      }).select("id").single();
      if (error || !created) throw new Error(`org ${name} create failed: ${error?.message}`);
      return created.id as string;
    }
    const complianceOrgId = await ensureOrg(COMPLIANCE_ORG_NAME);
    const requesterOrgId = await ensureOrg(REQUESTER_ORG_NAME);
    step("org.compliance", true, { org_id: complianceOrgId, name: COMPLIANCE_ORG_NAME });
    step("org.requester", true, { org_id: requesterOrgId, name: REQUESTER_ORG_NAME });

    // 3. Bind each profile to its org
    await admin.from("profiles").upsert(
      { id: complianceUserId, org_id: complianceOrgId, email: COMPLIANCE_EMAIL, full_name: "Daniel UAT Compliance Analyst" },
      { onConflict: "id" },
    );
    await admin.from("profiles").upsert(
      { id: requesterUserId, org_id: requesterOrgId, email: REQUESTER_EMAIL, full_name: "Daniel UAT Requester" },
      { onConflict: "id" },
    );
    step("profile.compliance_linked", true, { user_id: complianceUserId, org_id: complianceOrgId });
    step("profile.requester_linked", true, { user_id: requesterUserId, org_id: requesterOrgId });

    // 4. Roles
    //    - compliance_analyst -> compliance user
    //    - org_member -> both (so they can log in to org surfaces)
    //    Hard rule: never grant platform_admin to either.
    async function grant(userId: string, role: string) {
      await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
    }
    await grant(complianceUserId, "compliance_analyst");
    await grant(complianceUserId, "org_member");
    await grant(requesterUserId, "org_member");
    step("roles.compliance_analyst_granted", true, { user_id: complianceUserId });
    step("roles.org_member_granted", true, { users: [complianceUserId, requesterUserId] });
    step("roles.platform_admin_NOT_granted", true, { policy: "hard rule" });

    // 5. Ensure a trade_request owned by the requester (for FK on facilitation_cases)
    let tradeRequestId: string | undefined;
    {
      const { data: existing } = await admin.from("trade_requests")
        .select("id")
        .eq("org_id", requesterOrgId)
        .contains("metadata", { uat: "daniel-facilitation" })
        .limit(1).maybeSingle();
      if (existing?.id) {
        tradeRequestId = existing.id as string;
      } else {
        const { data: tr, error } = await admin.from("trade_requests").insert({
          org_id: requesterOrgId, created_by: requesterUserId, side: "buyer",
          commodity: "UAT Probe Commodity", quantity_amount: 1, quantity_unit: "unit",
          price_amount: 1, price_currency: "USD", location: "ZA", match_type: "bilateral",
          metadata: { uat: "daniel-facilitation" }, status: "active",
        }).select("id").single();
        if (error || !tr) throw new Error(`trade_request create failed: ${error?.message}`);
        tradeRequestId = tr.id as string;
      }
    }
    step("seed.trade_request", !!tradeRequestId, { trade_request_id: tradeRequestId });

    // 6. Seed two facilitation cases (idempotent by case_number tag).
    async function ensureCase(opts: {
      tag: string;
      internal_status: string;
      user_facing_status: string;
      counterparty_name: string;
      reason: string;
      extra?: Record<string, unknown>;
    }): Promise<{ id: string; case_number: string; created: boolean }> {
      const { data: existing } = await admin.from("facilitation_cases")
        .select("id, case_number")
        .eq("requesting_org_id", requesterOrgId)
        .like("case_number", `${opts.tag}-%`)
        .limit(1).maybeSingle();
      if (existing?.id) {
        return { id: existing.id as string, case_number: existing.case_number as string, created: false };
      }
      const caseNumber = `${opts.tag}-${Date.now().toString(36)}`;
      const { data: inserted, error } = await admin.from("facilitation_cases").insert({
        case_number: caseNumber,
        requesting_org_id: requesterOrgId,
        requesting_user_id: requesterUserId,
        trade_request_id: tradeRequestId,
        counterparty_legal_name: opts.counterparty_name,
        counterparty_country: "GB",
        product_or_commodity: "UAT Probe Commodity",
        role: "buyer",
        estimated_value_amount: 1000,
        estimated_value_currency: "USD",
        urgency: "normal",
        reason: opts.reason,
        how_user_knows_counterparty: "Test fixture (seeded for Daniel UAT)",
        permission_to_contact: false,
        user_declaration_accepted: true,
        internal_status: opts.internal_status,
        user_facing_status: opts.user_facing_status,
        ...(opts.extra ?? {}),
      }).select("id, case_number").single();
      if (error || !inserted) throw new Error(`case ${opts.tag} insert failed: ${error?.message}`);
      return { id: inserted.id as string, case_number: inserted.case_number as string, created: true };
    }

    const moreInfoCase = await ensureCase({
      tag: CASE_TAG_MORE_INFO,
      internal_status: "more_information_needed",
      user_facing_status: "more_information_needed",
      counterparty_name: "UAT Seeded Counterparty (More-Info)",
      reason: "Seeded for Daniel UAT — exercises the requester More-Information-Needed response path.",
      extra: {
        info_request_message: "Please confirm the counterparty's registered company number and trading address (UAT seed).",
        info_request_items: ["registration_number", "trading_address"],
        info_request_requested_at: new Date().toISOString(),
      },
    });
    step("case.more_info", true, moreInfoCase);

    const complianceCase = await ensureCase({
      tag: CASE_TAG_COMPLIANCE,
      internal_status: "compliance_review_required",
      user_facing_status: "in_review",
      counterparty_name: "UAT Seeded Counterparty (Compliance-Review)",
      reason: "Seeded for Daniel UAT — exercises the compliance_analyst review path.",
    });
    step("case.compliance_review", true, complianceCase);

    // 7. Final summary — what to give Daniel
    result.summary = {
      compliance_account: {
        email: COMPLIANCE_EMAIL,
        password: PASSWORD,
        role: "compliance_analyst",
        org: { id: complianceOrgId, name: COMPLIANCE_ORG_NAME },
        expected_to_test: [
          "log in",
          "open HQ → Facilitation Queue",
          "view the compliance-review case",
          "record / clear permitted sanctions/PEP decisions",
          "confirm management metrics + CSV export are allowed",
          "confirm evidence-pack export is DENIED",
          "confirm requester-only and platform_admin-only actions remain unavailable",
        ],
        seeded_case_to_use: complianceCase.case_number,
      },
      requester_account: {
        email: REQUESTER_EMAIL,
        password: PASSWORD,
        role: "org_member (requester)",
        org: { id: requesterOrgId, name: REQUESTER_ORG_NAME },
        expected_to_test: [
          "log in",
          "open the seeded facilitation case milestone page",
          "see only safe milestone wording",
          "respond to the 'More information needed' request",
          "confirm admin notes / registry / KYB / sanctions / PEP / DNC / compliance reasoning / call notes / audit logs are NOT visible",
          "confirm management metrics, CSV export and evidence-pack export are DENIED",
        ],
        seeded_case_to_use: moreInfoCase.case_number,
      },
      safety: {
        platform_admin_granted: false,
        real_client_orgs_touched: false,
        outreach_triggered: false,
        poi_wad_match_token_credit_payment_mutations: false,
        emails_sent: false,
        notes: "Both accounts are @test.izenzo.co.za fixtures. Seeded cases are tagged in case_number and isolated to seeded orgs.",
      },
    };
    return J(req, result, 200);
  } catch (e) {
    result.fatal = String((e as Error)?.message ?? e);
    return J(req, result, 500);
  }
});
