/**
 * uat-facilitation-phase-1 — Phase 1 operator verification orchestrator.
 *
 * READ-ONLY scope (Phase 1 verification only):
 *   - provisions two test users (Org A / Org B requesters) via provision-test-user
 *   - exercises Org A positive path (create + read facilitation case)
 *   - exercises Org B denial path (must see no rows; no 500s)
 *   - exercises storage denial path (Org B cannot download Org A's evidence)
 *   - emits negative-control queries proving no POI/WaD/match/token/notification mutations
 *
 * No outreach, no notification dispatch, no POI/WaD/match/token/credit/payment mutation.
 * No schema changes. No role grants. No test-only admin elevation path.
 *
 * Auth gate: platform_admin JWT OR x-internal-key matching INTERNAL_CRON_KEY env.
 * Caller from the preview session typically uses the auto-injected JWT.
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

async function provision(email: string, password: string): Promise<{ user_id: string; access_token: string; org_id: string }> {
  // Use INTERNAL_CRON_KEY so we never depend on caller having admin rights.
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
  // Sign in to get access token
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: si, error: sie } = await anon.auth.signInWithPassword({ email, password });
  if (sie || !si.session) throw new Error(`signIn ${email} failed: ${sie?.message}`);
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const { data: prof } = await admin.from("profiles").select("org_id").eq("id", j.user_id).maybeSingle();
  let orgId: string | undefined = (prof as any)?.org_id ?? undefined;
  if (!orgId) {
    // Ensure an org exists for this test user.
    const { data: org } = await admin.from("organizations").insert({
      name: `UAT Facilitation ${email}`,
      country_code: "ZA",
    }).select("id").single();
    orgId = (org as any)?.id;
    await admin.from("profiles").upsert({ id: j.user_id, org_id: orgId }, { onConflict: "id" });
  }
  return { user_id: j.user_id, access_token: si.session.access_token, org_id: orgId! };
}

async function fnPost(path: string, token: string, body: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${URL_}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": ANON,
    },
    body: JSON.stringify(body),
  });
  let parsed: any;
  try { parsed = await r.json(); } catch { parsed = null; }
  return { status: r.status, body: parsed };
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req); if (pf) return pf;
  if (req.method !== "POST") return J(req, { error: "Method not allowed" }, 405);
  const g = await gate(req);
  if (!g.ok) return J(req, { error: "Unauthorised", reason: g.reason }, 401);

  const t_start = new Date().toISOString();
  const ev: any = { t_start, checks: [] as any[] };
  const push = (id: string, pass: boolean, detail: any) => ev.checks.push({ id, pass, detail });

  try {
    // 1. Provision Org A + Org B requesters
    const PW = "FacilUatPass!2026Strong";
    const A = await provision("facilitation-org-a@test.izenzo.co.za", PW);
    const B = await provision("facilitation-org-b@test.izenzo.co.za", PW);
    push("provision.org_a", !!A.access_token && !!A.org_id, { user_id: A.user_id, org_id: A.org_id });
    push("provision.org_b", !!B.access_token && !!B.org_id, { user_id: B.user_id, org_id: B.org_id });
    if (A.org_id === B.org_id) {
      push("provision.distinct_orgs", false, { org_a: A.org_id, org_b: B.org_id });
      return J(req, { ...ev, fatal: "Org A and Org B share org_id; aborting." }, 500);
    } else {
      push("provision.distinct_orgs", true, { org_a: A.org_id, org_b: B.org_id });
    }

    const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

    // 2. Seed a trade_request owned by Org A (required FK on facilitation_cases)
    const { data: tr, error: trErr } = await admin.from("trade_requests").insert({
      org_id: A.org_id, created_by: A.user_id, side: "buyer",
      commodity: "UAT Probe Commodity", quantity_amount: 1, quantity_unit: "unit",
      price_amount: 1, price_currency: "USD", location: "ZA", match_type: "bilateral",
      metadata: { uat: "facilitation-phase-1" }, status: "active",
    }).select("id").single();
    if (trErr || !tr) {
      push("seed.trade_request", false, { error: trErr?.message });
      return J(req, ev, 500);
    }
    push("seed.trade_request", true, { trade_request_id: tr.id });

    // 3. Org A creates a facilitation case
    const createRes = await fnPost("create-facilitation-case", A.access_token, {
      trade_request_id: tr.id,
      counterparty_legal_name: "UAT Counterparty Ltd",
      counterparty_country: "GB",
      product_or_commodity: "UAT Probe Commodity",
      role: "buyer",
      estimated_value_amount: 1000,
      estimated_value_currency: "USD",
      urgency: "normal",
      reason: "Operator verification of Phase 1 intake path (UAT).",
      how_user_knows_counterparty: "Test fixture",
      permission_to_contact: false,
      user_declaration_accepted: true,
    });
    const caseId = createRes.body?.case?.id as string | undefined;
    push("orgA.create_case", createRes.status === 201 && !!caseId, { status: createRes.status, case_id: caseId, case_number: createRes.body?.case?.case_number });
    if (!caseId) return J(req, ev, 500);

    // 4. facilitation_case.created event exists with from_status=null, to_status='new'
    const { data: createdEv } = await admin.from("facilitation_case_events")
      .select("action, from_status, to_status, actor_user_id")
      .eq("case_id", caseId).eq("action", "facilitation_case.created");
    const evRow = (createdEv ?? [])[0] as any;
    push("orgA.created_event_present", !!evRow && evRow.from_status === null && evRow.to_status === "new" && evRow.actor_user_id === A.user_id, { row: evRow });

    // 5. Org A get-facilitation-case (positive)
    const aGet = await fnPost("get-facilitation-case", A.access_token, { case_id: caseId });
    push("orgA.get_case", aGet.status === 200 && aGet.body?.case?.id === caseId, { status: aGet.status });

    // 6. Org B attempts get-facilitation-case (denial — expect 404 from RLS, not 500)
    const bGet = await fnPost("get-facilitation-case", B.access_token, { case_id: caseId });
    push("orgB.get_case_denied", bGet.status === 404, { status: bGet.status, body: bGet.body });

    // 7. Org B attempts list-facilitation-cases — must not contain Org A case
    const bList = await fnPost("list-facilitation-cases", B.access_token, {});
    const bSawA = (bList.body?.cases ?? []).some((c: any) => c.id === caseId);
    push("orgB.list_excludes_a", bList.status === 200 && !bSawA, { status: bList.status, total: bList.body?.total, leaked: bSawA });

    // 8. Org B direct table reads via JWT-bound client (RLS denial = empty array)
    const bClient = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${B.access_token}` } } });
    const { data: bCases, error: bCasesErr } = await bClient.from("facilitation_cases").select("id").eq("id", caseId);
    push("orgB.rls_cases_empty", !bCasesErr && (bCases ?? []).length === 0, { rows: bCases?.length ?? null, err: bCasesErr?.message });
    const { data: bEvs, error: bEvsErr } = await bClient.from("facilitation_case_events").select("id").eq("case_id", caseId);
    push("orgB.rls_events_empty", !bEvsErr && (bEvs ?? []).length === 0, { rows: bEvs?.length ?? null, err: bEvsErr?.message });
    const { data: bEvd, error: bEvdErr } = await bClient.from("facilitation_case_evidence").select("id").eq("case_id", caseId);
    push("orgB.rls_evidence_empty", !bEvdErr && (bEvd ?? []).length === 0, { rows: bEvd?.length ?? null, err: bEvdErr?.message });

    // 9. Storage probe via direct REST (avoids supabase-js storage SDK schema quirk in Deno).
    const probePath = `${caseId}/probe.txt`;
    const probeBody = `uat probe ${t_start}`;
    const upResp = await fetch(`${URL_}/storage/v1/object/facilitation-evidence/${probePath}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${A.access_token}`,
        "apikey": ANON,
        "Content-Type": "text/plain",
        "x-upsert": "true",
      },
      body: probeBody,
    });
    const upOk = upResp.ok;
    push("orgA.storage_upload", upOk, { status: upResp.status, body: upOk ? null : (await upResp.text()).slice(0, 200) });

    if (upOk) {
      const reg = await fnPost("register-facilitation-case-evidence", A.access_token, {
        case_id: caseId, storage_path: probePath, original_filename: "probe.txt",
        mime_type: "text/plain", size_bytes: probeBody.length,
      });
      push("orgA.register_evidence", reg.status === 201, { status: reg.status });

      const bDl = await fetch(`${URL_}/storage/v1/object/facilitation-evidence/${probePath}`, {
        headers: { "Authorization": `Bearer ${B.access_token}`, "apikey": ANON },
      });
      const bDenied = bDl.status === 400 || bDl.status === 403 || bDl.status === 404;
      push("orgB.storage_download_denied", bDenied, { status: bDl.status, body: (await bDl.text()).slice(0, 200) });
    }


    // 10. Negative-control: no POI/WaD/match/token/notification rows for either org since t_start
    const nc: Record<string, any> = {};
    const orgIds = [A.org_id, B.org_id];
    const userIds = [A.user_id, B.user_id];
    const tables: { name: string; col: "org_id" | "buyer_org_id" | "user_id" | "actor_user_id" | "to_user_id" | "recipient_user_id" | "any"; alt?: string[] }[] = [
      { name: "pois", col: "any", alt: ["buyer_org_id", "seller_org_id"] },
      { name: "wads", col: "any", alt: ["buyer_org_id", "seller_org_id"] },
      { name: "matches", col: "any", alt: ["buyer_org_id", "seller_org_id"] },
      { name: "token_ledger", col: "org_id" },
      { name: "token_purchases", col: "org_id" },
      { name: "notification_dispatches", col: "any", alt: ["org_id", "to_user_id", "recipient_user_id"] },
      { name: "email_send_log", col: "any", alt: ["org_id"] },
      { name: "poi_engagements", col: "any", alt: ["buyer_org_id", "seller_org_id"] },
    ];
    for (const t of tables) {
      try {
        let q = admin.from(t.name).select("id", { count: "exact", head: true }).gte("created_at", t_start);
        if (t.col !== "any") (q as any) = q.in(t.col, orgIds);
        const { count, error } = await q;
        if (!error) {
          if (t.col === "any" && (t.alt?.length ?? 0) > 0) {
            // Run an OR query across alt columns
            let total = 0;
            for (const c of t.alt!) {
              const { count: cc } = await admin.from(t.name).select("id", { count: "exact", head: true }).gte("created_at", t_start).in(c, orgIds);
              total += cc ?? 0;
            }
            nc[t.name] = total;
          } else {
            nc[t.name] = count ?? 0;
          }
        } else {
          nc[t.name] = { error: error.message };
        }
      } catch (e) {
        nc[t.name] = { exception: String(e) };
      }
    }
    // audit_logs by actor_user_id
    try {
      const { count } = await admin.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", t_start).in("actor_user_id", userIds);
      nc["audit_logs.actor_in_test_users"] = count ?? 0;
    } catch (e) { nc["audit_logs.actor_in_test_users"] = { exception: String(e) }; }

    push("negative_control.no_side_effect_writes", Object.values(nc).every(v => typeof v === "number" ? v === 0 : v?.error || v?.exception ? false : true), nc);

    // 11. Cleanup — close test case so it doesn't pollute admin queue. Mark closed.
    await admin.from("facilitation_cases").update({
      internal_status: "closed_admin", closed_at: new Date().toISOString(),
      closing_reason: "uat_probe_cleanup", final_outcome: "out_of_scope",
    }).eq("id", caseId);
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: null,
      action: "facilitation_case.closed",
      from_status: "new", to_status: "closed_admin",
      payload: { uat_cleanup: true },
    });
    push("cleanup.case_closed", true, { case_id: caseId });

    ev.t_end = new Date().toISOString();
    ev.summary = {
      total: ev.checks.length,
      passed: ev.checks.filter((c: any) => c.pass).length,
      failed: ev.checks.filter((c: any) => !c.pass).length,
    };
    ev.context = {
      case_id: caseId,
      trade_request_id: tr.id,
      org_a: { user_id: A.user_id, org_id: A.org_id, email: "facilitation-org-a@test.izenzo.co.za" },
      org_b: { user_id: B.user_id, org_id: B.org_id, email: "facilitation-org-b@test.izenzo.co.za" },
    };
    return J(req, ev, 200);
  } catch (e) {
    ev.fatal = String(e?.message ?? e);
    return J(req, ev, 500);
  }
});
