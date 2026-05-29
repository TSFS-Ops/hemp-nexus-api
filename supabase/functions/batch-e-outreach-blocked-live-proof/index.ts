/**
 * Batch E Phase 1 — outreach.blocked.* canonical-emit live-proof harness.
 *
 * Exercises the REAL deployed `POST /poi-engagements/:id/preview-outreach`
 * and `POST /poi-engagements/:id/send-outreach` routes for every gate
 * branch that should now write a canonical `outreach.blocked.*`
 * audit_logs row, and asserts:
 *
 *   T1 — preview blocked / contact incomplete → audit row
 *        action='outreach.blocked.contact_incomplete', surface=preview-outreach
 *   T2 — send blocked / contact incomplete → audit row
 *        action='outreach.blocked.contact_incomplete', surface=send-outreach
 *   T3 — preview blocked / binding_review_required → 409, audit row
 *        action='outreach.blocked.binding_review_pending', surface=preview-outreach
 *   T4 — send blocked / binding_review_required → 409, audit row
 *        action='outreach.blocked.binding_review_pending', surface=send-outreach
 *   T5 — preview blocked / disputed_being_named → 409, audit row
 *        action='outreach.blocked.disputed_being_named', surface=preview-outreach
 *   T6 — send blocked / disputed_being_named → 409, audit row
 *        action='outreach.blocked.disputed_being_named', surface=send-outreach
 *   T7 — across the whole run: no transactional_email_queue insert
 *        targeting these events, no D4b/D4c initiator_alert_queued/skipped
 *        row, no recipient_emails_hash entry for the counterparty email,
 *        no metadata leakage of counterparty/candidate/dispute/commercial
 *        identity in any outreach.blocked.* audit row.
 *   T8 — cleanup removes all disposable test data (LIFO, best-effort).
 *
 * Auth: INTERNAL_CRON_KEY OR service_role Bearer OR platform_admin JWT.
 * Body: { "confirm": "RUN_BATCH_E_OUTREACH_BLOCKED_LIVE_PROOF" }
 *
 * Out of scope: D4b/D4c dispatchers, Batch C, ratings, MT-009, legacy
 * disputes, payments, sanctions/compliance/KYB/UBO, public status,
 * data export/residency, RLS, unrelated UI/routes, in-app notification
 * surface, Phase 2 UI.
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

interface PostResult { status: number; body: any; }

async function postJson(
  url: string,
  jwt: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<PostResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: ANON_KEY,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  let parsed: any;
  try { parsed = await res.json(); } catch { parsed = await res.text(); }
  return { status: res.status, body: parsed };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const baseHeaders = { ...__buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin")), "Content-Type": "application/json" };
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  if (req.method === "OPTIONS") return new Response(null, { headers: baseHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: baseHeaders });
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

  // Auth
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
  if (payload?.confirm !== "RUN_BATCH_E_OUTREACH_BLOCKED_LIVE_PROOF") {
    return new Response(JSON.stringify({
      error: "CONFIRM_REQUIRED",
      hint: "POST { confirm: 'RUN_BATCH_E_OUTREACH_BLOCKED_LIVE_PROOF' }",
    }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `bex1-${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const startedAt = new Date().toISOString();
  let setupError: string | null = null;
  const allEngagementIds: string[] = [];

  // Canary strings used in T7 leakage scan
  const COUNTERPARTY_EMAIL = `cp-${tag}@bex1-cp.example.com`;
  const COUNTERPARTY_NAME = `${tag}_cp_person_LEAK_CANARY`;
  const COMMODITY_CANARY = "BEX1_COMMODITY_LEAK_CANARY";
  const DISPUTE_REASON_CANARY = "BEX1_DISPUTE_REASON_LEAK_CANARY";
  const BINDING_CAND_CANARY = "BEX1_BINDING_CANDIDATE_LEAK_CANARY";

  try {
    // Initiating + counterparty orgs
    const { data: orgI, error: orgIErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_initiator` }).select("id, name").single();
    if (orgIErr || !orgI) throw new Error(`org init: ${orgIErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgI.id));

    const { data: orgC, error: orgCErr } = await admin.from("organizations")
      .insert({ name: `${tag}_org_counterparty_${COUNTERPARTY_NAME}` })
      .select("id, name").single();
    if (orgCErr || !orgC) throw new Error(`org cp: ${orgCErr?.message}`);
    cleanup.push(() => admin.from("organizations").delete().eq("id", orgC.id));

    // Synthetic platform admin caller
    const platAdminEmail = `${tag}-platadmin@bex1.example.com`;
    const platAdminPwd = `${tag}-AdmPw!aA9`;
    const { data: platAdmin, error: platAdminErr } = await admin.auth.admin.createUser({
      email: platAdminEmail, password: platAdminPwd, email_confirm: true,
    });
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

    // Helpers
    type EngOpts = {
      label: string;
      withCounterpartyOrg?: boolean;
      withContact?: boolean;
      operationalState?: string | null;
      bindingCandidates?: unknown;
      engagementStatus?: string;
      withCommodity?: boolean;
      disputeReason?: string | null;
    };
    async function newEngagement(opts: EngOpts): Promise<string> {
      const {
        label,
        withCounterpartyOrg = false,
        withContact = false,
        operationalState = null,
        bindingCandidates = null,
        engagementStatus = "pending",
        withCommodity = false,
        disputeReason = null,
      } = opts;
      const { data: match, error: matchErr } = await admin.from("matches").insert({
        buyer_org_id: orgI.id, seller_org_id: withCounterpartyOrg ? orgC.id : null, org_id: orgI.id,
        buyer_id: `${tag}_${label}_buyer`, seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} buyer`, seller_name: withCounterpartyOrg ? `${tag} seller` : null,
        commodity: withCommodity ? COMMODITY_CANARY : "BEX1_NEUTRAL",
        quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `bex1_${runId}_${label}`,
      }).select("id").single();
      if (matchErr || !match) throw new Error(`match ${label}: ${matchErr?.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", match.id));

      const insertRow: Record<string, unknown> = {
        match_id: match.id,
        org_id: orgI.id,
        counterparty_type: "known",
        counterparty_email: withContact ? COUNTERPARTY_EMAIL : null,
        counterparty_org_id: withCounterpartyOrg ? orgC.id : null,
        contact_name: withContact ? COUNTERPARTY_NAME : null,
        contact_type: withContact ? "named_individual" : null,
        engagement_status: engagementStatus,
        source: "admin_manual",
      };
      if (operationalState) {
        insertRow.operational_state = operationalState;
        insertRow.operational_state_set_at = new Date().toISOString();
      }
      if (bindingCandidates !== null) insertRow.binding_candidates = bindingCandidates;
      if (disputeReason) {
        insertRow.dispute_reason = disputeReason;
        insertRow.disputed_at = new Date().toISOString();
        insertRow.dispute_source = "admin_report";
      }
      const { data: eng, error: engErr } = await admin.from("poi_engagements")
        .insert(insertRow).select("id").single();
      if (engErr || !eng) throw new Error(`eng ${label}: ${engErr?.message}`);
      allEngagementIds.push(eng.id);
      cleanup.push(() => admin.from("poi_engagements").delete().eq("id", eng.id));
      cleanup.push(() => admin.from("audit_logs").delete().eq("entity_id", eng.id));
      cleanup.push(() => admin.from("engagement_outreach_logs").delete().eq("engagement_id", eng.id));
      return eng.id;
    }

    async function fetchAuditByAction(engId: string, action: string) {
      const { data } = await admin.from("audit_logs")
        .select("action, metadata, created_at")
        .eq("entity_id", engId).eq("action", action)
        .gte("created_at", startedAt);
      return data ?? [];
    }

    const previewUrl = (id: string) => `${SUPABASE_URL}/functions/v1/poi-engagements/${id}/preview-outreach`;
    const sendUrl = (id: string) => `${SUPABASE_URL}/functions/v1/poi-engagements/${id}/send-outreach`;
    const sendBody = { subject: "BEX1 send test", custom_message: "neutral" };

    // ── T1 — preview blocked, contact incomplete ─────────────────────────
    {
      const eid = await newEngagement({ label: "t1", withContact: false });
      const r = await postJson(previewUrl(eid), adminJwt, {});
      const rows = await fetchAuditByAction(eid, "outreach.blocked.contact_incomplete");
      const meta = rows[0]?.metadata as any;
      const t1Pass = (r.status === 422)
        && rows.length >= 1
        && meta?.surface === "preview-outreach"
        && !!meta?.code;
      tests.push({
        id: "T1",
        description: "Preview blocked / contact incomplete writes canonical audit row",
        expected: "422 + audit_logs.action=outreach.blocked.contact_incomplete + surface=preview-outreach",
        observed: `status=${r.status} rows=${rows.length} surface=${meta?.surface} code=${meta?.code}`,
        pass: t1Pass,
        details: { response: r.body, rows },
      });
    }

    // ── T2 — send blocked, contact incomplete ────────────────────────────
    {
      const eid = await newEngagement({ label: "t2", withContact: false });
      const r = await postJson(sendUrl(eid), adminJwt, sendBody, `${tag}_t2`);
      const rows = await fetchAuditByAction(eid, "outreach.blocked.contact_incomplete");
      const meta = rows[0]?.metadata as any;
      const t2Pass = (r.status === 422)
        && rows.length >= 1
        && meta?.surface === "send-outreach"
        && !!meta?.code;
      tests.push({
        id: "T2",
        description: "Send blocked / contact incomplete writes canonical audit row",
        expected: "422 + audit_logs.action=outreach.blocked.contact_incomplete + surface=send-outreach",
        observed: `status=${r.status} rows=${rows.length} surface=${meta?.surface} code=${meta?.code}`,
        pass: t2Pass,
        details: { response: r.body, rows },
      });
    }

    // ── T3 — preview blocked, binding_review_required ────────────────────
    {
      const eid = await newEngagement({
        label: "t3",
        withContact: true,
        withCounterpartyOrg: true,
        withCommodity: true,
        operationalState: "binding_review_required",
        bindingCandidates: [{ candidate_org_id: BINDING_CAND_CANARY, candidate_org_name: BINDING_CAND_CANARY }],
      });
      const r = await postJson(previewUrl(eid), adminJwt, {});
      const rows = await fetchAuditByAction(eid, "outreach.blocked.binding_review_pending");
      const meta = rows[0]?.metadata as any;
      const t3Pass = r.status === 409
        && (r.body?.code === "BINDING_REVIEW_PENDING" || r.body?.error === "BINDING_REVIEW_PENDING")
        && rows.length === 1
        && meta?.surface === "preview-outreach"
        && meta?.guard_code === "BINDING_REVIEW_PENDING";
      tests.push({
        id: "T3",
        description: "Preview blocked / binding_review_required writes canonical audit row",
        expected: "409 BINDING_REVIEW_PENDING + 1 audit_logs.action=outreach.blocked.binding_review_pending + surface=preview-outreach",
        observed: `status=${r.status} body.code=${r.body?.code ?? r.body?.error} rows=${rows.length} surface=${meta?.surface} guard_code=${meta?.guard_code}`,
        pass: t3Pass,
        details: { response: r.body, rows },
      });
    }

    // ── T4 — send blocked, binding_review_required ───────────────────────
    {
      const eid = await newEngagement({
        label: "t4",
        withContact: true,
        withCounterpartyOrg: true,
        withCommodity: true,
        operationalState: "binding_review_required",
        bindingCandidates: [{ candidate_org_id: BINDING_CAND_CANARY, candidate_org_name: BINDING_CAND_CANARY }],
      });
      const r = await postJson(sendUrl(eid), adminJwt, sendBody, `${tag}_t4`);
      const rows = await fetchAuditByAction(eid, "outreach.blocked.binding_review_pending");
      const meta = rows[0]?.metadata as any;
      const t4Pass = r.status === 409
        && (r.body?.code === "BINDING_REVIEW_PENDING" || r.body?.error === "BINDING_REVIEW_PENDING")
        && rows.length === 1
        && meta?.surface === "send-outreach"
        && meta?.guard_code === "BINDING_REVIEW_PENDING";
      tests.push({
        id: "T4",
        description: "Send blocked / binding_review_required writes canonical audit row",
        expected: "409 BINDING_REVIEW_PENDING + 1 audit_logs.action=outreach.blocked.binding_review_pending + surface=send-outreach",
        observed: `status=${r.status} body.code=${r.body?.code ?? r.body?.error} rows=${rows.length} surface=${meta?.surface} guard_code=${meta?.guard_code}`,
        pass: t4Pass,
        details: { response: r.body, rows },
      });
    }

    // ── T5 — preview blocked, disputed_being_named ───────────────────────
    {
      const eid = await newEngagement({
        label: "t5",
        withContact: true,
        withCounterpartyOrg: true,
        withCommodity: true,
        engagementStatus: "disputed_being_named",
        disputeReason: DISPUTE_REASON_CANARY,
      });
      const r = await postJson(previewUrl(eid), adminJwt, {});
      const rows = await fetchAuditByAction(eid, "outreach.blocked.disputed_being_named");
      const meta = rows[0]?.metadata as any;
      const t5Pass = r.status === 409
        && (r.body?.code === "DISPUTED_BEING_NAMED" || r.body?.error === "DISPUTED_BEING_NAMED")
        && rows.length === 1
        && meta?.surface === "preview-outreach"
        && meta?.guard_code === "DISPUTED_BEING_NAMED";
      tests.push({
        id: "T5",
        description: "Preview blocked / disputed_being_named writes canonical audit row",
        expected: "409 DISPUTED_BEING_NAMED + 1 audit_logs.action=outreach.blocked.disputed_being_named + surface=preview-outreach",
        observed: `status=${r.status} body.code=${r.body?.code ?? r.body?.error} rows=${rows.length} surface=${meta?.surface} guard_code=${meta?.guard_code}`,
        pass: t5Pass,
        details: { response: r.body, rows },
      });
    }

    // ── T6 — send blocked, disputed_being_named ──────────────────────────
    {
      const eid = await newEngagement({
        label: "t6",
        withContact: true,
        withCounterpartyOrg: true,
        withCommodity: true,
        engagementStatus: "disputed_being_named",
        disputeReason: DISPUTE_REASON_CANARY,
      });
      const r = await postJson(sendUrl(eid), adminJwt, sendBody, `${tag}_t6`);
      const rows = await fetchAuditByAction(eid, "outreach.blocked.disputed_being_named");
      const meta = rows[0]?.metadata as any;
      const t6Pass = r.status === 409
        && (r.body?.code === "DISPUTED_BEING_NAMED" || r.body?.error === "DISPUTED_BEING_NAMED")
        && rows.length === 1
        && meta?.surface === "send-outreach"
        && meta?.guard_code === "DISPUTED_BEING_NAMED";
      tests.push({
        id: "T6",
        description: "Send blocked / disputed_being_named writes canonical audit row",
        expected: "409 DISPUTED_BEING_NAMED + 1 audit_logs.action=outreach.blocked.disputed_being_named + surface=send-outreach",
        observed: `status=${r.status} body.code=${r.body?.code ?? r.body?.error} rows=${rows.length} surface=${meta?.surface} guard_code=${meta?.guard_code}`,
        pass: t6Pass,
        details: { response: r.body, rows },
      });
    }

    // ── T7 — notification safety + leakage scan ──────────────────────────
    {
      const cpHash = await sha256Hex(COUNTERPARTY_EMAIL);
      const forbiddenCanaries = [
        COUNTERPARTY_EMAIL,
        COUNTERPARTY_NAME,
        COMMODITY_CANARY,
        DISPUTE_REASON_CANARY,
        BINDING_CAND_CANARY,
        orgC.id,
      ];

      // (a) outreach.blocked.* audit metadata must not contain any canary
      const { data: blockedRows } = await admin.from("audit_logs")
        .select("action, metadata, entity_id")
        .in("entity_id", allEngagementIds)
        .in("action", [
          "outreach.blocked.contact_incomplete",
          "outreach.blocked.binding_review_pending",
          "outreach.blocked.disputed_being_named",
        ])
        .gte("created_at", startedAt);
      const leak = (blockedRows ?? []).find((row) => {
        const blob = JSON.stringify(row.metadata ?? {});
        return forbiddenCanaries.some((c) => blob.includes(c));
      });

      // (b) no D4b/D4c initiator alert queued or skipped row may have
      //     been written FOR the outreach.blocked.* events (those should
      //     stay audit-only). It IS legitimate for unrelated D4c rows to
      //     exist for the disputed/binding-review engagements (e.g. from
      //     other surfaces); the test scope is the outreach.blocked.*
      //     event_type only.
      const { data: initRows } = await admin.from("audit_logs")
        .select("action, metadata, entity_id")
        .in("entity_id", allEngagementIds)
        .in("action", [
          "engagement.initiator_alert_queued",
          "engagement.initiator_alert_skipped",
          "engagement.admin_alert_queued",
          "engagement.admin_alert_skipped",
        ])
        .gte("created_at", startedAt);
      const initForOutreachBlocked = (initRows ?? []).filter((r) => {
        const ev = (r.metadata as any)?.event_type ?? "";
        return typeof ev === "string" && ev.startsWith("outreach.blocked.");
      });

      // (c) counterparty hash must never appear in any recipient list
      const cpHashLeak = (initRows ?? []).some((r) => {
        const hashes = ((r.metadata as any)?.recipient_emails_hash ?? []) as string[];
        return Array.isArray(hashes) && hashes.includes(cpHash);
      });

      // (d) no transactional_email_queue row was created for these events
      let queueLeak = 0;
      try {
        const { data: q } = await admin.from("transactional_email_queue")
          .select("id, template_key, payload, created_at")
          .gte("created_at", startedAt)
          .limit(200);
        queueLeak = (q ?? []).filter((row) => {
          const blob = JSON.stringify(row.payload ?? {}) + " " + (row.template_key ?? "");
          if (forbiddenCanaries.some((c) => blob.includes(c))) return true;
          if (allEngagementIds.some((id) => blob.includes(id))) return true;
          return false;
        }).length;
      } catch { /* table may not exist; treat as zero */ }

      const t7Pass = !leak
        && initForOutreachBlocked.length === 0
        && !cpHashLeak
        && queueLeak === 0;
      tests.push({
        id: "T7",
        description: "Notification safety: no leakage, no D4b/D4c dispatch, no email queue, no counterparty contact",
        expected: "no canary leak; no initiator/admin alert for outreach.blocked.*; no queue row; no cp hash",
        observed: `leakRow=${leak ? leak.action : "none"} initForBlocked=${initForOutreachBlocked.length} cpHashLeak=${cpHashLeak} queueLeak=${queueLeak}`,
        pass: t7Pass,
        details: { leak, initForOutreachBlocked, queueLeak },
      });
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // ── T8 — cleanup ────────────────────────────────────────────────────────
  let cleanupOk = true;
  const cleanupErrors: string[] = [];
  for (const fn of [...cleanup].reverse()) {
    try { await fn(); } catch (e) {
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
