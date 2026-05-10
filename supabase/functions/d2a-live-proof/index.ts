// Batch D — D2a live proof harness.
// =================================================================
// Provisions ephemeral fixtures (org, platform_admin user, parent
// match, multiple poi_engagements rows) and exercises the deployed
// D2a endpoints + gates end-to-end against the real DB / RLS / CHECK
// constraints / audit pipeline. Tears everything down on the way out.
//
// Invocation:  POST { "confirm": "RUN_D2A_LIVE_PROOF" }
// Auth:        platform_admin OR INTERNAL_CRON_KEY (x-internal-key).
//
// Scope (D2a only):
//   ─ Dispute endpoint (admin_report happy path)
//   ─ Dispute endpoint (counterparty_token requires token_hash)
//   ─ Outreach gates (preview/send) for DISPUTED_BEING_NAMED
//   ─ Outreach gates (preview/send) for BINDING_REVIEW_PENDING
//   ─ Cancel-for-email-change endpoint
//   ─ PATCH email refusal after a contact_attempt log exists
//   ─ PATCH email allowed before any contact_attempt log
//   ─ Progression guard live decision for the three new codes
//
// EXPLICITLY OUT OF SCOPE: D2b binding resolver, D3 admin UI, MT-009
// named-contact enforcement, fixtures/DOCX/notifications/ratings/legacy
// disputes — none of those code paths are touched.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { assertEngagementAllowsProgression } from "../_shared/engagement-progression-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PASSWORD = "D2aLiveProof!" + crypto.randomUUID().slice(0, 8);

const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type TestRecord = {
  id: string;
  description: string;
  route: string;
  expected: string;
  observed: string;
  pass: boolean;
  details?: unknown;
};

async function signIn(email: string, password: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) { try { await r.text(); } catch { /* ignore */ } return null; }
  const j = await r.json();
  return j.access_token ?? null;
}

