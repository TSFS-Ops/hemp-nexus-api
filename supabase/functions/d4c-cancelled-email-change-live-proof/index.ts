/**
 * Batch D — D4c-3a Production Cancelled-Email-Change live-proof harness.
 *
 * Exercises the REAL deployed `poi-engagements` POST
 * `/cancel-for-email-change` route end-to-end and asserts the D4c-3a
 * initiator-side wiring (`dispatchD4cInitiatorAlert`):
 *
 *   T1. A valid cancel call updates engagement_status='cancelled_email_change'
 *       and operational_state='cancelled_for_email_change'.
 *   T2. Exactly ONE `engagement.initiator_alert_queued` audit row is
 *       written for `engagement.cancelled_email_change`.
 *   T3. Recipient resolution targeted only the initiating-org admin
 *       (recipient_user_ids matches the initiating-org admin we minted).
 *   T4. NO counterparty / candidate / disputed / external recipient
 *       audit footprint exists for this engagement.
 *   T5. Repeating the cancel call with a different idempotency key
 *       returns 409 ALREADY_CANCELLED and does NOT write a second
 *       `initiator_alert_queued` row.
 *   T6. A hard-suppressed initiating-org admin is skipped safely
 *       (run on a second engagement seeded with a 'bounce' suppression
 *       on the initiating admin's email): cancel still succeeds, no
 *       `initiator_alert_queued` row is written, and an
 *       `initiator_alert_skipped` row OR a 0-recipient outcome is
 *       observed without leakage.
 *   T7. Cleanup removes all disposable test data (LIFO, best-effort).
 *
 * Invocation:
 *   POST /functions/v1/d4c-cancelled-email-change-live-proof
 *   Headers: x-internal-key: <INTERNAL_CRON_KEY>
 *   Body:    { "confirm": "RUN_D4C_CANCELLED_EMAIL_CHANGE_LIVE_PROOF" }
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

async function postCancel(
  edgeBase: string,
  jwt: string,
  engagementId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<PostResult> {
  // NOTE: parameter intentionally not named `baseUrl` — the route guard
  // (scripts/check-routes.mjs) treats that variable name as an in-app
  // navigation target.
  const res = await fetch(
    `${edgeBase}/functions/v1/poi-engagements/${engagementId}/cancel-for-email-change`,
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
  if (payload?.confirm !== "RUN_D4C_CANCELLED_EMAIL_CHANGE_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_D4C_CANCELLED_EMAIL_CHANGE_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d4c3a-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const startedAt = new Date().toISOString();
  const auditEntityIds: string[] = [];
  let setupError: string | null = null;

  try {
    // ── Provision initiating org + counterparty org ────────────────────
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
    const initAdminEmail = `${tag}-init-admin@d4c3a.example.com`;
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
        org_id: orgI.id,
        status: "active",
      }, { onConflict: "id" });
      if (pErr) throw new Error(`init admin profile: ${pErr.message}`);
    }
    {
      const { error: rErr } = await admin.from("user_roles")
        .insert({ user_id: initAdmin.user.id, role: "org_admin" });
      if (rErr) throw new Error(`init admin role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", initAdmin.user!.id).eq("role", "org_admin"));
    }

    // ── Mint synthetic platform_admin used for every cancel call ───────
    const platAdminEmail = `${tag}-platadmin@d4c3a.example.com`;
    const platAdminPwd = `${tag}-AdmPw!aA9`;
    const { data: platAdmin, error: platAdminErr } = await admin.auth.admin.createUser({
      email: platAdminEmail, password: platAdminPwd, email_confirm: true,
    });
    if (platAdminErr || !platAdmin.user) throw new Error(`plat admin: ${platAdminErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(platAdmin.user!.id));
    {
      const { error: rErr } = await admin.from("user_roles")
        .insert({ user_id: platAdmin.user.id, role: "platform_admin" });
      if (rErr) throw new Error(`plat admin role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", platAdmin.user!.id).eq("role", "platform_admin"));
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: sess, error: sessErr } = await userClient.auth
      .signInWithPassword({ email: platAdminEmail, password: platAdminPwd });
    if (sessErr || !sess.session) throw new Error(`plat admin signin: ${sessErr?.message}`);
    const adminJwt = sess.session.access_token;

    // ── Helper: create a fresh engagement bound to the counterparty org
    async function newEngagement(label: string, counterpartyEmail: string): Promise<string> {
      const { data: match, error: matchErr } = await admin.from("matches").insert({
        buyer_org_id: orgI.id, seller_org_id: orgC.id, org_id: orgI.id,
        buyer_id: `${tag}_${label}_buyer`, seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} buyer`, seller_name: `${tag} seller`,
        commodity: "TEST_D4C_CEC", quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d4c3a_${runId}_${label}`,
      }).select("id").single();
      if (matchErr || !match) throw new Error(`match ${label}: ${matchErr?.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", match.id));
      const { data: eng, error: engErr } = await admin.from("poi_engagements").insert({
        match_id: match.id,
        org_id: orgI.id,
        counterparty_org_id: orgC.id,
        counterparty_email: counterpartyEmail,
        counterparty_type: "organisation",
        engagement_status: "contacted",
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

    async function fetchEng(id: string) {
      const { data } = await admin.from("poi_engagements")
        .select("engagement_status, operational_state, cancelled_at, cancelled_reason")
        .eq("id", id).maybeSingle();
      return data;
    }
    async function fetchInitiatorAuditRows(id: string, action: string) {
      const { data } = await admin.from("audit_logs")
        .select("action, metadata, created_at")
        .eq("entity_id", id)
        .eq("action", action)
        .gte("created_at", startedAt);
      return data ?? [];
    }

    // ── T1+T2+T3+T4: happy path cancel ─────────────────────────────────
    const cpEmailT1 = `cp-${tag}@d4c3a-cp.example.com`;
    const eid1 = await newEngagement("t1", cpEmailT1);
    const r1 = await postCancel(SUPABASE_URL, adminJwt, eid1,
      { new_email: `cp-new-${tag}@d4c3a-cp.example.com`, reason: "wrong contact" },
      `${tag}_t1`);
    const row1 = await fetchEng(eid1);
    const queued1 = await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued");

    const t1Pass = r1.status === 200
      && row1?.engagement_status === "cancelled_email_change"
      && row1?.operational_state === "cancelled_for_email_change";
    tests.push({
      id: "T1",
      description: "Cancel call commits cancelled_email_change state",
      expected: "200 + engagement_status=cancelled_email_change + operational_state=cancelled_for_email_change",
      observed: `status=${r1.status} eng_status=${row1?.engagement_status} op_state=${row1?.operational_state}`,
      pass: t1Pass,
      details: { response: r1.body, row: row1 },
    });

    const t2Pass = queued1.length === 1
      && queued1[0].metadata?.event_type === "engagement.cancelled_email_change"
      && queued1[0].metadata?.source_function === "poi-engagements"
      && queued1[0].metadata?.dedupe_key === `cancelled_email_change:${eid1}`;
    tests.push({
      id: "T2",
      description: "Exactly one initiator_alert_queued row for cancelled_email_change",
      expected: "1 row with event_type=engagement.cancelled_email_change, source_function=poi-engagements, stable dedupe_key",
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

    // T4: scan ALL audit metadata written for this engagement for any
    // counterparty/candidate/external leakage.
    const { data: allAuditRows } = await admin.from("audit_logs")
      .select("action, metadata")
      .eq("entity_id", eid1)
      .gte("created_at", startedAt);
    const initiatorRows = (allAuditRows ?? []).filter((r) =>
      r.action === "engagement.initiator_alert_queued" ||
      r.action === "engagement.initiator_alert_skipped");
    const forbidden = [
      cpEmailT1,
      `cp-new-${tag}@d4c3a-cp.example.com`,
      orgC.name,
      orgC.id,
    ];
    const leak = initiatorRows.find((r) => {
      const blob = JSON.stringify(r.metadata ?? {});
      return forbidden.some((f) => blob.includes(f));
    });
    const t4Pass = !leak;
    tests.push({
      id: "T4",
      description: "No counterparty/candidate/external recipient leakage in initiator audit metadata",
      expected: "no initiator_alert_* row references counterparty email, new_email, counterparty org name or id",
      observed: leak
        ? `LEAK in ${leak.action}: ${JSON.stringify(leak.metadata).slice(0, 300)}`
        : `${initiatorRows.length} initiator audit row(s), none reference forbidden values`,
      pass: t4Pass,
      details: { initiatorRows, forbidden },
    });

    // ── T5: replay with different idempotency key — 409 + no new alert
    const r1b = await postCancel(SUPABASE_URL, adminJwt, eid1,
      { new_email: `cp-new2-${tag}@d4c3a-cp.example.com` },
      `${tag}_t1_replay`);
    const queued1b = await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued");
    const t5Pass = r1b.status === 409
      && queued1b.length === 1;
    tests.push({
      id: "T5",
      description: "Repeating cancel does not duplicate the initiator alert",
      expected: "second call returns 409 ALREADY_CANCELLED and queued audit count stays at 1",
      observed: `status=${r1b.status} queuedCount=${queued1b.length}`,
      pass: t5Pass,
      details: { response: r1b.body },
    });

    // ── T6: hard-suppressed initiating admin → cancel still succeeds,
    //          no queued row, optional skipped row, no leakage ─────────
    {
      const cpEmailT6 = `cp-${tag}-t6@d4c3a-cp.example.com`;
      const eid6 = await newEngagement("t6", cpEmailT6);
      // Seed hard suppression for the initiating admin.
      const { error: supErr } = await admin.from("suppressed_emails").upsert({
        email: initAdminEmail.toLowerCase(),
        reason: "bounce",
      }, { onConflict: "email" });
      if (supErr) throw new Error(`suppress seed: ${supErr.message}`);
      cleanup.push(() => admin.from("suppressed_emails")
        .delete().eq("email", initAdminEmail.toLowerCase()));

      const r6 = await postCancel(SUPABASE_URL, adminJwt, eid6,
        { new_email: `cp-new-${tag}-t6@d4c3a-cp.example.com` },
        `${tag}_t6`);
      const row6 = await fetchEng(eid6);
      const queued6 = await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_queued");
      const skipped6 = await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_skipped");
      const allInit6 = [...queued6, ...skipped6];
      const leak6 = allInit6.find((r) => {
        const blob = JSON.stringify(r.metadata ?? {});
        return [cpEmailT6, orgC.name, orgC.id].some((f) => blob.includes(f));
      });

      const t6Pass = r6.status === 200
        && row6?.engagement_status === "cancelled_email_change"
        && queued6.length === 0
        && !leak6;
      tests.push({
        id: "T6",
        description: "Hard-suppressed initiating admin: cancel still succeeds, no queued alert, no leakage",
        expected: "cancel=200, eng cancelled, queued=0, no counterparty leakage in any initiator audit row",
        observed: `status=${r6.status} eng_status=${row6?.engagement_status} queued=${queued6.length} skipped=${skipped6.length} leak=${!!leak6}`,
        pass: t6Pass,
        details: { response: r6.body, queued6, skipped6 },
      });
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // ── T7: cleanup (LIFO best-effort) ───────────────────────────────────
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
    id: "T7",
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
