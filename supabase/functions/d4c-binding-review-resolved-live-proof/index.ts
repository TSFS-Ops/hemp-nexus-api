/**
 * Batch D — D4c-3b Production Binding-Review-Resolved live-proof harness.
 *
 * Exercises the REAL deployed `poi-engagements` POST
 * `/resolve-binding` route end-to-end and asserts the D4c-3b
 * initiator-side wiring (`dispatchD4cInitiatorAlert`):
 *
 *   T1. confirmed_canonical resolution closes review
 *       (binding_resolution='confirmed_canonical', operational_state=NULL).
 *   T2. Exactly ONE `engagement.initiator_alert_queued` audit row is
 *       written for `engagement.binding_review_resolved` with stable
 *       dedupe_key=`binding_review_resolved:<engagementId>`.
 *   T3. Recipient resolution targeted only the initiating-org admin
 *       (recipient_user_ids matches the initiating-org admin we minted).
 *   T4. NO counterparty / candidate / disputed / external recipient
 *       audit footprint exists for this engagement.
 *   T5. Repeating the same resolve call returns
 *       409 BINDING_REVIEW_ALREADY_RESOLVED and does NOT write a second
 *       initiator_alert_queued row.
 *   T6. The `rejected` branch (which reasserts binding_review_required)
 *       does NOT write any `initiator_alert_queued` row for
 *       `engagement.binding_review_resolved`.
 *   T7. A hard-suppressed initiating-org admin: resolve still succeeds,
 *       no `initiator_alert_queued` row, no leakage.
 *   T8. Cleanup removes all disposable test data (LIFO, best-effort).
 *
 * Invocation:
 *   POST /functions/v1/d4c-binding-review-resolved-live-proof
 *   Headers: x-internal-key: <INTERNAL_CRON_KEY>
 *   Body:    { "confirm": "RUN_D4C_BINDING_REVIEW_RESOLVED_LIVE_PROOF" }
 *
 * Auth: INTERNAL_CRON_KEY OR service_role Bearer OR platform_admin JWT.
 *
 * EXPLICITLY OUT OF SCOPE: every other D4c event, Batch C, ratings,
 * MT-009, legacy disputes, payments, sanctions/compliance/KYB/UBO,
 * public status, data export/residency, RLS, unrelated UI/routes,
 * DOCX/client walkthroughs, in-app notification surface.
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

async function postResolve(
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
    `${edgeBase}/functions/v1/poi-engagements/${engagementId}/resolve-binding`,
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
  const baseHeaders = { ...__buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin")), "Content-Type": "application/json" };
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
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
  if (payload?.confirm !== "RUN_D4C_BINDING_REVIEW_RESOLVED_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_D4C_BINDING_REVIEW_RESOLVED_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d4c3b-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const startedAt = new Date().toISOString();
  let setupError: string | null = null;

  try {
    // ── Provision initiating org + canonical org for confirmed_canonical
    const { data: orgI, error: orgIErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_initiator` })
      .select("id, name").single();
    if (orgIErr || !orgI) throw new Error(`org init: ${orgIErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgI.id));

    const { data: orgCanon, error: orgCanonErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_canonical` })
      .select("id, name").single();
    if (orgCanonErr || !orgCanon) throw new Error(`org canon: ${orgCanonErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgCanon.id));

    // ── Mint initiating-org admin (active profile + org_admin role) ────
    const initAdminEmail = `${tag}-init-admin@d4c3b.example.com`;
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
        .upsert({ user_id: initAdmin.user.id, role: "org_admin" }, { onConflict: "user_id,role" });
      if (rErr) throw new Error(`init admin role: ${rErr.message}`);
      cleanup.push(() => admin.from("user_roles")
        .delete().eq("user_id", initAdmin.user!.id).eq("role", "org_admin"));
    }

    // ── Mint synthetic platform_admin used for every resolve call ──────
    const platAdminEmail = `${tag}-platadmin@d4c3b.example.com`;
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

    // ── Helper: create a fresh engagement parked in binding_review_required
    async function newReviewEngagement(label: string): Promise<string> {
      const { data: match, error: matchErr } = await admin.from("matches").insert({
        buyer_org_id: orgI.id, seller_org_id: orgCanon.id, org_id: orgI.id,
        buyer_id: `${tag}_${label}_buyer`, seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} buyer`, seller_name: `${tag} seller`,
        commodity: "TEST_D4C_BRR", quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d4c3b_${runId}_${label}`,
      }).select("id").single();
      if (matchErr || !match) throw new Error(`match ${label}: ${matchErr?.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", match.id));

      // Create engagement parked in binding_review_required with binding_candidates set.
      const { data: eng, error: engErr } = await admin.from("poi_engagements").insert({
        match_id: match.id,
        org_id: orgI.id,
        // counterparty_org_id intentionally null — review must select canonical.
        counterparty_email: `cp-${label}-${tag}@d4c3b-cp.example.com`,
        counterparty_type: "known",
        engagement_status: "contacted",
        contact_type: "organisation",
        source: "admin_manual",
        operational_state: "binding_review_required",
        binding_candidates: [
          { org_id: orgCanon.id, email: `cp-${label}-${tag}@d4c3b-cp.example.com` },
        ],
      }).select("id").single();
      if (engErr || !eng) throw new Error(`eng ${label}: ${engErr?.message}`);
      cleanup.push(() => admin.from("poi_engagements").delete().eq("id", eng.id));
      cleanup.push(() => admin.from("audit_logs").delete().eq("entity_id", eng.id));
      cleanup.push(() => admin.from("engagement_outreach_logs").delete().eq("engagement_id", eng.id));
      return eng.id;
    }

    async function fetchEng(id: string) {
      const { data } = await admin.from("poi_engagements")
        .select("operational_state, binding_resolution, counterparty_org_id")
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

    // ── T1+T2+T3+T4: confirmed_canonical happy path ────────────────────
    const eid1 = await newReviewEngagement("t1");
    const r1 = await postResolve(SUPABASE_URL, adminJwt, eid1, {
      resolution: "confirmed_canonical",
      selected_org_id: orgCanon.id,
      notes: "D4c-3b live-proof: confirming canonical org for harness run.",
    }, `${tag}_t1`);
    const row1 = await fetchEng(eid1);
    const queued1 = await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued");

    const t1Pass = r1.status === 200
      && row1?.binding_resolution === "confirmed_canonical"
      && row1?.operational_state === null;
    tests.push({
      id: "T1",
      description: "confirmed_canonical resolution closes binding review",
      expected: "200 + binding_resolution=confirmed_canonical + operational_state=null",
      observed: `status=${r1.status} binding_resolution=${row1?.binding_resolution} op_state=${row1?.operational_state}`,
      pass: t1Pass,
      details: { response: r1.body, row: row1 },
    });

    const t2Pass = queued1.length === 1
      && queued1[0].metadata?.event_type === "engagement.binding_review_resolved"
      && queued1[0].metadata?.source_function === "poi-engagements"
      && queued1[0].metadata?.dedupe_key === `binding_review_resolved:${eid1}`;
    tests.push({
      id: "T2",
      description: "Exactly one initiator_alert_queued row for binding_review_resolved",
      expected: "1 row, event=engagement.binding_review_resolved, source=poi-engagements, stable dedupe_key",
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

    // T4: scan ALL initiator_alert_* audit metadata for leakage.
    const { data: allAuditRows } = await admin.from("audit_logs")
      .select("action, metadata")
      .eq("entity_id", eid1)
      .gte("created_at", startedAt);
    const initiatorRows = (allAuditRows ?? []).filter((r) =>
      r.action === "engagement.initiator_alert_queued" ||
      r.action === "engagement.initiator_alert_skipped");
    const forbidden = [
      `cp-t1-${tag}@d4c3b-cp.example.com`,
      orgCanon.name,
      orgCanon.id,
    ];
    const leak = initiatorRows.find((r) => {
      const blob = JSON.stringify(r.metadata ?? {});
      return forbidden.some((f) => blob.includes(f));
    });
    const t4Pass = !leak;
    tests.push({
      id: "T4",
      description: "No counterparty/candidate/external leakage in initiator audit metadata",
      expected: "no initiator_alert_* row references counterparty email, candidate org name or id",
      observed: leak
        ? `LEAK in ${leak.action}: ${JSON.stringify(leak.metadata).slice(0, 300)}`
        : `${initiatorRows.length} initiator audit row(s), none reference forbidden values`,
      pass: t4Pass,
      details: { initiatorRows, forbidden },
    });

    // ── T5: replay resolve → 409 + no new alert ────────────────────────
    const r1b = await postResolve(SUPABASE_URL, adminJwt, eid1, {
      resolution: "confirmed_canonical",
      selected_org_id: orgCanon.id,
      notes: "D4c-3b live-proof replay: must be 409 already-resolved.",
    }, `${tag}_t1_replay`);
    const queued1b = await fetchInitiatorAuditRows(eid1, "engagement.initiator_alert_queued");
    const t5Pass = r1b.status === 409
      && queued1b.length === 1;
    tests.push({
      id: "T5",
      description: "Repeating the resolution does not duplicate the initiator alert",
      expected: "409 BINDING_REVIEW_ALREADY_RESOLVED and queued audit count stays at 1",
      observed: `status=${r1b.status} queuedCount=${queued1b.length}`,
      pass: t5Pass,
      details: { response: r1b.body },
    });

    // ── T6: rejected branch must NOT emit binding_review_resolved ──────
    {
      const eid6 = await newReviewEngagement("t6");
      const r6 = await postResolve(SUPABASE_URL, adminJwt, eid6, {
        resolution: "rejected",
        notes: "D4c-3b live-proof: rejected branch must reassert review and skip notice.",
      }, `${tag}_t6`);
      const row6 = await fetchEng(eid6);
      const queued6 = await fetchInitiatorAuditRows(eid6, "engagement.initiator_alert_queued");
      const t6Pass = r6.status === 200
        && row6?.binding_resolution === "rejected"
        && row6?.operational_state === "binding_review_required"
        && queued6.length === 0;
      tests.push({
        id: "T6",
        description: "rejected branch reasserts review and does NOT send binding_review_resolved",
        expected: "200, binding_resolution=rejected, operational_state=binding_review_required, queued=0",
        observed: `status=${r6.status} binding_resolution=${row6?.binding_resolution} op_state=${row6?.operational_state} queued=${queued6.length}`,
        pass: t6Pass,
        details: { response: r6.body, row: row6 },
      });
    }

    // ── T7: hard-suppressed initiating admin → resolve still succeeds,
    //          no queued row, no leakage ───────────────────────────────
    {
      const eid7 = await newReviewEngagement("t7");
      const { error: supErr } = await admin.from("suppressed_emails").upsert({
        email: initAdminEmail.toLowerCase(),
        reason: "bounce",
      }, { onConflict: "email" });
      if (supErr) throw new Error(`suppress seed: ${supErr.message}`);
      cleanup.push(() => admin.from("suppressed_emails")
        .delete().eq("email", initAdminEmail.toLowerCase()));

      const r7 = await postResolve(SUPABASE_URL, adminJwt, eid7, {
        resolution: "deferred_no_review_needed",
        notes: "D4c-3b live-proof: deferred branch with hard-suppressed admin.",
      }, `${tag}_t7`);
      const row7 = await fetchEng(eid7);
      const queued7 = await fetchInitiatorAuditRows(eid7, "engagement.initiator_alert_queued");
      const skipped7 = await fetchInitiatorAuditRows(eid7, "engagement.initiator_alert_skipped");
      const allInit7 = [...queued7, ...skipped7];
      const leak7 = allInit7.find((r) => {
        const blob = JSON.stringify(r.metadata ?? {});
        return [`cp-t7-${tag}@d4c3b-cp.example.com`, orgCanon.name, orgCanon.id]
          .some((f) => blob.includes(f));
      });
      const t7Pass = r7.status === 200
        && row7?.binding_resolution === "deferred_no_review_needed"
        && row7?.operational_state === null
        && queued7.length === 0
        && !leak7;
      tests.push({
        id: "T7",
        description: "Hard-suppressed initiating admin: resolve still succeeds, no queued alert, no leakage",
        expected: "resolve=200, review closed, queued=0, no counterparty leakage in initiator audit rows",
        observed: `status=${r7.status} binding_resolution=${row7?.binding_resolution} op_state=${row7?.operational_state} queued=${queued7.length} skipped=${skipped7.length} leak=${!!leak7}`,
        pass: t7Pass,
        details: { response: r7.body, queued7, skipped7 },
      });
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // ── T8: cleanup (LIFO best-effort) ───────────────────────────────────
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
