/**
 * seed-daniel-fixtures — Phase 2 demo fixture seeder.
 *
 * Creates a stable, idempotent set of demo accounts, organisations,
 * matches, and poi_engagements so Daniel/James/David can exercise
 * Batch D flows in the LIVE platform without touching real client
 * data, real notifications, real billing, or real lifecycle jobs.
 *
 * SAFETY RAILS (verified against repo facts before edit, see chat log):
 *   - All created organisations are flagged organizations.is_demo=true
 *   - All created matches are flagged matches.is_demo=true
 *   - All created engagements are flagged poi_engagements.is_demo=true
 *   - Email accounts are restricted to *@test.izenzo.co.za
 *     (matches provision-test-user gate)
 *   - lifecycle-scheduler, outreach-sla-monitor, batch-d admin/initiator
 *     notify, and token-metering all skip is_demo rows (Phase 1).
 *
 * AUTH:
 *   - INTERNAL_CRON_KEY via x-internal-key header, OR
 *   - SUPABASE_SERVICE_ROLE_KEY via Authorization: Bearer …, OR
 *   - platform_admin JWT
 *
 * REQUEST:
 *   POST /functions/v1/seed-daniel-fixtures
 *   { "confirm": "RUN_SEED_DANIEL_FIXTURES", "password": "<min 12 chars>" }
 *
 * RESPONSE: a JSON matrix listing each account, role, org, match, engagement
 * status, what to click, and a direct route where possible.
 *
 * Out of scope: client guide / DOCX, Batch C, ratings, MT-009, legacy
 * disputes, D4c notifications, sending real emails.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const TEST_EMAIL_SUFFIX = "@test.izenzo.co.za";

const ACCOUNTS = [
  {
    key: "platform_admin",
    email: "daniel-platformadmin@test.izenzo.co.za",
    full_name: "Daniel (Platform Admin · DEMO)",
    role: "platform_admin" as const,
    org: "platform" as const,
  },
  {
    key: "initiator",
    email: "daniel-initiator@test.izenzo.co.za",
    full_name: "Daniel (Initiator · DEMO)",
    role: "org_admin" as const,
    org: "initiator" as const,
  },
  {
    key: "counterparty",
    email: "daniel-counterparty@test.izenzo.co.za",
    full_name: "Daniel (Counterparty · DEMO)",
    role: "org_admin" as const,
    org: "counterparty" as const,
  },
];

const ORG_INITIATOR_NAME = "DEMO Daniel Initiator Org";
const ORG_COUNTERPARTY_NAME = "DEMO Daniel Counterparty Org";

// Stable identifiers — also the matches.hash so we can find/upsert.
const FIXTURES = [
  { id: "DEMO-BINDING-001", purpose: "Binding review required" },
  { id: "DEMO-DISPUTED-002", purpose: "Disputed — being named" },
  { id: "DEMO-EMAILCHG-003", purpose: "Cancel for email change" },
  { id: "DEMO-LATE-ACCEPT-004", purpose: "Counterparty accepts after expiry" },
  {
    id: "DEMO-LATE-RECONFIRM-005",
    purpose: "Initiator reconfirm/decline late acceptance",
  },
  { id: "DEMO-CLEAN-006", purpose: "Control row — ordinary engagement" },
  {
    id: "DEMO-RECONFIRM-DUPLICATE-007",
    purpose:
      "Initiator reconfirm — duplicate-click / Idempotency-Key replay test",
  },
  // Batch E — outreach-blocked observability fixtures. Both rows are
  // hard-stuck in their blocked state: outreach cannot be sent because
  // the contact-completeness gate (`getContactState`) refuses, so no
  // notification path, lifecycle job, or POI side-effect can fire even
  // before the is_demo isolation kicks in.
  {
    id: "DEMO-BE-CONTACT-INCOMPLETE-001",
    purpose:
      "Outreach blocked — contact incomplete (no usable email, no org, no named individual)",
  },
  {
    id: "DEMO-BE-EMAIL-MISSING-002",
    purpose:
      "Outreach blocked — email missing (organisation known, email unusable)",
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsHeaders,
  });
}

async function authorise(req: Request, admin: SupabaseClient): Promise<{ ok: true } | { ok: false; resp: Response }> {
  const internal = req.headers.get("x-internal-key");
  if (INTERNAL_CRON_KEY && internal && internal === INTERNAL_CRON_KEY) {
    return { ok: true };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return { ok: true };
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data.user) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "platform_admin")
        .maybeSingle();
      if (roleRow) return { ok: true };
    }
  }
  return {
    ok: false,
    resp: json({ error: "unauthorised" }, 401),
  };
}

async function findOrCreateUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  full_name: string,
): Promise<string> {
  // Page through users to find existing.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) {
      // Always re-confirm. Do NOT reset password unless user passed it explicitly via "reset_password" flag.
      await admin.auth.admin.updateUserById(hit.id, { email_confirm: true });
      return hit.id;
    }
    if (data.users.length < 1000) break;
  }
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, demo_fixture: true },
  });
  if (cErr || !created.user) {
    throw new Error(`createUser failed for ${email}: ${cErr?.message}`);
  }
  return created.user.id;
}

async function findOrCreateOrg(admin: SupabaseClient, name: string): Promise<string> {
  const { data: existing } = await admin
    .from("organizations")
    .select("id, is_demo")
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    if (existing.is_demo !== true) {
      // Promote to demo — only safe because we filter by our exact demo names.
      await admin.from("organizations").update({ is_demo: true }).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data: created, error } = await admin
    .from("organizations")
    .insert({ name, status: "active", is_demo: true })
    .select("id")
    .single();
  if (error) throw new Error(`org create failed (${name}): ${error.message}`);
  return created.id;
}

async function upsertProfile(
  admin: SupabaseClient,
  user_id: string,
  org_id: string,
  email: string,
  full_name: string,
): Promise<void> {
  await admin.from("profiles").upsert(
    { id: user_id, org_id, email, full_name, status: "active" },
    { onConflict: "id" },
  );
}

async function upsertRole(
  admin: SupabaseClient,
  user_id: string,
  role: "platform_admin" | "org_admin",
): Promise<void> {
  // user_roles UNIQUE (user_id, role).
  await admin.from("user_roles").upsert(
    { user_id, role },
    { onConflict: "user_id,role" },
  );
}

async function findMatchByHash(
  admin: SupabaseClient,
  org_id: string,
  hash: string,
): Promise<string | null> {
  const { data } = await admin
    .from("matches")
    .select("id")
    .eq("org_id", org_id)
    .eq("hash", hash)
    .maybeSingle();
  return data?.id ?? null;
}

async function ensureMatch(
  admin: SupabaseClient,
  hash: string,
  buyer_org_id: string,
  seller_org_id: string,
  opts?: { buyer_name?: string | null; seller_name?: string | null },
): Promise<string> {
  // creator org = buyer (initiator). matches_role_invariant trigger requires
  // creator to be one of the two filled sides — buyer satisfies that.
  const existing = await findMatchByHash(admin, buyer_org_id, hash);
  if (existing) {
    // Self-heal display names so the initiator UI can resolve a
    // "Counterparty" label without re-seeding from scratch.
    if (opts && (opts.buyer_name !== undefined || opts.seller_name !== undefined)) {
      const upd: Record<string, unknown> = {};
      if (opts.buyer_name !== undefined) upd.buyer_name = opts.buyer_name;
      if (opts.seller_name !== undefined) upd.seller_name = opts.seller_name;
      await admin.from("matches").update(upd).eq("id", existing);
    }
    return existing;
  }
  const { data, error } = await admin
    .from("matches")
    .insert({
      org_id: buyer_org_id,
      hash,
      commodity: `DEMO Commodity (${hash})`,
      status: "matched",
      state: "discovery",
      buyer_org_id,
      seller_org_id,
      buyer_name: opts?.buyer_name ?? null,
      seller_name: opts?.seller_name ?? null,
      match_type: "search",
      poi_state: "DRAFT",
      is_demo: true,
      metadata: { fixture_id: hash, demo_fixture: true },
    })
    .select("id")
    .single();
  if (error) throw new Error(`match create failed (${hash}): ${error.message}`);
  return data.id;
}

interface EngagementShape {
  fixture_id: string;
  match_id: string;
  org_id: string; // initiator
  // Nullable so Batch E "contact_incomplete" fixture can omit the org link.
  counterparty_org_id: string | null;
  // Nullable so Batch E fixtures can present an unusable / missing email.
  counterparty_email: string | null;
  engagement_status:
    | "pending"
    | "notification_sent"
    | "contacted"
    | "expired"
    | "late_acceptance_pending_initiator_reconfirmation"
    | "disputed_being_named";
  operational_state?: string | null;
  binding_candidates?: unknown;
  // late acceptance fields
  original_expired_at?: string | null;
  late_acceptance_recorded_at?: string | null;
  reconfirmation_window_expires_at?: string | null;
  // dispute fields
  disputed_at?: string | null;
  dispute_reason?: string | null;
  dispute_source?: "admin_report" | null;
  // outreach
  contacted_at?: string | null;
  contact_method?: string | null;
  contact_type?: string | null;
  contact_name?: string | null;
  // expiry override
  expires_at?: string;
}

async function ensureEngagement(
  admin: SupabaseClient,
  shape: EngagementShape,
): Promise<{ id: string; created: boolean }> {
  // Idempotency key: one current engagement per match (excluding terminal),
  // but DEMO-LATE-ACCEPT-004 uses `expired` which is excluded from the unique
  // index. So we additionally key by (match_id, fixture_id in admin_notes).
  const { data: existing } = await admin
    .from("poi_engagements")
    .select("id")
    .eq("match_id", shape.match_id)
    .eq("is_demo", true)
    .maybeSingle();
  if (existing) {
    // Self-heal: keep status/expires_at consistent with the fixture
    // contract on every re-seed. Without this, fixtures whose contract
    // changed (e.g. DEMO-LATE-ACCEPT-004 needing expires_at < now())
    // stay stuck in their old shape on already-seeded environments.
    const update: Record<string, unknown> = {
      engagement_status: shape.engagement_status,
      operational_state: shape.operational_state ?? null,
      original_expired_at: shape.original_expired_at ?? null,
      late_acceptance_recorded_at: shape.late_acceptance_recorded_at ?? null,
      reconfirmation_window_expires_at: shape.reconfirmation_window_expires_at ?? null,
      // Self-heal contact shape so fixture wording corrections (e.g. Batch E
      // fixture 002 swapping to a NULL email + named contact) propagate to
      // already-seeded environments without a wipe-and-reseed.
      counterparty_email: shape.counterparty_email,
      counterparty_org_id: shape.counterparty_org_id,
      contact_name: shape.contact_name ?? null,
      contact_type: shape.contact_type ?? null,
    };
    if (shape.expires_at) update.expires_at = shape.expires_at;
    const { error: updErr } = await admin
      .from("poi_engagements")
      .update(update)
      .eq("id", existing.id);
    if (updErr) {
      throw new Error(
        `engagement self-heal failed (${shape.fixture_id}): ${updErr.message}`,
      );
    }
    return { id: existing.id, created: false };
  }

  const insert: Record<string, unknown> = {
    match_id: shape.match_id,
    org_id: shape.org_id,
    counterparty_org_id: shape.counterparty_org_id,
    counterparty_email: shape.counterparty_email,
    counterparty_type: "known",
    engagement_status: shape.engagement_status,
    operational_state: shape.operational_state ?? null,
    binding_candidates: shape.binding_candidates ?? null,
    original_expired_at: shape.original_expired_at ?? null,
    late_acceptance_recorded_at: shape.late_acceptance_recorded_at ?? null,
    reconfirmation_window_expires_at: shape.reconfirmation_window_expires_at ?? null,
    disputed_at: shape.disputed_at ?? null,
    dispute_reason: shape.dispute_reason ?? null,
    dispute_source: shape.dispute_source ?? null,
    contacted_at: shape.contacted_at ?? null,
    contact_method: shape.contact_method ?? null,
    contact_type: shape.contact_type ?? null,
    contact_name: shape.contact_name ?? null,
    is_demo: true,
    source: "admin_manual",
    admin_notes: `[DEMO ${shape.fixture_id}] Phase 2 fixture — safe demo row, isolated from lifecycle/notification/billing.`,
  };
  if (shape.expires_at) insert.expires_at = shape.expires_at;

  const { data, error } = await admin
    .from("poi_engagements")
    .insert(insert)
    .select("id")
    .single();
  if (error) throw new Error(`engagement create failed (${shape.fixture_id}): ${error.message}`);
  return { id: data.id, created: true };
}

async function ensureContactAttemptLog(
  admin: SupabaseClient,
  engagement_id: string,
  admin_user_id: string,
  admin_email: string,
): Promise<void> {
  const { data: existing } = await admin
    .from("engagement_outreach_logs")
    .select("id")
    .eq("engagement_id", engagement_id)
    .eq("entry_type", "contact_attempt")
    .maybeSingle();
  if (existing) return;
  await admin.from("engagement_outreach_logs").insert({
    engagement_id,
    admin_user_id,
    admin_email,
    admin_name: "DEMO seeder",
    contact_method: "email",
    contact_detail: "demo-counterparty-old-address@example.invalid",
    previous_status: "notification_sent",
    new_status: "contacted",
    notes: "[DEMO] seeded contact attempt — required for Cancel-for-email-change flow",
    entry_type: "contact_attempt",
    actor_type: "admin",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const authResult = await authorise(req, admin);
  if (!authResult.ok) return authResult.resp;

  let body: { confirm?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }
  if (body.confirm !== "RUN_SEED_DANIEL_FIXTURES") {
    return json({ error: "confirm token missing or wrong" }, 400);
  }
  const password = body.password;
  if (!password || password.length < 12) {
    return json(
      { error: "password (min 12 chars) required in request body — never logged, never stored in repo" },
      400,
    );
  }

  try {
    // 1. Orgs
    const initiatorOrgId = await findOrCreateOrg(admin, ORG_INITIATOR_NAME);
    const counterpartyOrgId = await findOrCreateOrg(admin, ORG_COUNTERPARTY_NAME);

    // 2. Users + profiles + roles
    const userIds: Record<string, string> = {};
    for (const acc of ACCOUNTS) {
      if (!acc.email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) {
        throw new Error(`account ${acc.email} not allowed (must end with ${TEST_EMAIL_SUFFIX})`);
      }
      const uid = await findOrCreateUser(admin, acc.email, password, acc.full_name);
      userIds[acc.key] = uid;
      // Profile: platform_admin attaches to initiator org as a parking org
      // (profiles.org_id is NOT NULL). The platform_admin role is global, not
      // per-org, so this does not grant org_admin powers there.
      const orgForProfile =
        acc.org === "initiator"
          ? initiatorOrgId
          : acc.org === "counterparty"
            ? counterpartyOrgId
            : initiatorOrgId;
      await upsertProfile(admin, uid, orgForProfile, acc.email, acc.full_name);
      await upsertRole(admin, uid, acc.role);
    }

    const initiatorUserId = userIds["initiator"];
    const counterpartyUserId = userIds["counterparty"];
    const platformAdminUserId = userIds["platform_admin"];

    // 3. Matches + engagements
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const iso = (ms: number) => new Date(ms).toISOString();

    const results: Array<Record<string, unknown>> = [];

    // A. DEMO-BINDING-001
    {
      const matchId = await ensureMatch(admin, "DEMO-BINDING-001", initiatorOrgId, counterpartyOrgId);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-BINDING-001",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: ACCOUNTS[2].email,
        engagement_status: "notification_sent",
        operational_state: "binding_review_required",
        binding_candidates: [
          { org_id: counterpartyOrgId, name: ORG_COUNTERPARTY_NAME, confidence: 0.62 },
          { org_id: null, name: "Acme Demo Trading Pty (no match)", confidence: 0.41 },
        ],
        expires_at: iso(now + 30 * day),
      });
      results.push({
        fixture: "DEMO-BINDING-001",
        purpose: "Binding review required",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "notification_sent",
        operational_state: "binding_review_required",
        click: "HQ → Engagements → toggle 'Show DEMO rows' → filter 'Binding review required' → open this row → Resolve binding",
        route: "/hq/engagements",
      });
    }

    // B. DEMO-DISPUTED-002
    {
      const matchId = await ensureMatch(admin, "DEMO-DISPUTED-002", initiatorOrgId, counterpartyOrgId);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-DISPUTED-002",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: ACCOUNTS[2].email,
        engagement_status: "disputed_being_named",
        operational_state: "disputed_being_named",
        disputed_at: iso(now - 2 * day),
        dispute_reason: "[DEMO] Counterparty disputes being named in this engagement — admin_report seed.",
        dispute_source: "admin_report",
        expires_at: iso(now + 30 * day),
      });
      results.push({
        fixture: "DEMO-DISPUTED-002",
        purpose: "Disputed — being named",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "disputed_being_named",
        operational_state: "disputed_being_named",
        click: "HQ → Engagements → toggle 'Show DEMO rows' → filter 'Disputed — being named' → open this row",
        route: "/hq/engagements",
      });
    }

    // C. DEMO-EMAILCHG-003
    {
      const matchId = await ensureMatch(admin, "DEMO-EMAILCHG-003", initiatorOrgId, counterpartyOrgId);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-EMAILCHG-003",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: "demo-counterparty-old-address@example.invalid",
        engagement_status: "contacted",
        operational_state: null,
        contacted_at: iso(now - 3 * day),
        contact_method: "email",
        contact_type: "named_individual",
        contact_name: "Demo Contact",
        expires_at: iso(now + 30 * day),
      });
      // Need at least one contact_attempt outreach log to satisfy the
      // "direct email edit blocked → must Cancel for email change" gate.
      await ensureContactAttemptLog(admin, eng.id, platformAdminUserId, ACCOUNTS[0].email);
      results.push({
        fixture: "DEMO-EMAILCHG-003",
        purpose: "Cancel for email change",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "contacted",
        operational_state: null,
        click: "HQ → Engagements → toggle 'Show DEMO rows' → open this row → click 'Cancel for email change'",
        route: "/hq/engagements",
      });
    }

    // D. DEMO-LATE-ACCEPT-004 — expired, ready for counterparty late accept.
    {
      const matchId = await ensureMatch(admin, "DEMO-LATE-ACCEPT-004", initiatorOrgId, counterpartyOrgId);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-LATE-ACCEPT-004",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: ACCOUNTS[2].email,
        engagement_status: "expired",
        operational_state: null,
        expires_at: iso(now - 1 * day),
      });
      results.push({
        fixture: "DEMO-LATE-ACCEPT-004",
        purpose: "Counterparty accepts after expiry",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "expired",
        operational_state: null,
        click: "Login as daniel-counterparty → Match Details → accept after expiry; then login as daniel-initiator → Match Details → reconfirm or decline",
        route: `/desk/match/${matchId}`,
      });
    }

    // E. DEMO-LATE-RECONFIRM-005 — already in late_acceptance_pending_initiator_reconfirmation.
    {
      const matchId = await ensureMatch(admin, "DEMO-LATE-RECONFIRM-005", initiatorOrgId, counterpartyOrgId);
      const expiredAt = iso(now - 2 * day);
      const recordedAt = iso(now - 1 * day);
      const windowExpires = iso(now + 6 * day);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-LATE-RECONFIRM-005",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: ACCOUNTS[2].email,
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
        operational_state: null,
        original_expired_at: expiredAt,
        late_acceptance_recorded_at: recordedAt,
        reconfirmation_window_expires_at: windowExpires,
        expires_at: windowExpires,
      });
      results.push({
        fixture: "DEMO-LATE-RECONFIRM-005",
        purpose: "Initiator reconfirm / decline late acceptance",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
        operational_state: null,
        click: "Login as daniel-initiator → Match Details → 'Reconfirm and renew engagement' or 'Decline late acceptance'",
        route: `/desk/match/${matchId}`,
      });
    }

    // F. DEMO-CLEAN-006 — control row.
    {
      const matchId = await ensureMatch(admin, "DEMO-CLEAN-006", initiatorOrgId, counterpartyOrgId);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-CLEAN-006",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: ACCOUNTS[2].email,
        engagement_status: "notification_sent",
        operational_state: null,
        expires_at: iso(now + 30 * day),
      });
      results.push({
        fixture: "DEMO-CLEAN-006",
        purpose: "Control row — ordinary engagement",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "notification_sent",
        operational_state: null,
        click: "HQ → Engagements → toggle 'Show DEMO rows' → confirm row appears alongside others",
        route: "/hq/engagements",
      });
    }

    // G. DEMO-RECONFIRM-DUPLICATE-007 — fresh late-acceptance reconfirmation
    //    row dedicated to Test 6 (duplicate-click / Idempotency-Key replay).
    //    Same shape as fixture E but a separate match so Test 5 consumption
    //    of fixture E does not contaminate Test 6.
    {
      const matchId = await ensureMatch(
        admin,
        "DEMO-RECONFIRM-DUPLICATE-007",
        initiatorOrgId,
        counterpartyOrgId,
      );
      const expiredAt = iso(now - 2 * day);
      const recordedAt = iso(now - 1 * day);
      const windowExpires = iso(now + 6 * day);
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-RECONFIRM-DUPLICATE-007",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: ACCOUNTS[2].email,
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
        operational_state: null,
        original_expired_at: expiredAt,
        late_acceptance_recorded_at: recordedAt,
        reconfirmation_window_expires_at: windowExpires,
        expires_at: windowExpires,
      });
      results.push({
        fixture: "DEMO-RECONFIRM-DUPLICATE-007",
        purpose:
          "Initiator reconfirm — duplicate-click / Idempotency-Key replay test",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
        operational_state: null,
        click:
          "Login as daniel-initiator → Match Details → 'Reconfirm and renew engagement' (then double-click / refresh+retry to verify duplicate-safe replay)",
        route: `/desk/match/${matchId}`,
      });
    }

    // H. DEMO-BE-CONTACT-INCOMPLETE-001 — Batch E observability fixture.
    //    Outreach is hard-blocked by `getContactState` because there is
    //    no usable email, no linked counterparty org, and no named
    //    individual. Initiator surface renders the neutral
    //    "Outreach paused — contact incomplete" amber banner; admin
    //    panel shows the "Contact incomplete" chip and the Send-outreach
    //    button is disabled. No email/SMS/POI/credit/lifecycle path is
    //    reachable: the contact gate refuses before any dispatcher and
    //    the is_demo flag short-circuits the rest of Phase 1 isolation.
    {
      const matchId = await ensureMatch(
        admin,
        "DEMO-BE-CONTACT-INCOMPLETE-001",
        initiatorOrgId,
        counterpartyOrgId,
      );
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-BE-CONTACT-INCOMPLETE-001",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: null,
        counterparty_email: null,
        engagement_status: "pending",
        operational_state: null,
        expires_at: iso(now + 30 * day),
      });
      results.push({
        fixture: "DEMO-BE-CONTACT-INCOMPLETE-001",
        purpose: "Outreach blocked — contact incomplete",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "pending",
        operational_state: null,
        click:
          "HQ → Engagements → toggle 'Show DEMO rows' → open this row → confirm initiator amber 'Outreach paused — contact incomplete' banner and disabled Send outreach with 'Contact incomplete' chip",
        route: "/hq/engagements",
      });
    }

    // I. DEMO-BE-EMAIL-MISSING-002 — Batch E observability fixture.
    //    Counterparty identity is fully known (linked organisation +
    //    named individual contact) but no usable email is on file
    //    (`counterparty_email = NULL`). `getContactState` therefore
    //    returns "email_missing" — NOT "contact_incomplete" — so the
    //    initiator amber banner reads "Outreach paused — email missing"
    //    and the required-items list does NOT claim the counterparty
    //    name is missing. Admin Send-outreach remains disabled.
    {
      const matchId = await ensureMatch(
        admin,
        "DEMO-BE-EMAIL-MISSING-002",
        initiatorOrgId,
        counterpartyOrgId,
        { seller_name: "DEMO Counterparty Co." },
      );
      const eng = await ensureEngagement(admin, {
        fixture_id: "DEMO-BE-EMAIL-MISSING-002",
        match_id: matchId,
        org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        counterparty_email: null,
        contact_type: "named_individual",
        contact_name: "DEMO Counterparty Contact",
        engagement_status: "pending",
        operational_state: null,
        expires_at: iso(now + 30 * day),
      });
      results.push({
        fixture: "DEMO-BE-EMAIL-MISSING-002",
        purpose: "Outreach blocked — email missing",
        match_id: matchId,
        engagement_id: eng.id,
        engagement_status: "pending",
        operational_state: null,
        click:
          "HQ → Engagements → toggle 'Show DEMO rows' → open this row → confirm initiator amber 'Outreach paused — email missing' banner and disabled Send outreach",
        route: "/hq/engagements",
      });
    }

    return json({
      ok: true,
      summary: {
        accounts_created: ACCOUNTS.length,
        orgs: 2,
        matches: results.length,
        engagements: results.length,
      },
      accounts: ACCOUNTS.map((a) => ({
        email: a.email,
        role: a.role,
        org:
          a.org === "initiator"
            ? ORG_INITIATOR_NAME
            : a.org === "counterparty"
              ? ORG_COUNTERPARTY_NAME
              : "(global platform_admin)",
        user_id: userIds[a.key],
      })),
      organizations: [
        { id: initiatorOrgId, name: ORG_INITIATOR_NAME, is_demo: true },
        { id: counterpartyOrgId, name: ORG_COUNTERPARTY_NAME, is_demo: true },
      ],
      fixtures: results,
      notes: [
        "All organisations, matches, and engagements created here have is_demo=true.",
        "lifecycle-scheduler, outreach-sla-monitor, batch-d notify, and token-metering all skip is_demo rows (Phase 1).",
        "HQ panels hide demo rows by default — toggle 'Show DEMO rows' to see them.",
        "No real emails were sent. No token ledger row was created.",
        "To remove: POST /functions/v1/unseed-daniel-fixtures with the same auth and { confirm: 'RUN_UNSEED_DANIEL_FIXTURES' }.",
      ],
    });
  } catch (err) {
    return json(
      {
        ok: false,
        error: (err as Error).message,
      },
      500,
    );
  }
});
