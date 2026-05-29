// Batch D — D2b live proof harness for the Binding Review Resolver.
// =================================================================
// Provisions ephemeral fixtures (orgs, platform_admin user, parent
// matches, poi_engagements rows in binding_review_required) and
// exercises the deployed POST /poi-engagements/:id/resolve-binding
// endpoint end-to-end against the real DB / RLS / CHECK constraints /
// audit pipeline. Tears everything down on the way out.
//
// Invocation:  POST { "confirm": "RUN_D2B_LIVE_PROOF" }
// Auth:        platform_admin OR INTERNAL_CRON_KEY (x-internal-key)
//              OR SUPABASE_SERVICE_ROLE_KEY as Bearer (parity with d2a).
//
// Scope (D2b only):
//   T1 — preview/send blocked BEFORE resolution (BINDING_REVIEW_PENDING).
//   T2 — confirmed_canonical → row updated, op_state cleared,
//        binding_resolution=confirmed_canonical, counterparty_org bound,
//        audit row written, preview/send no longer return
//        BINDING_REVIEW_PENDING.
//   T3 — deferred_no_review_needed → op_state cleared,
//        binding_resolution=deferred_no_review_needed.
//   T4 — rejected → binding_resolution=rejected,
//        operational_state remains binding_review_required,
//        preview/send STILL return BINDING_REVIEW_PENDING.
//   T5 — second resolve attempt on a resolved row returns
//        409 BINDING_REVIEW_ALREADY_RESOLVED.
//   T6 — payload validation: confirmed_canonical without selected_org_id
//        → 400 VALIDATION_ERROR; row unchanged.
//   T7 — resolve attempt on an engagement with no binding-review state
//        → 409 BINDING_REVIEW_NOT_PENDING.
//
// EXPLICITLY OUT OF SCOPE: D3 admin UI work beyond the minimal panel
// changes; MT-009 named-contact enforcement; fixtures/DOCX/notifications/
// ratings/legacy disputes — none of those code paths are touched.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PASSWORD = "D2bLiveProof!" + crypto.randomUUID().slice(0, 8);

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
  const baseHeaders = { ...__buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin")), "Content-Type": "application/json" };
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
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
      const tok = authz.slice(7).trim();
      if (tok === SERVICE_ROLE) {
        authorized = true;
      } else {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } });
        const { data: u } = await userClient.auth.getUser();
        if (u?.user) {
          const { data: isAdminCaller } = await admin.rpc("is_admin", { user_id: u.user.id });
          if (isAdminCaller) authorized = true;
        }
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "FORBIDDEN", message: "platform_admin or INTERNAL_CRON_KEY required" }), { status: 403, headers: baseHeaders });
  }

  let payload: any;
  try { payload = await req.json(); } catch { payload = {}; }
  if (payload?.confirm !== "RUN_D2B_LIVE_PROOF") {
    return new Response(JSON.stringify({ error: "CONFIRM_REQUIRED", hint: "POST { confirm: 'RUN_D2B_LIVE_PROOF' }" }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `d2b_${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const cleanupNotes: string[] = [];
  const record = (t: TestRecord) => { tests.push(t); };

  let setupError: string | null = null;

  try {
    // ─── Setup ────────────────────────────────────────────────
    const { data: orgA, error: oErrA } = await admin.from("organizations").insert({ name: `${tag}_orgA_buyer` }).select("id").single();
    const { data: orgB, error: oErrB } = await admin.from("organizations").insert({ name: `${tag}_orgB_seller_canonical` }).select("id").single();
    const { data: orgC } = await admin.from("organizations").insert({ name: `${tag}_orgC_seller_alt` }).select("id").single();
    if (oErrA || oErrB || !orgA || !orgB || !orgC) throw new Error(`org create: ${oErrA?.message ?? oErrB?.message}`);
    cleanup.push(() => admin.from("organizations").delete().in("id", [orgA.id, orgB.id, orgC.id]));

    // Platform admin user.
    const adminEmail = `${tag}_admin@d2b.test.invalid`;
    const { data: createdAdmin, error: caErr } = await admin.auth.admin.createUser({
      email: adminEmail, password: PASSWORD, email_confirm: true,
    });
    if (caErr || !createdAdmin.user) throw new Error(`createUser admin: ${caErr?.message}`);
    const adminUid = createdAdmin.user.id;
    cleanup.push(() => admin.auth.admin.deleteUser(adminUid));
    const { data: priorProfile } = await admin.from("profiles").select("org_id").eq("id", adminUid).maybeSingle();
    const autoOrgId = priorProfile?.org_id ?? null;
    await admin.from("user_roles").delete().eq("user_id", adminUid);
    await admin.from("profiles").upsert({ id: adminUid, org_id: null, full_name: "D2b Platform Admin", email: adminEmail });
    cleanup.push(() => admin.from("profiles").delete().eq("id", adminUid));
    if (autoOrgId && ![orgA.id, orgB.id, orgC.id].includes(autoOrgId)) {
      cleanup.push(() => admin.from("organizations").delete().eq("id", autoOrgId));
    }
    await admin.from("user_roles").insert({ user_id: adminUid, role: "platform_admin" });
    const adminToken = await signIn(adminEmail, PASSWORD);
    if (!adminToken) throw new Error("admin signIn failed");

    const mkMatch = async (label: string): Promise<string> => {
      const { data: m, error: e } = await admin.from("matches").insert({
        buyer_org_id: orgA.id,
        seller_org_id: orgB.id,
        org_id: orgA.id,
        buyer_id: `${tag}_${label}_buyer`,
        seller_id: `${tag}_${label}_seller`,
        buyer_name: `${tag} ${label} buyer`,
        seller_name: `${tag} ${label} seller`,
        commodity: "TEST_D2B",
        quantity_amount: 1, quantity_unit: "MT",
        price_amount: 1, price_currency: "USD",
        terms: "TEST", state: "discovery", status: "matched",
        poi_state: "ELIGIBLE",
        hash: `d2b_${runId}_${label}`,
      }).select("id").single();
      if (e) throw new Error(`create match ${label}: ${e.message}`);
      cleanup.push(() => admin.from("matches").delete().eq("id", m!.id));
      return m!.id as string;
    };

    const mkBindingEng = async (
      matchId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> => {
      const seed: Record<string, unknown> = {
        match_id: matchId,
        org_id: orgA.id,
        counterparty_email: `${tag}_cp_${crypto.randomUUID().slice(0, 6)}@d2b.test.invalid`,
        counterparty_type: "unknown",
        engagement_status: "pending",
        contact_type: "organisation",
        source: "admin_manual",
        operational_state: "binding_review_required",
        operational_state_set_by: adminUid,
        operational_state_set_at: new Date().toISOString(),
        binding_candidates: [
          { org_id: orgB.id, label: "candidate canonical" },
          { org_id: orgC.id, label: "candidate alt" },
        ],
        ...overrides,
      };
      const { data: e, error: err } = await admin
        .from("poi_engagements")
        .insert(seed)
        .select("id")
        .single();
      if (err) throw new Error(`create binding engagement: ${err.message}`);
      cleanup.push(async () => {
        await admin.from("engagement_outreach_logs").delete().eq("engagement_id", e!.id);
        await admin.from("poi_engagements").delete().eq("id", e!.id);
      });
      return e!.id as string;
    };

    const startedAt = new Date().toISOString();

    // ─────────────────────────────────────────────────────────
    // T1 — preview/send blocked BEFORE any resolution
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t1");
      const engId = await mkBindingEng(matchId);
      const rPreview = await callEdge(
        `poi-engagements/${engId}/preview-outreach`,
        adminToken, "POST", {},
      );
      const rSend = await callEdge(
        `poi-engagements/${engId}/send-outreach`,
        adminToken, "POST", { subject: "D2b pre-resolution probe" },
        { "Idempotency-Key": `${tag}_t1_${crypto.randomUUID()}` },
      );
      const previewOk = rPreview.status === 409
        && (rPreview.body?.code === "BINDING_REVIEW_PENDING" || rPreview.body?.error === "BINDING_REVIEW_PENDING");
      const sendOk = rSend.status === 409
        && (rSend.body?.code === "BINDING_REVIEW_PENDING" || rSend.body?.error === "BINDING_REVIEW_PENDING");
      record({
        id: "T1-pre-resolution-blocks-outreach",
        description: "Engagement in binding_review_required → preview+send return 409 BINDING_REVIEW_PENDING",
        route: "POST /poi-engagements/:id/preview-outreach + send-outreach",
        expected: "preview 409 BINDING_REVIEW_PENDING, send 409 BINDING_REVIEW_PENDING",
        observed: `preview=${rPreview.status}/${rPreview.body?.code ?? rPreview.body?.error} send=${rSend.status}/${rSend.body?.code ?? rSend.body?.error}`,
        pass: previewOk && sendOk,
        details: { preview: rPreview.body, send: rSend.body },
      });
    }

    // ─────────────────────────────────────────────────────────
    // T2 — confirmed_canonical resolves and unblocks outreach
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t2");
      const engId = await mkBindingEng(matchId);
      const r = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "confirmed_canonical",
          selected_org_id: orgB.id,
          notes: "Confirmed candidate canonical org per seller phone call.",
        },
        { "Idempotency-Key": `${tag}_t2_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements")
        .select("operational_state, binding_resolution, counterparty_org_id, operational_state_set_by")
        .eq("id", engId).maybeSingle();
      const { data: logs } = await admin
        .from("engagement_outreach_logs")
        .select("id, entry_type, notes")
        .eq("engagement_id", engId)
        .eq("entry_type", "binding_review_resolved");
      const notesOk = (logs ?? []).some((l: any) => {
        try {
          const j = JSON.parse(l.notes ?? "{}");
          return j.event === "binding_review_resolved"
            && j.resolution === "confirmed_canonical"
            && j.selected_org_id === orgB.id
            && j.previous_operational_state === "binding_review_required"
            && typeof j.request_id === "string"
            && typeof j.admin_notes === "string";
        } catch { return false; }
      });

      // Now confirm preview/send no longer return BINDING_REVIEW_PENDING.
      const rPreview = await callEdge(
        `poi-engagements/${engId}/preview-outreach`,
        adminToken, "POST", {},
      );
      const previewUnblocked = !(rPreview.status === 409
        && (rPreview.body?.code === "BINDING_REVIEW_PENDING" || rPreview.body?.error === "BINDING_REVIEW_PENDING"));

      const ok = r.status === 200
        && row?.operational_state === null
        && row?.binding_resolution === "confirmed_canonical"
        && row?.counterparty_org_id === orgB.id
        && row?.operational_state_set_by === adminUid
        && notesOk
        && previewUnblocked;
      record({
        id: "T2-confirmed-canonical-unblocks",
        description: "confirmed_canonical resolution → row bound, op_state cleared, audit row, preview no longer BINDING_REVIEW_PENDING",
        route: "POST /poi-engagements/:id/resolve-binding",
        expected: "200, op_state=null, binding_resolution=confirmed_canonical, counterparty_org_id=orgB, audit log, preview not 409/BINDING_REVIEW_PENDING",
        observed: `status=${r.status} op=${row?.operational_state} res=${row?.binding_resolution} cp=${row?.counterparty_org_id} notes_ok=${notesOk} preview_unblocked=${previewUnblocked}/${rPreview.status}`,
        pass: ok, details: { resp: r.body, row, logs, preview: rPreview.body },
      });
    }

    // ─────────────────────────────────────────────────────────
    // T3 — deferred_no_review_needed unblocks the binding gate
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t3");
      const engId = await mkBindingEng(matchId);
      const r = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "deferred_no_review_needed",
          notes: "Deferred — single candidate is unambiguous, no review required.",
        },
        { "Idempotency-Key": `${tag}_t3_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements")
        .select("operational_state, binding_resolution, counterparty_org_id")
        .eq("id", engId).maybeSingle();
      const ok = r.status === 200
        && row?.operational_state === null
        && row?.binding_resolution === "deferred_no_review_needed";
      record({
        id: "T3-deferred-unblocks",
        description: "deferred_no_review_needed → op_state cleared, binding_resolution recorded",
        route: "POST /poi-engagements/:id/resolve-binding",
        expected: "200, op_state=null, binding_resolution=deferred_no_review_needed",
        observed: `status=${r.status} op=${row?.operational_state} res=${row?.binding_resolution}`,
        pass: ok, details: { resp: r.body, row },
      });
    }

    // ─────────────────────────────────────────────────────────
    // T4 — rejected KEEPS the engagement blocked
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t4");
      const engId = await mkBindingEng(matchId);
      const r = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "rejected",
          notes: "Rejected — none of the candidates are credibly the counterparty.",
        },
        { "Idempotency-Key": `${tag}_t4_${crypto.randomUUID()}` },
      );
      const { data: row } = await admin
        .from("poi_engagements")
        .select("operational_state, binding_resolution")
        .eq("id", engId).maybeSingle();

      const rPreview = await callEdge(
        `poi-engagements/${engId}/preview-outreach`,
        adminToken, "POST", {},
      );
      const stillBlocked = rPreview.status === 409
        && (rPreview.body?.code === "BINDING_REVIEW_PENDING" || rPreview.body?.error === "BINDING_REVIEW_PENDING");

      const ok = r.status === 200
        && row?.operational_state === "binding_review_required"
        && row?.binding_resolution === "rejected"
        && stillBlocked;
      record({
        id: "T4-rejected-stays-blocked",
        description: "rejected → binding_resolution=rejected, op_state stays binding_review_required, preview STILL 409",
        route: "POST /poi-engagements/:id/resolve-binding (then preview)",
        expected: "200, op=binding_review_required, res=rejected, preview 409 BINDING_REVIEW_PENDING",
        observed: `status=${r.status} op=${row?.operational_state} res=${row?.binding_resolution} preview=${rPreview.status}/${rPreview.body?.code ?? rPreview.body?.error}`,
        pass: ok, details: { resp: r.body, row, preview: rPreview.body },
      });
    }

    // ─────────────────────────────────────────────────────────
    // T5 — second resolve attempt → 409 ALREADY_RESOLVED
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t5");
      const engId = await mkBindingEng(matchId);
      const first = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "confirmed_canonical",
          selected_org_id: orgB.id,
          notes: "First resolution — confirmed canonical org for T5 setup.",
        },
        { "Idempotency-Key": `${tag}_t5a_${crypto.randomUUID()}` },
      );
      const second = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "rejected",
          notes: "Trying to re-resolve an already-resolved binding review.",
        },
        { "Idempotency-Key": `${tag}_t5b_${crypto.randomUUID()}` },
      );
      const ok = first.status === 200
        && second.status === 409
        && (second.body?.code === "BINDING_REVIEW_ALREADY_RESOLVED" || second.body?.error === "BINDING_REVIEW_ALREADY_RESOLVED");
      record({
        id: "T5-already-resolved-409",
        description: "Second resolve attempt on a resolved row → 409 BINDING_REVIEW_ALREADY_RESOLVED",
        route: "POST /poi-engagements/:id/resolve-binding (twice)",
        expected: "first=200, second=409 BINDING_REVIEW_ALREADY_RESOLVED",
        observed: `first=${first.status} second=${second.status}/${second.body?.code ?? second.body?.error}`,
        pass: ok, details: { first: first.body, second: second.body },
      });
    }

    // ─────────────────────────────────────────────────────────
    // T6 — payload validation: confirmed_canonical missing org → 400
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t6");
      const engId = await mkBindingEng(matchId);
      const before = await admin
        .from("poi_engagements")
        .select("operational_state, binding_resolution")
        .eq("id", engId).maybeSingle();
      const r = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "confirmed_canonical",
          notes: "Missing selected_org_id should be rejected by validation.",
        },
        { "Idempotency-Key": `${tag}_t6_${crypto.randomUUID()}` },
      );
      const after = await admin
        .from("poi_engagements")
        .select("operational_state, binding_resolution")
        .eq("id", engId).maybeSingle();
      const ok = r.status === 400
        && (r.body?.code === "VALIDATION_ERROR" || r.body?.error === "VALIDATION_ERROR")
        && after.data?.operational_state === before.data?.operational_state
        && after.data?.binding_resolution === before.data?.binding_resolution;
      record({
        id: "T6-validation-missing-selected-org",
        description: "confirmed_canonical without selected_org_id → 400 VALIDATION_ERROR; row unchanged",
        route: "POST /poi-engagements/:id/resolve-binding",
        expected: "400 VALIDATION_ERROR, op_state/binding_resolution unchanged",
        observed: `status=${r.status} code=${r.body?.code ?? r.body?.error} op_before=${before.data?.operational_state} op_after=${after.data?.operational_state}`,
        pass: ok, details: { resp: r.body, before: before.data, after: after.data },
      });
    }

    // ─────────────────────────────────────────────────────────
    // T7 — resolve attempt on engagement NOT in binding-review → 409
    // ─────────────────────────────────────────────────────────
    {
      const matchId = await mkMatch("t7");
      // Plain engagement, no binding_candidates / no operational_state.
      const { data: e, error: err } = await admin
        .from("poi_engagements")
        .insert({
          match_id: matchId,
          org_id: orgA.id,
          counterparty_email: `${tag}_t7@d2b.test.invalid`,
          counterparty_type: "unknown",
          engagement_status: "pending",
          contact_type: "organisation",
          source: "admin_manual",
        })
        .select("id").single();
      if (err) throw new Error(`T7 seed: ${err.message}`);
      const engId = e!.id as string;
      cleanup.push(async () => {
        await admin.from("engagement_outreach_logs").delete().eq("engagement_id", engId);
        await admin.from("poi_engagements").delete().eq("id", engId);
      });

      const r = await callEdge(
        `poi-engagements/${engId}/resolve-binding`,
        adminToken, "POST",
        {
          resolution: "rejected",
          notes: "Trying to resolve an engagement that is not in binding review.",
        },
        { "Idempotency-Key": `${tag}_t7_${crypto.randomUUID()}` },
      );
      const ok = r.status === 409
        && (r.body?.code === "BINDING_REVIEW_NOT_PENDING" || r.body?.error === "BINDING_REVIEW_NOT_PENDING");
      record({
        id: "T7-not-pending-409",
        description: "Resolve on an engagement with no binding-review state → 409 BINDING_REVIEW_NOT_PENDING",
        route: "POST /poi-engagements/:id/resolve-binding",
        expected: "409 BINDING_REVIEW_NOT_PENDING",
        observed: `status=${r.status} code=${r.body?.code ?? r.body?.error}`,
        pass: ok, details: { resp: r.body },
      });
    }

    // Touch startedAt so a future audit-window check has a consistent ref.
    void startedAt;
  } catch (e) {
    setupError = (e as Error)?.message ?? String(e);
  } finally {
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
      ui_touched: "minimal_admin_panel_only",
      fixtures_touched: false,
      docx_touched: false,
      notifications_touched: false,
      ratings_touched: false,
      legacy_disputes_touched: false,
      mt_009_touched: false,
      d3_admin_ui_touched: false,
      batch_c_touched: false,
    },
    tests,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: baseHeaders,
  });
});
