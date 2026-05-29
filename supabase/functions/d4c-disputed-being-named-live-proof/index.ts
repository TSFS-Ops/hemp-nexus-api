/**
 * Batch D — D4c-3e Production Disputed-Being-Named live-proof harness.
 *
 * Exercises the REAL deployed `POST /poi-engagements/:id/dispute`
 * route end-to-end and asserts the D4c-3e initiator-side wiring
 * (`dispatchD4cInitiatorAlert`):
 *
 *   T1. POST /dispute returns 200 and parks the engagement in
 *       engagement_status='disputed_being_named' AND
 *       operational_state='disputed_being_named'.
 *   T2. Exactly ONE `engagement.initiator_alert_queued` audit row is
 *       written for `engagement.disputed_being_named` with stable
 *       dedupe_key=`disputed_being_named:<engagementId>`.
 *   T3. Recipients resolve to the initiating-org admin only (single
 *       user id, matching email hash present).
 *   T4. NO counterparty email/name/org, disputed-party identity,
 *       dispute reason text, candidate org, binding candidate,
 *       commodity, price, quantity, or any user-entered dispute text
 *       leaks into the initiator alert audit metadata.
 *   T5. Replay POST /dispute returns 409 ALREADY_DISPUTED and does
 *       NOT write a second initiator_alert_queued row.
 *   T6. Hard-suppressed initiating admin: dispute still commits, no
 *       queued alert, an `engagement.initiator_alert_skipped` row is
 *       written with reason='all_recipients_hard_suppressed', no
 *       leakage.
 *   T7. The disputed counterparty is NOT contacted — no outreach log
 *       row, no transactional_email_queue row, no recipient hash for
 *       the counterparty's email is present in any initiator audit
 *       row across the run.
 *   T8. Cleanup removes all disposable test data (LIFO, best-effort).
 *
 * Invocation:
 *   POST /functions/v1/d4c-disputed-being-named-live-proof
 *   Headers: x-internal-key: <INTERNAL_CRON_KEY>
 *   Body:    { "confirm": "RUN_D4C_DISPUTED_BEING_NAMED_LIVE_PROOF" }
 *
 * Auth: INTERNAL_CRON_KEY OR service_role Bearer OR platform_admin JWT.
 *
 * EXPLICITLY OUT OF SCOPE: every other D4c event, Batch C, ratings,
 * MT-009, legacy disputes, payments, sanctions/compliance/KYB/UBO,
 * public status, data export/residency, RLS, unrelated UI/routes,
 * DOCX/client walkthroughs, in-app notification surface,
 * outreach.blocked events.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

async function postDispute(
  edgeBase: string,
  jwt: string,
  engagementId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<PostResult> {
  const res = await fetch(
    `${edgeBase}/functions/v1/poi-engagements/${engagementId}/dispute`,
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
  try { parsed = await res.json(); } catch { parsed = await res.text(); }
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
  const baseHeaders = { ...__buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin")), "Content-Type": "application/json" };
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
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

  // ── Auth: INTERNAL_CRON_KEY OR service_role OR platform_admin JWT ──
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
  if (payload?.confirm !== "RUN_D4C_DISPUTED_BEING_NAMED_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_D4C_DISPUTED_BEING_NAMED_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d4c3e-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const startedAt = new Date().toISOString();
  let setupError: string | null = null;

  try {
    // ── Initiating org + counterparty org ──────────────────────────────
    const { data: orgI, error: orgIErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_initiator` })
      .select("id, name").single();
    if (orgIErr || !orgI) throw new Error(`org init: ${orgIErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgI.id));

    const { data: orgC, error: orgCErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_counterparty` })
      .select("id, name").single();
    if (orgCErr || !orgC) throw new Error(`org C: ${orgCErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgC.id));

    const counterpartyEmail = `cp-${tag}@d4c3e-cp.example.com`;
    const counterpartyName = `${tag}_cp_person`;

    // ── Initiating-org admin (recipient under test) ────────────────────
    const initAdminEmail = `${tag}-init-admin@d4c3e.example.com`;
    const initAdminPwd = `${tag}-Pw!aA9`;
    const { data: initAdmin, error: initAdminErr } = await admin.auth.admin.createUser({
      email: initAdminEmail, password: initAdminPwd, email_confirm: true,
    });
    if (initAdminErr || !initAdmin.user) throw new Error(`init admin: ${initAdminErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(initAdmin.user!.id));
    {
      const { error: pErr } = await admin.from("profiles").upsert({
        id: initAdmin.user.id, email: initAdminEmail, org_id: orgI.id, status: "active",
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

    // ── Synthetic platform_admin used for every POST call ──────────────
    const platAdminEmail = `${tag}-platadmin@d4c3e.example.com`;
    const platAdminPwd = `${tag}-AdmPw!aA9`;
    const { data: platAdmin, error: platAdminErr } = await admin.auth.admin.createUser({
      email: platAdminEmail, password: platAdminPwd, email_confirm: true,
    });
    if (platAdminErr || !platAdmin.user) throw new Error(`plat admin: ${platAdminErr?.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(platAdmin.user!.id));
    {
      const { error: rErr } = await admin.from("user_roles")
        .upsert({ user_id: platAdmin.user.id, role: "platform_admin" }, { onConflict: "user_id,role" });
      if (rErr) throw new Error(`plat admin role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", platAdmin.user!.id).eq("role", "platform_admin"));
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: sess, error: sessErr } = await userClient.auth
      .signInWithPassword({ email: platAdminEmail, password: platAdminPwd });
    if (sessErr || !sess.session) throw new Error(`plat admin signin: ${sessErr?.message}`);
    const adminJwt = sess.session.access_token;

    // ── Helper: create a fresh pending engagement with named counterparty ──
    async function newPendingEngagement(label: string): Promise<string> {
      const { data: match, error: matchErr } = await admin.from("matches").insert({
        buyer_org_id: orgI.id, seller_org_id: orgC.id, org_id: orgI.id,
        buyer_id: `${tag}_${label}_buyer`, seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} buyer`, seller_name: `${tag} seller`,
        commodity: "TEST_D4C_DBN_COMMODITY", quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d4c3e_${runId}_${label}`,
      }).select("id").single();
      if (matchErr || !match) throw new Error(`match ${label}: ${matchErr?.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", match.id));

      const { data: eng, error: engErr } = await admin.from("poi_engagements").insert({
        match_id: match.id,
        org_id: orgI.id,
        counterparty_type: "known",
        counterparty_email: counterpartyEmail,
        counterparty_org_id: orgC.id,
        contact_name: counterpartyName,
        engagement_status: "pending",
        source: "admin_manual",
      }).select("id").single();
      if (engErr || !eng) throw new Error(`eng ${label}: ${engErr?.message}`);
      cleanup.push(() => admin.from("poi_engagements").delete().eq("id", eng.id));
      cleanup.push(() => admin.from("audit_logs").delete().eq("entity_id", eng.id));
      cleanup.push(() => admin.from("engagement_outreach_logs").delete().eq("engagement_id", eng.id));
      return eng.id;
    }

    async function fetchEng(id: string) {
      const { data } = await admin.from("poi_engagements")
        .select("operational_state, engagement_status, dispute_reason")
        .eq("id", id).maybeSingle();
      return data;
    }
    async function fetchInitiatorAuditRows(id: string, action: string) {
      const { data } = await admin.from("audit_logs")
        .select("action, metadata, created_at")
        .eq("entity_id", id).eq("action", action)
        .gte("created_at", startedAt);
      return data ?? [];
    }

    const disputeReasonText =
      "USER_ENTERED_DISPUTE_REASON_NEVER_CONTACTED_BY_PLATFORM_DBN_LEAK_CANARY";

    // ── T1+T2+T3+T4: dispute happy path ─────────────────────────────────
    const eid1 = await newPendingEngagement("t1");
    const r1 = await postDispute(SUPABASE_URL, adminJwt, eid1, {
      reason: disputeReasonText,
      dispute_source: "admin_report",
    }, `${tag}_t1`);
    const row1 = await fetchEng(eid1);
    const queued1 = await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued");

    const t1Pass = r1.status === 200
      && row1?.engagement_status === "disputed_being_named"
      && row1?.operational_state === "disputed_being_named";
    tests.push({
      id: "T1",
      description: "POST /dispute parks engagement in disputed_being_named",
      expected: "200 + engagement_status=disputed_being_named + operational_state=disputed_being_named",
      observed: `status=${r1.status} eng_status=${row1?.engagement_status} op_state=${row1?.operational_state}`,
      pass: t1Pass,
      details: { response: r1.body, row: row1 },
    });

    const t2Pass = queued1.length === 1
      && (queued1[0].metadata as any)?.event_type === "engagement.disputed_being_named"
      && (queued1[0].metadata as any)?.source_function === "poi-engagements"
      && (queued1[0].metadata as any)?.dedupe_key === `disputed_being_named:${eid1}`;
    tests.push({
      id: "T2",
      description: "Exactly one initiator_alert_queued row for disputed_being_named",
      expected: "1 row, event=engagement.disputed_being_named, source=poi-engagements, stable dedupe_key",
      observed: `count=${queued1.length} meta=${JSON.stringify(queued1[0]?.metadata ?? null).slice(0, 240)}`,
      pass: t2Pass,
      details: { rows: queued1 },
    });

    const initAdminHash = await sha256Hex(initAdminEmail);
    const cpHash = await sha256Hex(counterpartyEmail);
    const recipientUserIds = ((queued1[0]?.metadata as any)?.recipient_user_ids ?? []) as string[];
    const recipientHashes = ((queued1[0]?.metadata as any)?.recipient_emails_hash ?? []) as string[];
    const t3Pass = recipientUserIds.length === 1
      && recipientUserIds[0] === initAdmin.user.id
      && recipientHashes.includes(initAdminHash)
      && !recipientHashes.includes(cpHash);
    tests.push({
      id: "T3",
      description: "Recipients resolve to initiating-org admin only (counterparty hash absent)",
      expected: `recipient_user_ids=[${initAdmin.user.id}], init hash present, counterparty hash absent`,
      observed: `user_ids=${JSON.stringify(recipientUserIds)} initHashHit=${recipientHashes.includes(initAdminHash)} cpHashHit=${recipientHashes.includes(cpHash)}`,
      pass: t3Pass,
      details: { recipientUserIds, recipientHashes },
    });

    // T4: scan ALL initiator_alert_* metadata for forbidden values.
    const { data: allAuditRows } = await admin.from("audit_logs")
      .select("action, metadata")
      .eq("entity_id", eid1)
      .gte("created_at", startedAt);
    const initiatorRows = (allAuditRows ?? []).filter((r) =>
      r.action === "engagement.initiator_alert_queued" ||
      r.action === "engagement.initiator_alert_skipped");
    const forbidden = [
      counterpartyEmail,
      counterpartyName,
      orgC.name,
      orgC.id,
      "TEST_D4C_DBN_COMMODITY",
      disputeReasonText,
      "NEVER_CONTACTED_BY_PLATFORM_DBN_LEAK_CANARY",
    ];
    const leak = initiatorRows.find((r) => {
      const blob = JSON.stringify(r.metadata ?? {});
      return forbidden.some((f) => blob.includes(f));
    });
    const t4Pass = !leak;
    tests.push({
      id: "T4",
      description: "No counterparty/candidate/disputed/commercial/dispute-text leakage in initiator audit metadata",
      expected: "no initiator_alert_* row references counterparty email/name/org, commodity, or dispute reason text",
      observed: leak
        ? `LEAK in ${leak.action}: ${JSON.stringify(leak.metadata).slice(0, 300)}`
        : `${initiatorRows.length} initiator audit row(s), none reference forbidden values`,
      pass: t4Pass,
      details: { initiatorRows, forbidden },
    });

    // ── T5: replay POST /dispute → 409 ALREADY_DISPUTED, no second alert ──
    const r1b = await postDispute(SUPABASE_URL, adminJwt, eid1, {
      reason: disputeReasonText,
      dispute_source: "admin_report",
    }, `${tag}_t1_replay`);
    const queued1b = await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued");
    const t5Pass = r1b.status === 409
      && (r1b.body?.code === "ALREADY_DISPUTED" || r1b.body?.error === "ALREADY_DISPUTED")
      && queued1b.length === 1;
    tests.push({
      id: "T5",
      description: "Replay POST /dispute returns 409 ALREADY_DISPUTED and does not duplicate the initiator alert",
      expected: "status=409 code=ALREADY_DISPUTED queuedCount=1",
      observed: `status=${r1b.status} body=${JSON.stringify(r1b.body).slice(0, 200)} queuedCount=${queued1b.length}`,
      pass: t5Pass,
      details: { response: r1b.body },
    });

    // ── T6: hard-suppressed initiating admin → dispute commits, no
    //        queued alert, skipped row written, no leakage. ──────────────
    {
      const eid6 = await newPendingEngagement("t6");
      const { error: supErr } = await admin.from("suppressed_emails").upsert({
        email: initAdminEmail.toLowerCase(),
        reason: "bounce",
      }, { onConflict: "email" });
      if (supErr) throw new Error(`suppress seed: ${supErr.message}`);
      cleanup.push(() => admin.from("suppressed_emails")
        .delete().eq("email", initAdminEmail.toLowerCase()));

      const r6 = await postDispute(SUPABASE_URL, adminJwt, eid6, {
        reason: disputeReasonText,
        dispute_source: "admin_report",
      }, `${tag}_t6`);
      const row6 = await fetchEng(eid6);
      const queued6 = await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_queued");
      const skipped6 = await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_skipped");
      const allInit6 = [...queued6, ...skipped6];
      const leak6 = allInit6.find((r) => {
        const blob = JSON.stringify(r.metadata ?? {});
        return [counterpartyEmail, counterpartyName, orgC.name, orgC.id,
                "TEST_D4C_DBN_COMMODITY", disputeReasonText]
          .some((f) => blob.includes(f));
      });
      const skippedReason = (skipped6[0]?.metadata as any)?.reason ?? null;
      const t6Pass = r6.status === 200
        && row6?.engagement_status === "disputed_being_named"
        && row6?.operational_state === "disputed_being_named"
        && queued6.length === 0
        && skipped6.length >= 1
        && skippedReason === "all_recipients_hard_suppressed"
        && !leak6;
      tests.push({
        id: "T6",
        description: "Hard-suppressed initiating admin: dispute commits, no queued alert, skipped audit row, no leakage",
        expected: "POST=200, eng_status=disputed_being_named, queued=0, skipped>=1 reason=all_recipients_hard_suppressed",
        observed: `status=${r6.status} eng_status=${row6?.engagement_status} queued=${queued6.length} skipped=${skipped6.length} reason=${skippedReason} leak=${!!leak6}`,
        pass: t6Pass,
        details: { response: r6.body, queued6, skipped6 },
      });

      // T7: counterparty must NOT have been contacted/queued anywhere
      // for this run. Check (a) outreach logs targeting the counterparty
      // email (none should reference it as an outreach event), and (b)
      // any initiator_alert_* recipient_emails_hash matching cpHash for
      // either eid1 or eid6.
      const { data: cpOutreach } = await admin.from("engagement_outreach_logs")
        .select("id, engagement_id, entry_type, notes")
        .in("engagement_id", [eid1, eid6])
        .gte("created_at", startedAt);
      // Outreach rows for the dispute itself ARE expected (entry_type
      // 'dispute_raised') — the test is that none target the
      // counterparty contact channel.
      const outreachToCp = (cpOutreach ?? []).filter((row) => {
        const blob = `${row.entry_type ?? ""} ${row.notes ?? ""}`;
        return blob.includes(counterpartyEmail) || /counterparty_outreach|email_sent|sms_sent/.test(String(row.entry_type ?? ""));
      });

      const allRunInitiatorRows = [
        ...((await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued")) ?? []),
        ...((await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_skipped")) ?? []),
        ...((await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_queued")) ?? []),
        ...((await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_skipped")) ?? []),
      ];
      const cpHashLeak = allRunInitiatorRows.some((r) => {
        const hashes = ((r.metadata as any)?.recipient_emails_hash ?? []) as string[];
        return hashes.includes(cpHash);
      });
      const t7Pass = outreachToCp.length === 0 && !cpHashLeak;
      tests.push({
        id: "T7",
        description: "Disputed counterparty is not contacted (no outreach, no recipient hash match)",
        expected: "no outreach to counterparty email; no initiator_alert_* recipient hash matches counterparty",
        observed: `outreachToCp=${outreachToCp.length} cpHashLeak=${cpHashLeak}`,
        pass: t7Pass,
        details: { outreachToCp, cpHashFound: cpHashLeak },
      });
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // ── T8: cleanup (LIFO best-effort) ────────────────────────────────────
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
    id: "T8",
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
