/**
 * Batch F — by-match response hardening live-proof harness.
 *
 * Exercises the REAL deployed
 *   GET /functions/v1/poi-engagements/by-match/:matchId
 * with a Pending Engagement that has every sensitive / internal field
 * deliberately populated server-side, and asserts that none of those
 * fields appear in the JSON returned to the initiator caller.
 *
 *   T1 — by-match returns 200 and includes the test engagement.
 *   T2 — none of the FORBIDDEN_FIELDS appear in the response payload.
 *   T3 — the canary literals stamped into binding_candidates,
 *        dispute_reason, support_notes, and admin_notes do not appear
 *        anywhere in the serialised JSON (defence in depth in case a
 *        future read-model rename smuggles values through under a
 *        different key).
 *   T4 — every required initiator-facing field IS present (presence
 *        check on the BY_MATCH_RESPONSE_ALLOWLIST surface).
 *   T5 — cleanup removes all disposable test data (LIFO, best-effort).
 *
 * Auth: INTERNAL_CRON_KEY OR service_role Bearer OR platform_admin JWT.
 * Body: { "confirm": "RUN_BATCH_F_BY_MATCH_LIVE_PROOF" }
 *
 * Out of scope: D4b/D4c dispatchers, Batch C, ratings, MT-009, payments,
 * sanctions/KYB/UBO, public status, RLS, unrelated UI/routes.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type TestRecord = {
  id: string;
  description: string;
  expected: string;
  observed: string;
  pass: boolean;
  details?: unknown;
};

const FORBIDDEN_FIELDS = [
  "binding_candidates",
  "dispute_reason",
  "dispute_source",
  "disputed_by_token_hash",
  "disputed_at",
  "dispute_metadata",
  "admin_notes",
  "support_notes",
  "support_notes_updated_at",
  "support_notes_updated_by",
  "sla_reminder_sent_at",
  "sla_reminder_count",
  "operational_state_set_at",
  "operational_state_set_by",
];

const REQUIRED_FIELDS = [
  "id",
  "match_id",
  "engagement_status",
  "counterparty_type",
  "operational_state",
  "binding_resolution",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: baseHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: baseHeaders,
    });
  }
  if (!SERVICE_ROLE || !SUPABASE_URL || !ANON_KEY) {
    return new Response(JSON.stringify({
      error: "MISSING_ENV",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !SERVICE_ROLE,
        SUPABASE_ANON_KEY: !ANON_KEY,
      },
    }), { status: 500, headers: baseHeaders });
  }

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Auth: INTERNAL_CRON_KEY, service_role bearer, or platform_admin JWT
  const internalKey = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const presented = req.headers.get("x-internal-key") ?? "";
  let authorized = false;
  if (internalKey && presented && presented === internalKey) {
    authorized = true;
  } else {
    const authz = req.headers.get("authorization");
    if (authz?.startsWith("Bearer ")) {
      const tok = authz.slice(7).trim();
      if (tok === SERVICE_ROLE) {
        authorized = true;
      } else {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authz } },
        });
        const { data: u } = await userClient.auth.getUser();
        if (u?.user) {
          const { data: isAdminCaller } = await admin.rpc("is_admin", { user_id: u.user.id });
          if (isAdminCaller) authorized = true;
        }
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({
      error: "FORBIDDEN",
      message: "platform_admin, INTERNAL_CRON_KEY, or service_role required",
    }), { status: 403, headers: baseHeaders });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* ignore */ }
  if (payload?.confirm !== "RUN_BATCH_F_BY_MATCH_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_BATCH_F_BY_MATCH_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `bf1-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  let setupError: string | null = null;

  // Canary strings stamped into sensitive columns. If any of these
  // strings appears in the by-match response JSON, the field has
  // leaked even if it travels under a renamed key.
  const BINDING_CANARY = `BF1_BINDING_CANARY_${tag}`;
  const DISPUTE_CANARY = `BF1_DISPUTE_REASON_CANARY_${tag}`;
  const ADMIN_NOTES_CANARY = `BF1_ADMIN_NOTES_CANARY_${tag}`;
  const SUPPORT_NOTES_CANARY = `BF1_SUPPORT_NOTES_CANARY_${tag}`;
  const TOKEN_HASH_CANARY = `bf1tokenhash${tag}`;

  try {
    // Initiating org + counterparty org
    const { data: orgI, error: orgIErr } = await admin
      .from("organizations").insert({ name: `${tag}_org_initiator` })
      .select("id").single();
    if (orgIErr || !orgI) throw new Error(`org init: ${orgIErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgI.id));

    const { data: orgC, error: orgCErr } = await admin
      .from("organizations").insert({ name: `${tag}_org_counterparty` })
      .select("id").single();
    if (orgCErr || !orgC) throw new Error(`org cp: ${orgCErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgC.id));

    // Synthetic platform admin caller
    const platAdminEmail = `${tag}-platadmin@bf1.example.com`;
    const platAdminPwd = `${tag}-AdmPw!aA9`;
    const { data: platAdmin, error: platAdminErr } = await admin.auth.admin
      .createUser({ email: platAdminEmail, password: platAdminPwd, email_confirm: true });
    if (platAdminErr || !platAdmin.user) throw new Error(`plat admin: ${platAdminErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(platAdmin.user!.id));
    {
      const { error: pErr } = await admin.from("profiles").upsert({
        id: platAdmin.user.id, email: platAdminEmail, org_id: orgI.id, status: "active",
      }, { onConflict: "id" });
      if (pErr) throw new Error(`plat admin profile: ${pErr.message}`);
    }
    {
      const { error: rErr } = await admin.from("user_roles")
        .upsert({ user_id: platAdmin.user.id, role: "platform_admin" },
                { onConflict: "user_id,role" });
      if (rErr) throw new Error(`plat admin role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", platAdmin.user!.id).eq("role", "platform_admin"));
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: sess, error: sessErr } = await userClient.auth
      .signInWithPassword({ email: platAdminEmail, password: platAdminPwd });
    if (sessErr || !sess.session) throw new Error(`plat admin signin: ${sessErr?.message}`);
    const adminJwt = sess.session.access_token;

    // Match
    const { data: match, error: matchErr } = await admin.from("matches").insert({
      buyer_org_id: orgI.id, seller_org_id: orgC.id, org_id: orgI.id,
      buyer_id: `${tag}_buyer`, seller_id: `${tag}_seller`,
      buyer_name: `${tag} buyer`, seller_name: `${tag} seller`,
      commodity: "BF1_NEUTRAL", quantity_amount: 1, quantity_unit: "MT",
      price_amount: 1, price_currency: "USD",
      terms: "TEST", state: "discovery", status: "matched",
      poi_state: "ELIGIBLE",
      hash: `bf1_${runId}`,
    }).select("id").single();
    if (matchErr || !match) throw new Error(`match: ${matchErr?.message}`);
    cleanup.push(() => admin.from("matches").delete().eq("id", match.id));

    // Engagement seeded with sensitive fields populated. The dispute
    // CHECK constraint requires (disputed_at, disputed_by_token_hash,
    // dispute_reason) to all be set or all null — set all three.
    const { data: eng, error: engErr } = await admin.from("poi_engagements").insert({
      match_id: match.id, org_id: orgI.id,
      counterparty_type: "known",
      counterparty_email: `cp-${tag}@bf1.example.com`,
      counterparty_org_id: orgC.id,
      contact_name: `${tag}_cp`,
      contact_type: "named_individual",
      engagement_status: "pending",
      source: "admin_manual",
      // Sensitive payload — must all be stripped from the response.
      binding_candidates: [
        { org_id: orgC.id, label: BINDING_CANARY, score: 0.9 },
      ],
      dispute_reason: DISPUTE_CANARY,
      dispute_source: "admin_report",
      disputed_at: new Date().toISOString(),
      disputed_by_token_hash: TOKEN_HASH_CANARY,
      admin_notes: ADMIN_NOTES_CANARY,
      support_notes: SUPPORT_NOTES_CANARY,
    }).select("id").single();
    if (engErr || !eng) throw new Error(`eng: ${engErr?.message}`);
    cleanup.push(() => admin.from("poi_engagements").delete().eq("id", eng.id));
    cleanup.push(() => admin.from("audit_logs").delete().eq("entity_id", eng.id));

    // Call the real route.
    const url = `${SUPABASE_URL}/functions/v1/poi-engagements/by-match/${match.id}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
    });
    const rawText = await res.text();
    let bodyJson: any;
    try { bodyJson = JSON.parse(rawText); } catch { bodyJson = null; }

    // T1 — 200 + engagement present
    {
      const allEngs = [
        ...(bodyJson?.current_engagement ? [bodyJson.current_engagement] : []),
        ...(Array.isArray(bodyJson?.engagements) ? bodyJson.engagements : []),
        ...(bodyJson?.engagement ? [bodyJson.engagement] : []),
      ];
      const found = allEngs.some((e: any) => e?.id === eng.id);
      tests.push({
        id: "T1",
        description: "GET /poi-engagements/by-match/:matchId returns 200 with the test engagement",
        expected: "200 + engagement id present in current_engagement / engagements / engagement",
        observed: `status=${res.status} found=${found}`,
        pass: res.status === 200 && found,
        details: { status: res.status, hasEngagement: found },
      });
    }

    // T2 — no forbidden fields anywhere in the response (deep scan)
    {
      const seenForbidden: string[] = [];
      function walk(node: any) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        for (const k of Object.keys(node)) {
          if (FORBIDDEN_FIELDS.includes(k)) seenForbidden.push(k);
          walk(node[k]);
        }
      }
      walk(bodyJson);
      tests.push({
        id: "T2",
        description: "Response contains NONE of the forbidden internal fields",
        expected: `no key in ${FORBIDDEN_FIELDS.join(",")} anywhere in payload`,
        observed: seenForbidden.length === 0
          ? "clean"
          : `leaked keys: ${[...new Set(seenForbidden)].join(", ")}`,
        pass: seenForbidden.length === 0,
        details: { leakedKeys: [...new Set(seenForbidden)] },
      });
    }

    // T3 — canary literals are absent (defence against renamed-field smuggling)
    {
      const canaries = [
        BINDING_CANARY,
        DISPUTE_CANARY,
        ADMIN_NOTES_CANARY,
        SUPPORT_NOTES_CANARY,
        TOKEN_HASH_CANARY,
      ];
      const leaked = canaries.filter((c) => rawText.includes(c));
      tests.push({
        id: "T3",
        description: "Canary literals from sensitive columns do not appear in response",
        expected: "no canary string in raw response body",
        observed: leaked.length === 0 ? "clean" : `leaked: ${leaked.join(", ")}`,
        pass: leaked.length === 0,
        details: { leaked },
      });
    }

    // T4 — required initiator fields present on the row
    {
      const allEngs = [
        ...(bodyJson?.current_engagement ? [bodyJson.current_engagement] : []),
        ...(Array.isArray(bodyJson?.engagements) ? bodyJson.engagements : []),
        ...(bodyJson?.engagement ? [bodyJson.engagement] : []),
      ];
      const target = allEngs.find((e: any) => e?.id === eng.id);
      const missing = target
        ? REQUIRED_FIELDS.filter((f) => !(f in target))
        : REQUIRED_FIELDS;
      tests.push({
        id: "T4",
        description: "Required allowlisted fields are present on the engagement row",
        expected: `all of ${REQUIRED_FIELDS.join(",")} present`,
        observed: missing.length === 0
          ? "all present"
          : `missing: ${missing.join(", ")}`,
        pass: missing.length === 0,
        details: { missing },
      });
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // T5 — cleanup
  let cleanupOk = true;
  const cleanupErrors: string[] = [];
  for (const fn of [...cleanup].reverse()) {
    try { await fn(); } catch (e) {
      cleanupOk = false;
      cleanupErrors.push(e instanceof Error ? e.message : String(e));
    }
  }
  tests.push({
    id: "T5",
    description: "Cleanup removes all disposable test data",
    expected: "all teardown callbacks succeed",
    observed: cleanupOk ? "ok" : `${cleanupErrors.length} errors`,
    pass: cleanupOk,
    details: { errors: cleanupErrors.slice(0, 5) },
  });

  const allPass = !setupError && tests.every((t) => t.pass);
  return new Response(JSON.stringify({
    ok: allPass,
    runId,
    tag,
    setupError,
    tests,
  }, null, 2), {
    status: allPass ? 200 : 500,
    headers: baseHeaders,
  });
});
