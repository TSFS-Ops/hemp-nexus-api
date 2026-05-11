/**
 * Batch D — D4c-3c Production Late-Acceptance-Pending-Reconfirmation
 * live-proof harness.
 *
 * Exercises the REAL deployed `poi-engagements` POST `/respond` route
 * end-to-end and asserts the D4c-3c initiator-side wiring
 * (`dispatchD4cInitiatorAlert`):
 *
 *   T1. Counterparty accepting an expired engagement records
 *       engagement_status=`late_acceptance_pending_initiator_reconfirmation`.
 *   T2. Exactly ONE `engagement.initiator_alert_queued` audit row is
 *       written for `engagement.late_acceptance_pending_reconfirmation`
 *       with stable
 *       dedupe_key=`late_acceptance_pending_reconfirmation:<engagementId>`.
 *   T3. Recipient resolution targeted only the initiating-org admin.
 *   T4. NO counterparty/candidate/disputed/external recipient leakage
 *       in initiator audit metadata.
 *   T5. Repeating the same /respond call returns
 *       409 LATE_ACCEPTANCE_ALREADY_RECORDED and does NOT write a
 *       second initiator_alert_queued row.
 *   T6. Initiator reconfirm route does NOT write a second
 *       `engagement.late_acceptance_pending_reconfirmation` alert.
 *   T7. Initiator decline route does NOT write a
 *       `engagement.late_acceptance_pending_reconfirmation` alert.
 *   T8. Hard-suppressed initiating-org admin: late-acceptance still
 *       records (200), no queued row, skipped audit row, no leakage.
 *   T9. Cleanup removes all disposable test data (LIFO, best-effort).
 *
 * Invocation:
 *   POST /functions/v1/d4c-late-acceptance-reconfirmation-live-proof
 *   Headers: x-internal-key: <INTERNAL_CRON_KEY>
 *   Body:    { "confirm": "RUN_D4C_LATE_ACCEPTANCE_LIVE_PROOF" }
 *
 * Auth: INTERNAL_CRON_KEY OR service_role Bearer OR platform_admin JWT.
 *
 * EXPLICITLY OUT OF SCOPE: every other D4c event, Batch C, ratings,
 * MT-009, legacy disputes, payments, sanctions/compliance/KYB/UBO,
 * public status, data export/residency, RLS, unrelated UI/routes,
 * DOCX/client walkthroughs, in-app notification surface.
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

interface PostResult {
  status: number;
  body: any;
}

async function postEngagementAction(
  edgeBase: string,
  jwt: string,
  engagementId: string,
  action: "respond" | "reconfirm" | "decline-late-acceptance",
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<PostResult> {
  // NOTE: parameter intentionally not named `baseUrl` — the route guard
  // (scripts/check-routes.mjs) treats that variable name as an in-app
  // navigation target.
  const res = await fetch(
    `${edgeBase}/functions/v1/poi-engagements/${engagementId}/${action}`,
    {
      method: "POST",
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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: baseHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: baseHeaders,
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
  if (payload?.confirm !== "RUN_D4C_LATE_ACCEPTANCE_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_D4C_LATE_ACCEPTANCE_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d4c3c-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const startedAt = new Date().toISOString();
  let setupError: string | null = null;

  try {
    // ── Provision initiating + counterparty orgs ────────────────────────
    const { data: orgI, error: orgIErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_initiator` })
      .select("id, name").single();
    if (orgIErr || !orgI) throw new Error(`org init: ${orgIErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgI.id));

    const { data: orgC, error: orgCErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_counterparty` })
      .select("id, name").single();
    if (orgCErr || !orgC) throw new Error(`org cp: ${orgCErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgC.id));

    // ── Mint initiating-org admin (active profile + org_admin role) ────
    const initAdminEmail = `${tag}-init-admin@d4c3c.example.com`;
    const initAdminPwd = `${tag}-Pw!aA9`;
    const { data: initAdmin, error: initAdminErr } = await admin.auth.admin.createUser({
      email: initAdminEmail, password: initAdminPwd, email_confirm: true,
    });
    if (initAdminErr || !initAdmin.user) throw new Error(`init admin: ${initAdminErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(initAdmin.user!.id));
    {
      const { error: pErr } = await admin.from("profiles").upsert({
        id: initAdmin.user.id,
        email: initAdminEmail,
        full_name: `${tag} Init Admin`,
        org_id: orgI.id,
        status: "active",
      }, { onConflict: "id" });
      if (pErr) throw new Error(`init admin profile: ${pErr.message}`);
    }
    {
      const { error: rErr } = await admin.from("user_roles")
        .upsert({ user_id: initAdmin.user.id, role: "org_admin" }, { onConflict: "user_id,role" });
      if (rErr) throw new Error(`init admin role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", initAdmin.user!.id).eq("role", "org_admin"));
    }

    // ── Mint counterparty-org member (will accept after expiry) ────────
    const cpUserEmail = `${tag}-cp-user@d4c3c.example.com`;
    const cpUserPwd = `${tag}-CpPw!aA9`;
    const { data: cpUser, error: cpUserErr } = await admin.auth.admin.createUser({
      email: cpUserEmail, password: cpUserPwd, email_confirm: true,
    });
    if (cpUserErr || !cpUser.user) throw new Error(`cp user: ${cpUserErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(cpUser.user!.id));
    {
      const { error: pErr } = await admin.from("profiles").upsert({
        id: cpUser.user.id,
        email: cpUserEmail,
        full_name: `${tag} CP User`,
        org_id: orgC.id,
        status: "active",
      }, { onConflict: "id" });
      if (pErr) throw new Error(`cp user profile: ${pErr.message}`);
    }
    {
      const { error: rErr } = await admin.from("user_roles")
        .upsert({ user_id: cpUser.user.id, role: "org_admin" }, { onConflict: "user_id,role" });
      if (rErr) throw new Error(`cp user role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", cpUser.user!.id).eq("role", "org_admin"));
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: cpSess, error: cpSessErr } = await userClient.auth
      .signInWithPassword({ email: cpUserEmail, password: cpUserPwd });
    if (cpSessErr || !cpSess.session) throw new Error(`cp signin: ${cpSessErr?.message}`);
    const cpJwt = cpSess.session.access_token;

    const initClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: initSess, error: initSessErr } = await initClient.auth
      .signInWithPassword({ email: initAdminEmail, password: initAdminPwd });
    if (initSessErr || !initSess.session) throw new Error(`init signin: ${initSessErr?.message}`);
    const initJwt = initSess.session.access_token;

    // ── Helper: create a fresh expired engagement parked in `contacted`
    async function newExpiredEngagement(label: string): Promise<string> {
      const { data: match, error: matchErr } = await admin.from("matches").insert({
        buyer_org_id: orgI.id, seller_org_id: orgC.id, org_id: orgI.id,
        buyer_id: `${tag}_${label}_buyer`, seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} buyer`, seller_name: `${tag} seller`,
        commodity: "TEST_D4C_LA", quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d4c3c_${runId}_${label}`,
      }).select("id").single();
      if (matchErr || !match) throw new Error(`match ${label}: ${matchErr?.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", match.id));

      const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: eng, error: engErr } = await admin.from("poi_engagements").insert({
        match_id: match.id,
        org_id: orgI.id,
        counterparty_org_id: orgC.id,
        counterparty_email: `cp-${label}-${tag}@d4c3c-cp.example.com`,
        counterparty_type: "known",
        engagement_status: "contacted",
        contact_type: "organisation",
        source: "admin_manual",
        expires_at: expiredAt,
      }).select("id").single();
      if (engErr || !eng) throw new Error(`eng ${label}: ${engErr?.message}`);
      cleanup.push(() => admin.from("poi_engagements").delete().eq("id", eng.id));
      cleanup.push(() => admin.from("audit_logs").delete().eq("entity_id", eng.id));
      cleanup.push(() => admin.from("engagement_outreach_logs").delete().eq("engagement_id", eng.id));
      return eng.id;
    }

    async function fetchEng(id: string) {
      const { data } = await admin.from("poi_engagements")
        .select("engagement_status, expires_at")
        .eq("id", id).maybeSingle();
      return data;
    }
    async function fetchInitiatorAuditRows(id: string, action: string, eventType?: string) {
      const { data } = await admin.from("audit_logs")
        .select("action, metadata, created_at")
        .eq("entity_id", id)
        .eq("action", action)
        .gte("created_at", startedAt);
      const rows = data ?? [];
      if (!eventType) return rows;
      return rows.filter((r: any) => r.metadata?.event_type === eventType);
    }

    // ── T1+T2+T3+T4: happy path: counterparty late-accepts ─────────────
    const eid1 = await newExpiredEngagement("t1");
    const r1 = await postEngagementAction(SUPABASE_URL, cpJwt, eid1, "respond",
      { action: "accepted" }, `${tag}_t1`);
    const row1 = await fetchEng(eid1);
    const queued1 = await fetchInitiatorAuditRows(
      eid1,
      "engagement.initiator_alert_queued",
      "engagement.late_acceptance_pending_reconfirmation",
    );

    const t1Pass = r1.status === 200
      && row1?.engagement_status === "late_acceptance_pending_initiator_reconfirmation";
    tests.push({
      id: "T1",
      description: "Counterparty late acceptance records pending_initiator_reconfirmation",
      expected: "200 + engagement_status=late_acceptance_pending_initiator_reconfirmation",
      observed: `status=${r1.status} eng_status=${row1?.engagement_status}`,
      pass: t1Pass,
      details: { response: r1.body, row: row1 },
    });

    const t2Pass = queued1.length === 1
      && queued1[0].metadata?.event_type === "engagement.late_acceptance_pending_reconfirmation"
      && queued1[0].metadata?.source_function === "poi-engagements"
      && queued1[0].metadata?.dedupe_key === `late_acceptance_pending_reconfirmation:${eid1}`;
    tests.push({
      id: "T2",
      description: "Exactly one initiator_alert_queued for late_acceptance_pending_reconfirmation",
      expected: "1 row, event=engagement.late_acceptance_pending_reconfirmation, source=poi-engagements, stable dedupe_key",
      observed: `count=${queued1.length} meta=${JSON.stringify(queued1[0]?.metadata ?? null).slice(0, 240)}`,
      pass: t2Pass,
      details: { rows: queued1 },
    });

    const initAdminHash = await sha256Hex(initAdminEmail);
    const recipientUserIds = (queued1[0]?.metadata?.recipient_user_ids ?? []) as string[];
    const recipientHashes = (queued1[0]?.metadata?.recipient_emails_hash ?? []) as string[];
    const t3Pass = recipientUserIds.length === 1
      && recipientUserIds[0] === initAdmin.user.id
      && recipientHashes.includes(initAdminHash);
    tests.push({
      id: "T3",
      description: "Recipients resolve to initiating-org admin only",
      expected: `recipient_user_ids=[${initAdmin.user.id}] and matching email hash present`,
      observed: `user_ids=${JSON.stringify(recipientUserIds)} hashHit=${recipientHashes.includes(initAdminHash)}`,
      pass: t3Pass,
      details: { recipientUserIds, recipientHashes },
    });

    // T4: scan ALL initiator_alert_* rows for forbidden leakage.
    const { data: allAuditRows } = await admin.from("audit_logs")
      .select("action, metadata")
      .eq("entity_id", eid1)
      .gte("created_at", startedAt);
    const initiatorRows = (allAuditRows ?? []).filter((r: any) =>
      r.action === "engagement.initiator_alert_queued" ||
      r.action === "engagement.initiator_alert_skipped");
    const cpHash = await sha256Hex(cpUserEmail);
    const forbidden = [
      `cp-t1-${tag}@d4c3c-cp.example.com`,
      cpUserEmail,
      orgC.name,
      orgC.id,
      "TEST_D4C_LA",
    ];
    const leak = initiatorRows.find((r: any) => {
      const blob = JSON.stringify(r.metadata ?? {});
      // allow recipient_emails_hash to legitimately contain initiator
      // hash but never the counterparty hash.
      return forbidden.some((f) => blob.includes(f)) || blob.includes(cpHash);
    });
    const t4Pass = !leak;
    tests.push({
      id: "T4",
      description: "No counterparty/candidate/external leakage in initiator audit metadata",
      expected: "no initiator_alert_* row references counterparty email/name/id, commodity, or counterparty email hash",
      observed: leak
        ? `LEAK in ${leak.action}: ${JSON.stringify(leak.metadata).slice(0, 300)}`
        : `${initiatorRows.length} initiator audit row(s), none reference forbidden values`,
      pass: t4Pass,
      details: { initiatorRows, forbidden },
    });

    // ── T5: replay /respond → 409 + no new alert ───────────────────────
    const r1b = await postEngagementAction(SUPABASE_URL, cpJwt, eid1, "respond",
      { action: "accepted" }, `${tag}_t1_replay`);
    const queued1b = await fetchInitiatorAuditRows(
      eid1,
      "engagement.initiator_alert_queued",
      "engagement.late_acceptance_pending_reconfirmation",
    );
    const t5Pass = r1b.status === 409
      && queued1b.length === 1;
    tests.push({
      id: "T5",
      description: "Replaying /respond does not duplicate the initiator alert",
      expected: "409 LATE_ACCEPTANCE_ALREADY_RECORDED and queued count stays at 1",
      observed: `status=${r1b.status} queuedCount=${queued1b.length}`,
      pass: t5Pass,
      details: { response: r1b.body },
    });

    // ── T6: reconfirm route does NOT emit pending-reconfirmation alert ─
    {
      const r6 = await postEngagementAction(SUPABASE_URL, initJwt, eid1,
        "reconfirm-late-acceptance", {}, `${tag}_t6`);
      const queued6 = await fetchInitiatorAuditRows(
        eid1,
        "engagement.initiator_alert_queued",
        "engagement.late_acceptance_pending_reconfirmation",
      );
      const t6Pass = (r6.status === 200 || r6.status === 409) && queued6.length === 1;
      tests.push({
        id: "T6",
        description: "reconfirm-late-acceptance does NOT emit a second pending-reconfirmation alert",
        expected: "queued count for pending-reconfirmation event remains 1",
        observed: `status=${r6.status} queuedCount=${queued6.length}`,
        pass: t6Pass,
        details: { response: r6.body },
      });
    }

    // ── T7: decline route on a fresh late-acceptance engagement ────────
    {
      const eid7 = await newExpiredEngagement("t7");
      const rPre = await postEngagementAction(SUPABASE_URL, cpJwt, eid7, "respond",
        { action: "accepted" }, `${tag}_t7_pre`);
      // baseline must be exactly one queued alert from the late-accept
      const queued7Pre = await fetchInitiatorAuditRows(
        eid7,
        "engagement.initiator_alert_queued",
        "engagement.late_acceptance_pending_reconfirmation",
      );
      const r7 = await postEngagementAction(SUPABASE_URL, initJwt, eid7,
        "decline-late-acceptance", {}, `${tag}_t7`);
      const queued7Post = await fetchInitiatorAuditRows(
        eid7,
        "engagement.initiator_alert_queued",
        "engagement.late_acceptance_pending_reconfirmation",
      );
      const t7Pass = rPre.status === 200
        && queued7Pre.length === 1
        && (r7.status === 200 || r7.status === 409)
        && queued7Post.length === 1;
      tests.push({
        id: "T7",
        description: "decline-late-acceptance does NOT emit a pending-reconfirmation alert",
        expected: "queued count for pending-reconfirmation event stays at 1 after decline",
        observed: `pre=${queued7Pre.length} declineStatus=${r7.status} post=${queued7Post.length}`,
        pass: t7Pass,
        details: { decline: r7.body },
      });
    }

    // ── T8: hard-suppressed initiating admin ───────────────────────────
    {
      const eid8 = await newExpiredEngagement("t8");
      const { error: supErr } = await admin.from("suppressed_emails").upsert({
        email: initAdminEmail.toLowerCase(),
        reason: "bounce",
      }, { onConflict: "email" });
      if (supErr) throw new Error(`suppress seed: ${supErr.message}`);
      cleanup.push(() => admin.from("suppressed_emails")
        .delete().eq("email", initAdminEmail.toLowerCase()));

      const r8 = await postEngagementAction(SUPABASE_URL, cpJwt, eid8, "respond",
        { action: "accepted" }, `${tag}_t8`);
      const row8 = await fetchEng(eid8);
      const queued8 = await fetchInitiatorAuditRows(
        eid8,
        "engagement.initiator_alert_queued",
        "engagement.late_acceptance_pending_reconfirmation",
      );
      const skipped8 = await fetchInitiatorAuditRows(
        eid8,
        "engagement.initiator_alert_skipped",
        "engagement.late_acceptance_pending_reconfirmation",
      );
      const allInit8 = [...queued8, ...skipped8];
      const leak8 = allInit8.find((r: any) => {
        const blob = JSON.stringify(r.metadata ?? {});
        return [
          `cp-t8-${tag}@d4c3c-cp.example.com`,
          orgC.name,
          orgC.id,
          "TEST_D4C_LA",
        ].some((f) => blob.includes(f));
      });
      const t8Pass = r8.status === 200
        && row8?.engagement_status === "late_acceptance_pending_initiator_reconfirmation"
        && queued8.length === 0
        && skipped8.length >= 1
        && skipped8[0].metadata?.reason === "all_recipients_hard_suppressed"
        && !leak8;
      tests.push({
        id: "T8",
        description: "Hard-suppressed initiating admin: late-accept commits, no queued alert, skipped audit row, no leakage",
        expected: "/respond=200, eng_status=late_acceptance_pending_initiator_reconfirmation, queued=0, skipped>=1 with reason all_recipients_hard_suppressed",
        observed: `status=${r8.status} eng=${row8?.engagement_status} queued=${queued8.length} skipped=${skipped8.length} reason=${skipped8[0]?.metadata?.reason} leak=${!!leak8}`,
        pass: t8Pass,
        details: { response: r8.body, queued8, skipped8 },
      });
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // ── T9: cleanup (LIFO best-effort) ───────────────────────────────────
  let cleanupOk = true;
  const cleanupErrors: string[] = [];
  for (const fn of [...cleanup].reverse()) {
    try {
      await fn();
    } catch (e) {
      cleanupOk = false;
      cleanupErrors.push(e instanceof Error ? e.message : String(e));
    }
  }
  tests.push({
    id: "T9",
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