async function callEdge(
  fnPath: string,
  token: string,
  method: string,
  body: Record<string, unknown> | null,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fnPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  let j: any = null;
  try { j = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body: j };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: baseHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: baseHeaders });
  }

  const internalKey = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const presented = req.headers.get("x-internal-key") ?? "";
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE);
  let authorized = false;
  if (internalKey && presented && presented === internalKey) {
    authorized = true;
  } else {
    const authz = req.headers.get("authorization");
    if (authz?.startsWith("Bearer ")) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } });
      const { data: u } = await userClient.auth.getUser();
      if (u?.user) {
        const { data: isAdminCaller } = await admin.rpc("is_admin", { user_id: u.user.id });
        if (isAdminCaller) authorized = true;
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "FORBIDDEN", message: "platform_admin or INTERNAL_CRON_KEY required" }), { status: 403, headers: baseHeaders });
  }

  let payload: any;
  try { payload = await req.json(); } catch { payload = {}; }
  if (payload?.confirm !== "RUN_D2A_LIVE_PROOF") {
    return new Response(JSON.stringify({ error: "CONFIRM_REQUIRED", hint: "POST { confirm: 'RUN_D2A_LIVE_PROOF' }" }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d2a_${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const record = (t: TestRecord) => { tests.push(t); };

  let setupError: string | null = null;
  let cleanupNotes: string[] = [];

  try {
    // ─── Setup ────────────────────────────────────────────────
    const { data: orgA, error: oErrA } = await admin.from("organizations").insert({ name: `${tag}_orgA_buyer` }).select("id").single();
    const { data: orgB, error: oErrB } = await admin.from("organizations").insert({ name: `${tag}_orgB_seller` }).select("id").single();
    if (oErrA || oErrB || !orgA || !orgB) throw new Error(`org create: ${oErrA?.message ?? oErrB?.message}`);
    cleanup.push(() => admin.from("organizations").delete().in("id", [orgA.id, orgB.id]));

    // Platform admin user.
    const adminEmail = `${tag}_admin@d2a.test.invalid`;
    const { data: createdAdmin, error: caErr } = await admin.auth.admin.createUser({
      email: adminEmail, password: PASSWORD, email_confirm: true,
    });
    if (caErr || !createdAdmin.user) throw new Error(`createUser admin: ${caErr?.message}`);
    const adminUid = createdAdmin.user.id;
    cleanup.push(() => admin.auth.admin.deleteUser(adminUid));
    const { data: priorProfile } = await admin.from("profiles").select("org_id").eq("id", adminUid).maybeSingle();
    const autoOrgId = priorProfile?.org_id ?? null;
    await admin.from("user_roles").delete().eq("user_id", adminUid);
    await admin.from("profiles").upsert({ id: adminUid, org_id: null, full_name: "D2a Platform Admin", email: adminEmail });
    cleanup.push(() => admin.from("profiles").delete().eq("id", adminUid));
    if (autoOrgId && autoOrgId !== orgA.id && autoOrgId !== orgB.id) {
      cleanup.push(() => admin.from("organizations").delete().eq("id", autoOrgId));
    }
    await admin.from("user_roles").insert({ user_id: adminUid, role: "platform_admin" });
    const adminToken = await signIn(adminEmail, PASSWORD);
    if (!adminToken) throw new Error("admin signIn failed");

    // Helper: create a parent match owned by orgA.
    const mkMatch = async (label: string): Promise<string> => {
      const { data: m, error: e } = await admin.from("matches").insert({
        buyer_org_id: orgA.id,
        seller_org_id: orgB.id,
        org_id: orgA.id,
        buyer_id: `${tag}_${label}_buyer`,
        seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} ${label} buyer`,
        seller_name: `${tag} ${label} seller`,
        commodity: "TEST_D2A",
        quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d2a_${runId}_${label}`,
      }).select("id").single();
      if (e) throw new Error(`create match ${label}: ${e.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", m!.id));
      return m!.id as string;
    };

    // Helper: create an engagement on the given match.
    const mkEng = async (
      matchId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> => {
      const seed: Record<string, unknown> = {
        match_id: matchId,
        org_id: orgA.id,
        counterparty_email: `${tag}_cp_${crypto.randomUUID().slice(0, 6)}@d2a.test.invalid`,
        counterparty_type: "unknown",
        engagement_status: "pending",
        contact_type: "organisation",
        source: "admin_manual",
        ...overrides,
      };
      const { data: e, error: err } = await admin
        .from("poi_engagements")
        .insert(seed)
        .select("id")
        .single();
      if (err) throw new Error(`create engagement: ${err.message}`);
      cleanup.push(async () => {
        await admin.from("engagement_outreach_logs").delete().eq("engagement_id", e!.id);
        await admin.from("poi_engagements").delete().eq("id", e!.id);
      });
      return e!.id as string;
    };

    const startedAt = new Date().toISOString();

    // ──────────────────────────────────────────────────────────
    // T1 — Dispute (admin_report) happy path
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t1");
      const engId = await mkEng(matchId);
      const r = await callEdge(
        `poi-engagements/${engId}/dispute`,
        adminToken,
        "POST",
        { dispute_source: "admin_report", reason: "Counterparty phoned in to deny involvement; recorded by admin during call." },
        { "Idempotency-Key": `${tag}_t1_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements")
        .select("engagement_status, operational_state, dispute_source, disputed_by_token_hash, dispute_reason, disputed_at")
        .eq("id", engId).maybeSingle();
      const { data: logs } = await admin
        .from("engagement_outreach_logs")
        .select("id, entry_type, new_status")
        .eq("engagement_id", engId)
        .eq("entry_type", "dispute_raised");
      const ok = r.status === 200
        && row?.engagement_status === "disputed_being_named"
        && row?.operational_state === "disputed_being_named"
        && row?.dispute_source === "admin_report"
        && row?.disputed_by_token_hash === null
        && (row?.dispute_reason ?? "").length > 0
        && !!row?.disputed_at
        && (logs?.length ?? 0) >= 1;
      record({
        id: "T1-dispute-admin-report",
        description: "Dispute admin_report → 200, row + audit log written, no token_hash",
        route: "POST /poi-engagements/:id/dispute",
        expected: "200, status=disputed_being_named, op_state=disputed_being_named, src=admin_report, token_hash null, dispute_raised log",
        observed: `status=${r.status} eng=${row?.engagement_status} op=${row?.operational_state} src=${row?.dispute_source} tok=${row?.disputed_by_token_hash} log_rows=${logs?.length ?? 0}`,
        pass: ok, details: { resp: r.body, row, logs },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T2 — Dispute counterparty_token without token → 400; row unchanged
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t2");
      const engId = await mkEng(matchId);
      const before = await admin.from("poi_engagements").select("engagement_status, dispute_source").eq("id", engId).maybeSingle();
      const r = await callEdge(
        `poi-engagements/${engId}/dispute`,
        adminToken,
        "POST",
        { dispute_source: "counterparty_token", reason: "Counterparty replied via tokenised link disputing identity." },
        { "Idempotency-Key": `${tag}_t2_${crypto.randomUUID()}` },
      );
      const after = await admin.from("poi_engagements").select("engagement_status, dispute_source").eq("id", engId).maybeSingle();
      const ok = r.status === 400
        && (r.body?.code === "VALIDATION_ERROR" || r.body?.error === "VALIDATION_ERROR")
        && after.data?.engagement_status === before.data?.engagement_status
        && after.data?.dispute_source === before.data?.dispute_source;
      record({
        id: "T2-dispute-token-missing",
        description: "Dispute counterparty_token without token_hash → 400 VALIDATION_ERROR; row unchanged",
        route: "POST /poi-engagements/:id/dispute",
        expected: "400 VALIDATION_ERROR; status/dispute_source unchanged",
        observed: `status=${r.status} code=${r.body?.code ?? r.body?.error} before=${before.data?.engagement_status} after=${after.data?.engagement_status}`,
        pass: ok, details: { resp: r.body, before: before.data, after: after.data },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T3 — Disputed engagement blocks preview-outreach + send-outreach
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t3");
      const engId = await mkEng(matchId, {
        engagement_status: "disputed_being_named",
        operational_state: "disputed_being_named",
        operational_state_set_by: adminUid,
        operational_state_set_at: new Date().toISOString(),
        disputed_at: new Date().toISOString(),
        dispute_source: "admin_report",
        dispute_reason: "Recorded for live proof harness binding/dispute gate test.",
      });

      const rPreview = await callEdge(
        `poi-engagements/${engId}/preview-outreach`,
        adminToken, "POST", {},
      );
      const previewOk = rPreview.status === 409
        && (rPreview.body?.code === "DISPUTED_BEING_NAMED" || rPreview.body?.error === "DISPUTED_BEING_NAMED");

      const rSend = await callEdge(
        `poi-engagements/${engId}/send-outreach`,
        adminToken, "POST",
        { subject: "D2a probe — should be blocked" },
        { "Idempotency-Key": `${tag}_t3_${crypto.randomUUID()}` },
      );
      const sendOk = rSend.status === 409
        && (rSend.body?.code === "DISPUTED_BEING_NAMED" || rSend.body?.error === "DISPUTED_BEING_NAMED");

      const { data: blockLogs } = await admin
        .from("engagement_outreach_logs")
        .select("id, entry_type, notes")
        .eq("engagement_id", engId)
        .eq("entry_type", "system_action")
        .order("created_at", { ascending: false });
      const auditOk = (blockLogs ?? []).some((row: any) => {
        try {
          const j = JSON.parse(row.notes ?? "{}");
          return j.guard_code === "DISPUTED_BEING_NAMED" && j.event === "outreach_blocked";
        } catch { return false; }
      });

      record({
        id: "T3-disputed-blocks-outreach",
        description: "Disputed engagement → preview+send return 409 DISPUTED_BEING_NAMED; send writes guard_code system_action log",
        route: "POST /poi-engagements/:id/preview-outreach + send-outreach",
        expected: "preview 409 DISPUTED_BEING_NAMED, send 409 DISPUTED_BEING_NAMED + audit row notes.guard_code=DISPUTED_BEING_NAMED",
        observed: `preview=${rPreview.status}/${rPreview.body?.code ?? rPreview.body?.error} send=${rSend.status}/${rSend.body?.code ?? rSend.body?.error} audit_match=${auditOk}`,
        pass: previewOk && sendOk && auditOk,
        details: { preview: rPreview.body, send: rSend.body, blockLogs },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T4 — Binding-review blocks preview-outreach + send-outreach
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t4");
      const engId = await mkEng(matchId, {
        engagement_status: "pending",
        operational_state: "binding_review_required",
        operational_state_set_by: adminUid,
        operational_state_set_at: new Date().toISOString(),
        binding_candidates: [{ org_id: orgB.id, label: "candidate" }],
        // binding_resolution intentionally null
      });

      const rPreview = await callEdge(
        `poi-engagements/${engId}/preview-outreach`,
        adminToken, "POST", {},
      );
      const previewOk = rPreview.status === 409
        && (rPreview.body?.code === "BINDING_REVIEW_PENDING" || rPreview.body?.error === "BINDING_REVIEW_PENDING");

      const rSend = await callEdge(
        `poi-engagements/${engId}/send-outreach`,
        adminToken, "POST",
        { subject: "D2a binding-review probe" },
        { "Idempotency-Key": `${tag}_t4_${crypto.randomUUID()}` },
      );
      const sendOk = rSend.status === 409
        && (rSend.body?.code === "BINDING_REVIEW_PENDING" || rSend.body?.error === "BINDING_REVIEW_PENDING");

      const { data: blockLogs } = await admin
        .from("engagement_outreach_logs")
        .select("id, entry_type, notes")
        .eq("engagement_id", engId)
        .eq("entry_type", "system_action");
      const auditOk = (blockLogs ?? []).some((row: any) => {
        try {
          const j = JSON.parse(row.notes ?? "{}");
          return j.guard_code === "BINDING_REVIEW_PENDING" && j.event === "outreach_blocked";
        } catch { return false; }
      });

      record({
        id: "T4-binding-review-blocks-outreach",
        description: "Binding-review engagement → preview+send return 409 BINDING_REVIEW_PENDING; send writes guard_code log",
        route: "POST /poi-engagements/:id/preview-outreach + send-outreach",
        expected: "preview 409 BINDING_REVIEW_PENDING, send 409 BINDING_REVIEW_PENDING + audit row notes.guard_code=BINDING_REVIEW_PENDING",
        observed: `preview=${rPreview.status}/${rPreview.body?.code ?? rPreview.body?.error} send=${rSend.status}/${rSend.body?.code ?? rSend.body?.error} audit_match=${auditOk}`,
        pass: previewOk && sendOk && auditOk,
        details: { preview: rPreview.body, send: rSend.body, blockLogs },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T5 — Cancel for email change
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t5");
      const oldEmail = `${tag}_t5old@d2a.test.invalid`;
      const engId = await mkEng(matchId, { counterparty_email: oldEmail });
      const newEmail = `${tag}_t5new@d2a.test.invalid`;

      const r = await callEdge(
        `poi-engagements/${engId}/cancel-for-email-change`,
        adminToken, "POST",
        { new_email: newEmail, reason: "Old address bounced; rep gave correct address by phone." },
        { "Idempotency-Key": `${tag}_t5_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements")
        .select("engagement_status, operational_state, cancelled_at, cancelled_reason, cancelled_by_user_id, counterparty_email")
        .eq("id", engId).maybeSingle();
      const { data: logs } = await admin
        .from("engagement_outreach_logs")
        .select("id, entry_type, notes")
        .eq("engagement_id", engId)
        .eq("entry_type", "cancelled");
      const notesOk = (logs ?? []).some((l: any) => {
        try {
          const j = JSON.parse(l.notes ?? "{}");
          return j.event === "cancelled_for_email_change"
            && j.old_email === oldEmail
            && j.new_email === newEmail;
        } catch { return false; }
      });
      const ok = r.status === 200
        && row?.engagement_status === "cancelled_email_change"
        && row?.operational_state === "cancelled_for_email_change"
        && !!row?.cancelled_at
        && row?.cancelled_reason === "email_change"
        && row?.cancelled_by_user_id === adminUid
        && notesOk;
      record({
        id: "T5-cancel-for-email-change",
        description: "Cancel-for-email-change → 200, status/op_state set, cancelled_* fields satisfy CHECK, log notes JSON has old/new email",
        route: "POST /poi-engagements/:id/cancel-for-email-change",
        expected: "200, status=cancelled_email_change, op=cancelled_for_email_change, cancelled_reason=email_change, cancelled_by_user_id=admin, cancelled log with old/new email",
        observed: `status=${r.status} eng=${row?.engagement_status} op=${row?.operational_state} reason=${row?.cancelled_reason} by=${row?.cancelled_by_user_id} notes_ok=${notesOk}`,
        pass: ok, details: { resp: r.body, row, logs },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T6 — PATCH email refusal after a contact_attempt log
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t6");
      const oldEmail = `${tag}_t6old@d2a.test.invalid`;
      const engId = await mkEng(matchId, { counterparty_email: oldEmail });
      // Seed a contact_attempt log (CHECK requires contact_method + contact_detail).
      const { error: seedErr } = await admin.from("engagement_outreach_logs").insert({
        engagement_id: engId,
        actor_type: "admin",
        admin_user_id: adminUid,
        admin_email: adminEmail,
        previous_status: "pending",
        new_status: "pending",
        entry_type: "contact_attempt",
        contact_method: "phone",
        contact_detail: "+27 11 555 0100",
        notes: "seed for T6 PATCH email refusal",
      });
      if (seedErr) throw new Error(`seed contact_attempt: ${seedErr.message}`);

      const newEmail = `${tag}_t6new@d2a.test.invalid`;
      const r = await callEdge(
        `poi-engagements/${engId}`,
        adminToken, "PATCH",
        { counterparty_email: newEmail },
        { "Idempotency-Key": `${tag}_t6_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements")
        .select("counterparty_email")
        .eq("id", engId).maybeSingle();
      const { data: refusalAudit } = await admin
        .from("audit_logs")
        .select("id, action, metadata")
        .eq("entity_id", engId)
        .eq("action", "engagement.email_change_refused")
        .gte("created_at", startedAt);
      const ok = r.status === 409
        && (r.body?.code === "EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE" || r.body?.error === "EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE")
        && row?.counterparty_email === oldEmail
        && (refusalAudit?.length ?? 0) >= 1;
      record({
        id: "T6-patch-email-refused-after-contact",
        description: "PATCH counterparty_email after a contact_attempt → 409 EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE; row unchanged; refusal audit row written",
        route: "PATCH /poi-engagements/:id",
        expected: "409 EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE, email unchanged, audit action=engagement.email_change_refused",
        observed: `status=${r.status} code=${r.body?.code ?? r.body?.error} email=${row?.counterparty_email} audit_rows=${refusalAudit?.length ?? 0}`,
        pass: ok, details: { resp: r.body, row, refusalAudit },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T7 — PATCH email allowed before any contact_attempt log
    // ──────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t7");
      const oldEmail = `${tag}_t7old@d2a.test.invalid`;
      const engId = await mkEng(matchId, { counterparty_email: oldEmail });
      const newEmail = `${tag}_t7new@d2a.test.invalid`;
      const r = await callEdge(
        `poi-engagements/${engId}`,
        adminToken, "PATCH",
        { counterparty_email: newEmail },
        { "Idempotency-Key": `${tag}_t7_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements").select("counterparty_email").eq("id", engId).maybeSingle();
      const { data: emailUpdateLogs } = await admin
        .from("engagement_outreach_logs")
        .select("id, entry_type, notes")
        .eq("engagement_id", engId)
        .eq("entry_type", "email_update");
      const ok = r.status === 200
        && (row?.counterparty_email ?? "").toLowerCase() === newEmail.toLowerCase();
      // email_update log is best-effort visibility — record it but don't gate on it.
      record({
        id: "T7-patch-email-allowed-pre-contact",
        description: "PATCH counterparty_email before any contact_attempt → 200; email updated; existing email_update logging path observable",
        route: "PATCH /poi-engagements/:id",
        expected: "200, counterparty_email=new",
        observed: `status=${r.status} email=${row?.counterparty_email} email_update_logs=${emailUpdateLogs?.length ?? 0}`,
        pass: ok, details: { resp: r.body, row, emailUpdateLogs },
      });
    }

    // ──────────────────────────────────────────────────────────
    // T8 — Progression-guard live decisions for all three new codes
    // ──────────────────────────────────────────────────────────
    {
      // T8a — disputed
      const matchA = await mkMatch("t8a");
      await mkEng(matchA, {
        engagement_status: "disputed_being_named",
        operational_state: "disputed_being_named",
        operational_state_set_by: adminUid,
        operational_state_set_at: new Date().toISOString(),
        disputed_at: new Date().toISOString(),
        dispute_source: "admin_report",
        dispute_reason: "Live progression-guard probe — disputed engagement.",
      });
      const decA = await assertEngagementAllowsProgression(admin, matchA);

      // T8b — binding review
      const matchB = await mkMatch("t8b");
      await mkEng(matchB, {
        operational_state: "binding_review_required",
        operational_state_set_by: adminUid,
        operational_state_set_at: new Date().toISOString(),
      });
      const decB = await assertEngagementAllowsProgression(admin, matchB);

      // T8c — historical cancelled, no replacement.
      const matchC = await mkMatch("t8c");
      await mkEng(matchC, {
        engagement_status: "cancelled_email_change",
        operational_state: "cancelled_for_email_change",
        operational_state_set_by: adminUid,
        operational_state_set_at: new Date().toISOString(),
        cancelled_at: new Date().toISOString(),
        cancelled_reason: "email_change",
        cancelled_by_user_id: adminUid,
      });
      const decC = await assertEngagementAllowsProgression(admin, matchC);

      const ok = !decA.allowed && decA.code === "DISPUTED_BEING_NAMED"
        && !decB.allowed && decB.code === "BINDING_REVIEW_PENDING"
        && !decC.allowed && decC.code === "CANCELLED_EMAIL_CHANGE";
      record({
        id: "T8-progression-guard-live",
        description: "assertEngagementAllowsProgression returns each new D2a code against real DB rows",
        route: "shared assertEngagementAllowsProgression()",
        expected: "DISPUTED_BEING_NAMED / BINDING_REVIEW_PENDING / CANCELLED_EMAIL_CHANGE",
        observed: `A=${decA.code}(allowed=${decA.allowed}) B=${decB.code}(allowed=${decB.allowed}) C=${decC.code}(allowed=${decC.allowed})`,
        pass: ok, details: { decA, decB, decC },
      });
    }

  } catch (e) {
    setupError = (e as Error)?.message ?? String(e);
  } finally {
    // Reverse-order cleanup. Best-effort; record any failures.
    for (let i = cleanup.length - 1; i >= 0; i--) {
      try {
        await cleanup[i]();
      } catch (e) {
        cleanupNotes.push(`cleanup[${i}] failed: ${(e as Error)?.message ?? String(e)}`);
      }
    }
  }

  const summary = {
    run_id: runId,
    tag,
    started_at_iso: new Date().toISOString(),
    setup_error: setupError,
    total: tests.length,
    passed: tests.filter((t) => t.pass).length,
    failed: tests.filter((t) => !t.pass).length,
    pass: tests.length > 0 && tests.every((t) => t.pass) && !setupError,
    cleanup_notes: cleanupNotes,
    scope_confirmation: {
      ui_touched: false,
      fixtures_touched: false,
      docx_touched: false,
      notifications_touched: false,
      ratings_touched: false,
      legacy_disputes_touched: false,
      mt_009_touched: false,
      d2b_binding_resolver_touched: false,
      d3_admin_ui_touched: false,
    },
    tests,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: baseHeaders,
  });
});
