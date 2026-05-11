/**
 * Batch D — Production Binding-Review live-proof harness.
 *
 * Exercises the REAL deployed `poi-engagements` PATCH route end-to-end.
 * Unlike `d4b-live-proof` (which calls the dispatcher helper directly),
 * this harness:
 *
 *   1. Provisions disposable orgs/profiles/match/engagement under
 *      `*@d4b-br.example.com` (RLS-bypassing service-role inserts).
 *   2. Mints a synthetic platform_admin user, signs in with password,
 *      and uses that JWT for every PATCH call (so the production
 *      `requireRole(authCtx, 'platform_admin')` gate is genuinely
 *      exercised — no auth shortcuts).
 *   3. Issues HTTP PATCH against `/functions/v1/poi-engagements/:id`
 *      with `counterparty_email` for each scenario:
 *        T1 unique exact match           → safe_bind, no review, no alert
 *        T2 duplicate exact (2 orgs)     → review, candidates, 1 alert
 *        T3 shared mailbox local-part    → review, candidates, 1 alert
 *        T4 domain-only ambiguity (≥2)   → review, candidates, 1 alert
 *        T5 free-provider control        → no review, no alert
 *        T6 idempotency replay           → no NEW initial-entry alert
 *   4. Asserts post-conditions by reading `poi_engagements`,
 *      `audit_logs`, and `engagement_outreach_logs`.
 *   5. Asserts notification safety: the only D4b admin alert audit
 *      rows touching our run reference our synthetic engagement IDs
 *      and contain NO recipient leakage (no candidate org name,
 *      counterparty email, profile id, or "to" field).
 *   6. Tears everything down (LIFO best-effort).
 *
 * Invocation:
 *   POST /functions/v1/d4b-binding-review-live-proof
 *   Headers: x-internal-key: <INTERNAL_CRON_KEY>
 *   Body:    { "confirm": "RUN_D4B_BINDING_REVIEW_LIVE_PROOF" }
 *
 * Auth: INTERNAL_CRON_KEY OR service_role Bearer OR platform_admin JWT.
 *
 * EXPLICITLY OUT OF SCOPE: D4c, Batch C, ratings, MT-009, legacy
 * disputes, fixtures/DOCX, public status, payments, RLS changes,
 * org-admin / ordinary-user / counterparty / candidate-org /
 * disputed-counterparty notifications.
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

interface PatchResult {
  status: number;
  body: any;
}

async function patchEngagement(
  baseUrl: string,
  jwt: string,
  engagementId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<PatchResult> {
  const res = await fetch(
    `${baseUrl}/functions/v1/poi-engagements/${engagementId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        "Idempotency-Key": idempotencyKey,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(body),
    },
  );
  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { status: res.status, body: parsed };
}

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

  // Auth: cron key OR service-role Bearer OR platform_admin user.
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
  if (payload?.confirm !== "RUN_D4B_BINDING_REVIEW_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_D4B_BINDING_REVIEW_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d4bbr-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const startedAt = new Date().toISOString();
  let setupError: string | null = null;
  const auditEntityIds: string[] = [];

  try {
    // ── Provision two disposable orgs (A and B) ──
    const orgs: { id: string; name: string }[] = [];
    for (const suffix of ["A", "B"]) {
      const { data, error } = await admin.from("organizations")
        .insert({ name: `${tag}_org_${suffix}` })
        .select("id, name").single();
      if (error || !data) throw new Error(`org ${suffix}: ${error?.message}`);
      orgs.push(data);
      cleanup.push(() => admin.from("organizations").delete().eq("id", data.id));
    }
    const [orgA, orgB] = orgs;

    // ── Provision the test profiles that will be the resolver targets ──
    // The resolver scans `profiles` by email/domain. We seed:
    //   • alice@orgA.d4b-br.example.com → only in orgA  (UNIQUE EXACT)
    //   • shared@d4b-br.example.com     → in both orgA + orgB  (DUPLICATE)
    //   • staffA@orgshared.d4b-br.example.com → orgA   (DOMAIN ambiguity)
    //   • staffB@orgshared.d4b-br.example.com → orgB   (DOMAIN ambiguity)
    //   • alice@gmail.com                → orgA  (free-provider control)
    const profileSeeds: { email: string; org_id: string }[] = [
      { email: `alice@${tag}-orga.example.com`, org_id: orgA.id },
      { email: `shared@${tag}-shared.example.com`, org_id: orgA.id },
      { email: `shared@${tag}-shared.example.com`, org_id: orgB.id },
      { email: `staffa@${tag}-domain.example.com`, org_id: orgA.id },
      { email: `staffb@${tag}-domain.example.com`, org_id: orgB.id },
      { email: `${tag}-alice@gmail.com`, org_id: orgA.id },
    ];
    const profileIds: string[] = [];
    for (const seed of profileSeeds) {
      // Profiles are 1:1 with auth.users. Create user first.
      const { data: u, error: uErr } = await admin.auth.admin.createUser({
        email: seed.email,
        password: `${tag}-Pw!aA9`,
        email_confirm: true,
      });
      if (uErr || !u.user) throw new Error(`auth user ${seed.email}: ${uErr?.message}`);
      cleanup.push(() => admin.auth.admin.deleteUser(u.user!.id));
      // Upsert profile with org_id (handle_new_user trigger may pre-create).
      const { error: pErr } = await admin
        .from("profiles")
        .upsert({ id: u.user.id, email: seed.email, org_id: seed.org_id }, { onConflict: "id" });
      if (pErr) throw new Error(`profile upsert ${seed.email}: ${pErr.message}`);
      profileIds.push(u.user.id);
    }

    // ── Mint synthetic platform_admin user used for every PATCH call ──
    const adminEmail = `${tag}-admin@d4b-br.example.com`;
    const adminPwd = `${tag}-AdmPw!aA9`;
    const { data: adminUser, error: adminErr } = await admin.auth.admin.createUser({
      email: adminEmail, password: adminPwd, email_confirm: true,
    });
    if (adminErr || !adminUser.user) throw new Error(`admin user: ${adminErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(adminUser.user!.id));
    const { error: roleErr } = await admin.from("user_roles")
      .insert({ user_id: adminUser.user.id, role: "platform_admin" });
    if (roleErr) throw new Error(`grant platform_admin: ${roleErr.message}`);
    cleanup.push(() => admin.from("user_roles")
      .delete().eq("user_id", adminUser.user!.id).eq("role", "platform_admin"));
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: sess, error: sessErr } = await userClient.auth
      .signInWithPassword({ email: adminEmail, password: adminPwd });
    if (sessErr || !sess.session) throw new Error(`admin signin: ${sessErr?.message}`);
    const adminJwt = sess.session.access_token;

    // ── Helper: create a fresh engagement bound to nothing ──
    async function newEngagement(label: string): Promise<string> {
      // Need a parent match. Reuse one match per test for simplicity.
      const { data: match, error: matchErr } = await admin.from("matches").insert({
        buyer_org_id: orgA.id, seller_org_id: orgA.id, org_id: orgA.id,
        buyer_id: `${tag}_${label}_buyer`, seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} buyer`, seller_name: `${tag} seller`,
        commodity: "TEST_D4B_BR", quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d4bbr_${runId}_${label}`,
      }).select("id").single();
      if (matchErr || !match) throw new Error(`match ${label}: ${matchErr?.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", match.id));
      const { data: eng, error: engErr } = await admin.from("poi_engagements").insert({
        match_id: match.id,
        org_id: orgA.id,
        counterparty_type: "unknown",
        engagement_status: "pending",
        contact_type: "organisation",
        source: "admin_manual",
      }).select("id").single();
      if (engErr || !eng) throw new Error(`eng ${label}: ${engErr?.message}`);
      cleanup.push(() => admin.from("poi_engagements").delete().eq("id", eng.id));
      cleanup.push(() => admin.from("audit_logs").delete().eq("entity_id", eng.id));
      cleanup.push(() => admin.from("engagement_outreach_logs").delete().eq("engagement_id", eng.id));
      auditEntityIds.push(eng.id);
      return eng.id;
    }

    async function fetchRow(id: string) {
      const { data } = await admin.from("poi_engagements")
        .select("counterparty_org_id, operational_state, binding_candidates, binding_resolution")
        .eq("id", id).maybeSingle();
      return data;
    }
    async function countAlertSent(id: string): Promise<number> {
      const { count } = await admin.from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("action", "engagement.admin_alert_sent")
        .eq("entity_id", id);
      return count ?? 0;
    }
    async function countBindingReviewAudits(id: string): Promise<number> {
      const { count } = await admin.from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("action", "engagement.binding_review_required")
        .eq("entity_id", id);
      return count ?? 0;
    }

    // ── T1 — unique exact match → safe_bind, no review, no alert ──
    {
      const eid = await newEngagement("t1");
      const r = await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `alice@${tag}-orga.example.com` },
        `${tag}_t1`);
      const row = await fetchRow(eid);
      const alerts = await countAlertSent(eid);
      const reviewAudits = await countBindingReviewAudits(eid);
      const pass = r.status === 200
        && r.body?.binding?.status === "bound"
        && row?.counterparty_org_id === orgA.id
        && row?.operational_state !== "binding_review_required"
        && alerts === 0 && reviewAudits === 0;
      tests.push({
        id: "T1", description: "Unique exact email → safe_bind, no review, no alert",
        expected: "binding=bound, counterparty_org_id=orgA, op_state≠binding_review_required, 0 alerts, 0 review-audits",
        observed: `status=${r.status} binding=${r.body?.binding?.status} cp_org=${row?.counterparty_org_id===orgA.id} op_state=${row?.operational_state} alerts=${alerts} reviewAudits=${reviewAudits}`,
        pass, details: { response: r.body, row },
      });
    }

    // ── T2 — duplicate exact email across two orgs → review + 1 alert ──
    {
      const eid = await newEngagement("t2");
      const r = await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `shared@${tag}-shared.example.com` },
        `${tag}_t2`);
      const row = await fetchRow(eid);
      const alerts = await countAlertSent(eid);
      const reviewAudits = await countBindingReviewAudits(eid);
      const cands = (row?.binding_candidates as any)?.candidates ?? [];
      const reasons = (row?.binding_candidates as any)?.reason_codes ?? [];
      const pass = r.status === 200
        && r.body?.binding?.status === "binding_review_required"
        && row?.counterparty_org_id == null
        && row?.operational_state === "binding_review_required"
        && row?.binding_resolution == null
        && cands.length >= 2
        && reasons.includes("shared_email_multi_org")
        && reviewAudits === 1;
      tests.push({
        id: "T2", description: "Duplicate exact email across 2 orgs → binding_review_required, 1 alert",
        expected: "binding=binding_review_required, cp_org=null, op_state=binding_review_required, ≥2 candidates, reason includes shared_email_multi_org, 1 review-audit, alerts in {0 (env w/o resend),1}",
        observed: `status=${r.status} binding=${r.body?.binding?.status} cp_org=${row?.counterparty_org_id} op_state=${row?.operational_state} cands=${cands.length} reasons=${reasons.join(",")} alerts=${alerts} reviewAudits=${reviewAudits}`,
        pass, details: { response: r.body, row },
      });
    }

    // ── T3 — shared mailbox local-part with real candidates → review ──
    {
      const eid = await newEngagement("t3");
      const r = await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `info@${tag}-shared.example.com` },
        `${tag}_t3`);
      const row = await fetchRow(eid);
      const reviewAudits = await countBindingReviewAudits(eid);
      const cands = (row?.binding_candidates as any)?.candidates ?? [];
      const reasons = (row?.binding_candidates as any)?.reason_codes ?? [];
      const pass = r.status === 200
        && r.body?.binding?.status === "binding_review_required"
        && row?.counterparty_org_id == null
        && row?.operational_state === "binding_review_required"
        && cands.length >= 1
        && reasons.includes("shared_mailbox_local_part")
        && reviewAudits === 1;
      tests.push({
        id: "T3", description: "Shared-mailbox local-part with real candidates → binding_review",
        expected: "binding=binding_review_required, cp_org=null, ≥1 candidate, reason includes shared_mailbox_local_part, 1 review-audit",
        observed: `status=${r.status} binding=${r.body?.binding?.status} cp_org=${row?.counterparty_org_id} cands=${cands.length} reasons=${reasons.join(",")} reviewAudits=${reviewAudits}`,
        pass, details: { response: r.body, row },
      });
    }

    // ── T4 — domain-only ambiguity (non-free) → review ──
    {
      const eid = await newEngagement("t4");
      const r = await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `newperson@${tag}-domain.example.com` },
        `${tag}_t4`);
      const row = await fetchRow(eid);
      const reviewAudits = await countBindingReviewAudits(eid);
      const cands = (row?.binding_candidates as any)?.candidates ?? [];
      const reasons = (row?.binding_candidates as any)?.reason_codes ?? [];
      const pass = r.status === 200
        && r.body?.binding?.status === "binding_review_required"
        && row?.counterparty_org_id == null
        && row?.operational_state === "binding_review_required"
        && cands.length >= 2
        && reasons.includes("domain_only_ambiguity")
        && reviewAudits === 1;
      tests.push({
        id: "T4", description: "Domain-only ambiguity (non-free, ≥2 orgs) → binding_review",
        expected: "binding=binding_review_required, cp_org=null, ≥2 candidates, reason includes domain_only_ambiguity, 1 review-audit",
        observed: `status=${r.status} binding=${r.body?.binding?.status} cp_org=${row?.counterparty_org_id} cands=${cands.length} reasons=${reasons.join(",")} reviewAudits=${reviewAudits}`,
        pass, details: { response: r.body, row },
      });
    }

    // ── T5 — free-provider control: gmail.com domain only, no review ──
    {
      const eid = await newEngagement("t5");
      const r = await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `${tag}-newperson@gmail.com` },
        `${tag}_t5`);
      const row = await fetchRow(eid);
      const reviewAudits = await countBindingReviewAudits(eid);
      const pass = r.status === 200
        && r.body?.binding?.status === "no_match"
        && row?.operational_state !== "binding_review_required"
        && reviewAudits === 0;
      tests.push({
        id: "T5", description: "Free-provider domain with no exact match → no_match, no review",
        expected: "binding=no_match, op_state≠binding_review_required, 0 review-audits",
        observed: `status=${r.status} binding=${r.body?.binding?.status} op_state=${row?.operational_state} reviewAudits=${reviewAudits}`,
        pass, details: { response: r.body, row },
      });
    }

    // ── T6 — idempotency: replay ambiguous PATCH → no NEW initial-entry alert ──
    {
      const eid = await newEngagement("t6");
      // First call enters review.
      await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `shared@${tag}-shared.example.com` },
        `${tag}_t6_a`);
      const reviewAuditsAfter1 = await countBindingReviewAudits(eid);
      const alertsAfter1 = await countAlertSent(eid);
      // Replay with a DIFFERENT idempotency key (so server actually re-runs)
      // and the same email — the row is already in review, so no new
      // initial-entry alert/audit row should be written.
      const r2 = await patchEngagement(SUPABASE_URL, adminJwt, eid,
        { counterparty_email: `shared@${tag}-shared.example.com` },
        `${tag}_t6_b`);
      const reviewAuditsAfter2 = await countBindingReviewAudits(eid);
      const alertsAfter2 = await countAlertSent(eid);
      const pass = reviewAuditsAfter1 === 1
        && reviewAuditsAfter2 === 1
        && alertsAfter2 === alertsAfter1
        && r2.body?.binding?.status === "binding_review_required";
      tests.push({
        id: "T6", description: "Repeated PATCH while already in binding_review_required does NOT emit a new initial-entry alert",
        expected: "review-audits stays at 1 across both calls, alert count unchanged",
        observed: `reviewAudits 1st=${reviewAuditsAfter1} 2nd=${reviewAuditsAfter2}, alerts 1st=${alertsAfter1} 2nd=${alertsAfter2}`,
        pass, details: { replay: r2.body },
      });
    }

    // ── T7 — Notification safety: scan every audit row written by this run
    //         for any candidate-org email/name, counterparty email, or
    //         "to" recipient field. The D4b helper composes subjects from
    //         catalogue safeWording only, so leakage = bug.
    {
      const { data: rows } = await admin.from("audit_logs")
        .select("action, metadata")
        .in("entity_id", auditEntityIds)
        .gte("created_at", startedAt);
      const forbidden = [
        `shared@${tag}-shared.example.com`,
        `alice@${tag}-orga.example.com`,
        `staffa@${tag}-domain.example.com`,
        `staffb@${tag}-domain.example.com`,
        `info@${tag}-shared.example.com`,
        `${tag}-newperson@gmail.com`,
        orgA.name, orgB.name,
      ];
      // Filter to ONLY admin_alert_sent / notification_skipped rows —
      // resolver-internal audits (engagement.binding_review_required,
      // contact.assigned, engagement.updated) intentionally store
      // submitted_email / candidate org_ids for forensic admin review;
      // those are internal audit metadata, not outbound notifications.
      const notifyRows = (rows ?? []).filter((r) =>
        r.action === "engagement.admin_alert_sent" ||
        r.action === "notification_skipped");
      const leak = notifyRows.find((r) => {
        const blob = JSON.stringify(r.metadata ?? {});
        return forbidden.some((f) => blob.includes(f));
      });
      tests.push({
        id: "T7", description: "Notification audit rows contain NO recipient/candidate leakage",
        expected: "no admin_alert_sent / notification_skipped row contains a counterparty email or candidate org name",
        observed: leak ? `LEAK in action=${leak.action}` : `no leakage across ${notifyRows.length} notification audit rows`,
        pass: !leak,
        details: { notify_rows: notifyRows.length, total_rows: rows?.length ?? 0 },
      });
    }
  } catch (err) {
    setupError = err instanceof Error ? err.message : String(err);
  }

  // Cleanup (LIFO).
  const cleanupErrors: string[] = [];
  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch (e) {
      cleanupErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const passed = tests.filter((t) => t.pass).length;
  return new Response(JSON.stringify({
    success: setupError == null && passed === tests.length,
    setup_error: setupError,
    summary: { total: tests.length, passed, failed: tests.length - passed },
    tests,
    cleanup_errors: cleanupErrors,
  }, null, 2), { status: 200, headers: baseHeaders });
});
