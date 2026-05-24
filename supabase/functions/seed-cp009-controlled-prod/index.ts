/**
 * seed-cp009-controlled-prod — CP-009 / DEC-003 controlled-production
 * demo-mode seeder for the single signed Daniel acceptance fixture:
 *
 *   DEMO-CP009-LATE-ACCEPT-001
 *     Pending engagement where outreach was sent > 7 calendar days ago,
 *     the engagement has expired, and the counterparty accepts AFTER
 *     expiry. The acceptance is recorded as
 *     `accepted_after_expiry`; engagement transitions to
 *     `late_acceptance_pending_initiator_reconfirmation`; no POI / WaD
 *     / execution / credit-burn / payment event is triggered.
 *
 * Canonical signed audit names:
 *   1. pending_engagement.accepted_after_expiry             (seeded here,
 *      via atomic_record_late_acceptance RPC)
 *   2. pending_engagement.late_acceptance_reconfirmed_by_initiator
 *      (Daniel triggers via UI — atomic_reconfirm_late_acceptance RPC)
 *   3. pending_engagement.late_acceptance_declined_by_initiator
 *      (Daniel triggers via UI — atomic_decline_late_acceptance RPC)
 *
 * Hard-gated by:
 *   - `admin_settings.allow_controlled_production_demo_fixtures_cp009.enabled = true`
 *   - scope: "CP-009 / DEC-003 Daniel UAT"
 *   - hash allowlist of one
 *
 * Does NOT:
 *   - touch CP-002 / CP-003 / CP-006 / CP-012 / CP-015 / MT-008 /
 *     MT-009 / MT-012 fixtures
 *   - send any email / WhatsApp / notification / invite
 *   - mint POI, trigger WaD, run execution, burn credits, write payment
 *     events
 *   - call lifecycle scheduler, ratings, or compliance pipelines
 *
 * Reuses the Daniel demo orgs/accounts created by prior CP-00x seeders.
 *
 * Auth: INTERNAL_CRON_KEY header, SERVICE_ROLE bearer, or
 * platform_admin JWT.
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
const ALLOWED_FIXTURE_SCOPE = "CP-009 / DEC-003 Daniel UAT";
const ALLOWED_FIXTURE_HASHES = ["DEMO-CP009-LATE-ACCEPT-001"] as const;
type AllowedHash = typeof ALLOWED_FIXTURE_HASHES[number];

const BANNED_HASH_PREFIXES = [
  "DEMO-CP002-",
  "DEMO-CP003-",
  "DEMO-CP006-",
  "DEMO-CP012-",
  "DEMO-CP015-",
  "DEMO-MT008-",
  "DEMO-MT009-",
  "DEMO-MT012-",
];

const ADMIN_FLAG_KEY = "allow_controlled_production_demo_fixtures_cp009";

const ORG_INITIATOR_NAME = "DEMO Daniel Initiator Org";
const ORG_COUNTERPARTY_NAME = "DEMO Daniel Counterparty Org";

const ACCOUNTS = [
  {
    key: "platform_admin",
    email: "daniel-platformadmin@test.izenzo.co.za",
    full_name: "Daniel (Platform Admin · DEMO)",
    role: "platform_admin" as const,
    org: "initiator" as const,
  },
  {
    key: "initiator",
    email: "daniel-initiator@test.izenzo.co.za",
    full_name: "Daniel (Initiator · DEMO)",
    role: "org_admin" as const,
    org: "initiator" as const,
  },
];

// CP-009: named counterparty (name + email both present); the engagement
// was contacted > 7 days ago and has now expired.
const COUNTERPARTY_EMAIL =
  "daniel-cp009-late-acceptor@test.izenzo.co.za";
const COUNTERPARTY_CONTACT_NAME = "Daniel Late Acceptor (DEMO CP-009)";
const COUNTERPARTY_ORG_LABEL = "DEMO Daniel Counterparty Org";

// Time anchors (computed at request time, fed to UPDATE so the BEFORE
// INSERT trigger doesn't clamp expires_at into the future).
const OUTREACH_AGE_DAYS = 10; // contacted 10 days ago
const EXPIRY_AGE_DAYS = 3; // expired 3 days ago (> 7d after contact ⇒ past expiry)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsHeaders,
  });
}

function isProductionTier(): boolean {
  const tier = (Deno.env.get("ENVIRONMENT_TIER") ?? "").toLowerCase();
  return tier === "production" || tier === "live" || tier === "prod";
}

async function authorise(
  req: Request,
  admin: SupabaseClient,
): Promise<
  | { ok: true; actor: string | null; actorUserId: string | null }
  | { ok: false; resp: Response }
> {
  const internal = req.headers.get("x-internal-key");
  if (INTERNAL_CRON_KEY && internal && internal === INTERNAL_CRON_KEY) {
    return { ok: true, actor: "internal_cron", actorUserId: null };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) {
    return { ok: true, actor: "service_role", actorUserId: null };
  }
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
      if (roleRow) {
        return {
          ok: true,
          actor: data.user.email ?? data.user.id,
          actorUserId: data.user.id,
        };
      }
    }
  }
  return { ok: false, resp: json({ error: "unauthorised" }, 401) };
}

async function isControlledFlagEnabled(admin: SupabaseClient): Promise<{
  enabled: boolean;
  scope: string | null;
  allowed: string[];
}> {
  const { data } = await admin
    .from("admin_settings")
    .select("value")
    .eq("key", ADMIN_FLAG_KEY)
    .maybeSingle();
  const v = (data?.value ?? {}) as {
    enabled?: boolean;
    scope?: string;
    allowed_hashes?: string[];
  };
  return {
    enabled: v.enabled === true,
    scope: v.scope ?? null,
    allowed: Array.isArray(v.allowed_hashes) ? v.allowed_hashes : [],
  };
}

async function findOrCreateUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  full_name: string,
): Promise<string> {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) {
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
  await admin.from("user_roles").upsert(
    { user_id, role },
    { onConflict: "user_id,role" },
  );
}

async function ensureMatch(
  admin: SupabaseClient,
  hash: AllowedHash,
  buyer_org_id: string,
  seller_org_id: string,
  meta: Record<string, unknown>,
): Promise<{ match_id: string; created: boolean }> {
  const { data: existing } = await admin
    .from("matches")
    .select("id, is_demo, metadata")
    .eq("org_id", buyer_org_id)
    .eq("hash", hash)
    .maybeSingle();
  if (existing) {
    if (existing.is_demo !== true) {
      throw new Error(
        `existing match ${hash} is not is_demo=true; refusing to mutate`,
      );
    }
    const merged = {
      ...(existing.metadata as Record<string, unknown> ?? {}),
      ...meta,
    };
    await admin
      .from("matches")
      .update({ metadata: merged })
      .eq("id", existing.id)
      .eq("is_demo", true);
    return { match_id: existing.id, created: false };
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
      seller_org_id, // CP-009: named counterparty (registered demo org)
      buyer_name: ORG_INITIATOR_NAME,
      seller_name: COUNTERPARTY_ORG_LABEL,
      match_type: "search",
      poi_state: "DRAFT",
      is_demo: true,
      metadata: meta,
    })
    .select("id")
    .single();
  if (error) throw new Error(`match create failed (${hash}): ${error.message}`);
  return { match_id: data.id, created: true };
}

/**
 * Insert with a valid future expires_at (BEFORE INSERT trigger enforces
 * +24h minimum), then UPDATE in one statement to push the engagement
 * into the post-expiry shape (status=expired, expires_at in past,
 * contacted_at in past). The UPDATE trigger only clamps expires_at when
 * NEW.engagement_status IN ('notification_sent','contacted') — setting
 * the new status to 'expired' in the same UPDATE bypasses the floor.
 */
async function ensureExpiredEngagement(
  admin: SupabaseClient,
  args: {
    match_id: string;
    initiator_org_id: string;
    counterparty_org_id: string;
    fixture_code: AllowedHash;
    contactedAtIso: string;
    expiredAtIso: string;
  },
): Promise<{ engagement_id: string; created: boolean }> {
  const adminNotes =
    `[DEMO ${args.fixture_code}] CP-009 / DEC-003 — outreach sent ${OUTREACH_AGE_DAYS} days ago; engagement expired ${EXPIRY_AGE_DAYS} days ago. Counterparty late acceptance must NOT auto-revive engagement; initiator reconfirmation required.`;

  const { data: existing } = await admin
    .from("poi_engagements")
    .select("id, engagement_status")
    .eq("match_id", args.match_id)
    .eq("is_demo", true)
    .maybeSingle();

  let engagementId: string;
  let created = false;

  if (existing) {
    engagementId = existing.id;
  } else {
    // Step 1: insert with future expires_at so the BEFORE INSERT trigger
    // is satisfied. We will rewrite expires_at + status in step 2.
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString();
    const { data, error } = await admin
      .from("poi_engagements")
      .insert({
        match_id: args.match_id,
        org_id: args.initiator_org_id,
        counterparty_org_id: args.counterparty_org_id,
        counterparty_email: COUNTERPARTY_EMAIL,
        counterparty_type: "known",
        contact_type: "named_individual",
        contact_name: COUNTERPARTY_CONTACT_NAME,
        engagement_status: "pending",
        expires_at: futureExpiry,
        sla_reminder_count: 0,
        is_demo: true,
        source: "admin_manual",
        admin_notes: adminNotes,
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(`engagement create failed (${args.fixture_code}): ${error.message}`);
    }
    engagementId = data.id;
    created = true;
  }

  // Step 2: rewrite to expired shape (idempotent). Setting status='expired'
  // in the same UPDATE means the floor trigger skips expires_at clamping.
  const { error: upErr } = await admin
    .from("poi_engagements")
    .update({
      engagement_status: "expired",
      counterparty_email: COUNTERPARTY_EMAIL,
      counterparty_org_id: args.counterparty_org_id,
      counterparty_type: "named_individual",
      contact_type: "named_individual",
      contact_name: COUNTERPARTY_CONTACT_NAME,
      contact_method: "email",
      contacted_at: args.contactedAtIso,
      contact_date: args.contactedAtIso,
      expires_at: args.expiredAtIso,
      sla_reminder_count: 0,
      counterparty_response: null,
      original_expired_at: null,
      late_acceptance_recorded_at: null,
      reconfirmation_window_expires_at: null,
      late_acceptance_resolved_at: null,
      late_acceptance_resolution: null,
      admin_notes: adminNotes,
    })
    .eq("id", engagementId)
    .eq("is_demo", true);
  if (upErr) {
    throw new Error(
      `engagement expire-rewrite failed (${args.fixture_code}): ${upErr.message}`,
    );
  }

  return { engagement_id: engagementId, created };
}

async function recordLateAcceptanceViaRpc(
  admin: SupabaseClient,
  args: {
    engagement_id: string;
    actor_user_id: string;
    actor_email: string;
    actor_name: string;
    audit_org_id: string;
  },
): Promise<
  | { ok: true; idempotent: boolean; window_expires_at: string | null; previous_status: string | null }
  | { ok: false; error: string }
> {
  const { data, error } = await admin.rpc("atomic_record_late_acceptance", {
    p_engagement_id: args.engagement_id,
    p_actor_user_id: args.actor_user_id,
    p_actor_email: args.actor_email,
    p_actor_name: args.actor_name,
    p_audit_org_id: args.audit_org_id,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as {
    success?: boolean;
    error?: string;
    idempotent?: boolean;
    reconfirmation_window_expires_at?: string | null;
    previous_status?: string | null;
  };
  if (!r.success) return { ok: false, error: r.error ?? "rpc_failed" };
  return {
    ok: true,
    idempotent: r.idempotent === true,
    window_expires_at: r.reconfirmation_window_expires_at ?? null,
    previous_status: r.previous_status ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const authResult = await authorise(req, admin);
  if (!authResult.ok) return authResult.resp;
  const { actor } = authResult;

  let body: {
    confirm?: string;
    password?: string;
    scope?: string;
    hashes?: string[];
  } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  if (body.confirm !== "RUN_SEED_CP009_CONTROLLED_PROD") {
    return json({ error: "confirm token missing or wrong" }, 400);
  }
  const password = body.password;
  if (!password || password.length < 12) {
    return json(
      { error: "password (min 12 chars) required in request body — never logged" },
      400,
    );
  }
  if (body.scope !== ALLOWED_FIXTURE_SCOPE) {
    return json(
      { error: "SCOPE_NOT_ALLOWED", expected: ALLOWED_FIXTURE_SCOPE },
      400,
    );
  }
  const requested = Array.isArray(body.hashes) && body.hashes.length > 0
    ? body.hashes
    : [...ALLOWED_FIXTURE_HASHES];
  for (const h of requested) {
    if (BANNED_HASH_PREFIXES.some((p) => h.startsWith(p))) {
      return json({ error: "BANNED_HASH", hash: h }, 400);
    }
    if (!ALLOWED_FIXTURE_HASHES.includes(h as AllowedHash)) {
      return json(
        { error: "HASH_NOT_ALLOWED", hash: h, allowed: ALLOWED_FIXTURE_HASHES },
        400,
      );
    }
  }

  if (isProductionTier()) {
    const flag = await isControlledFlagEnabled(admin);
    if (!flag.enabled) {
      try {
        await admin.from("admin_audit_logs").insert({
          admin_user_id: null,
          action: "demo.fixture_seed_refused_controlled_production",
          target_type: "system",
          target_id: null,
          details: {
            function: "seed-cp009-controlled-prod",
            reason: "controlled_flag_disabled",
            scope: body.scope,
            hashes: requested,
            actor,
          },
        });
      } catch (_e) { /* best-effort */ }
      return json(
        {
          error: "CONTROLLED_PRODUCTION_FLAG_DISABLED",
          message:
            `admin_settings.${ADMIN_FLAG_KEY}.enabled must be true to seed CP-009 fixtures in production.`,
        },
        403,
      );
    }
    if (flag.scope !== ALLOWED_FIXTURE_SCOPE) {
      return json(
        {
          error: "CONTROLLED_SCOPE_MISMATCH",
          expected: ALLOWED_FIXTURE_SCOPE,
          got: flag.scope,
        },
        403,
      );
    }
    for (const h of requested) {
      if (!flag.allowed.includes(h)) {
        return json(
          {
            error: "HASH_NOT_IN_PERSISTED_ALLOWLIST",
            hash: h,
            persisted_allowlist: flag.allowed,
          },
          403,
        );
      }
    }
  }

  try {
    const initiatorOrgId = await findOrCreateOrg(admin, ORG_INITIATOR_NAME);
    const counterpartyOrgId = await findOrCreateOrg(admin, ORG_COUNTERPARTY_NAME);

    const userIds: Record<string, string> = {};
    for (const acc of ACCOUNTS) {
      if (!acc.email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) {
        throw new Error(
          `account ${acc.email} not allowed (must end with ${TEST_EMAIL_SUFFIX})`,
        );
      }
      const uid = await findOrCreateUser(admin, acc.email, password, acc.full_name);
      userIds[acc.key] = uid;
      const orgForProfile = acc.org === "initiator" ? initiatorOrgId : counterpartyOrgId;
      await upsertProfile(admin, uid, orgForProfile, acc.email, acc.full_name);
      await upsertRole(admin, uid, acc.role);
    }
    const platformAdminUserId = userIds["platform_admin"];
    const platformAdminEmail = ACCOUNTS.find((a) => a.key === "platform_admin")!.email;
    const platformAdminName = ACCOUNTS.find((a) => a.key === "platform_admin")!.full_name;

    const nowMs = Date.now();
    const contactedAtIso = new Date(nowMs - OUTREACH_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const expiredAtIso = new Date(nowMs - EXPIRY_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const seededAt = new Date(nowMs).toISOString();

    const baseMeta = {
      demo_fixture: true,
      fixture_scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      seeded_at: seededAt,
      seeded_by: actor ?? "seed-cp009-controlled-prod",
      contacted_at: contactedAtIso,
      expired_at: expiredAtIso,
      cp_rule: "CP-009/DEC-003",
    };

    const results: Record<string, unknown>[] = [];
    for (const hash of requested as AllowedHash[]) {
      const meta = { ...baseMeta, fixture_code: hash };
      const { match_id, created: matchCreated } = await ensureMatch(
        admin,
        hash,
        initiatorOrgId,
        counterpartyOrgId,
        meta,
      );
      const { engagement_id, created: engCreated } = await ensureExpiredEngagement(admin, {
        match_id,
        initiator_org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        fixture_code: hash,
        contactedAtIso,
        expiredAtIso,
      });

      // Drive the canonical late acceptance audit via the RPC. This emits
      // pending_engagement.accepted_after_expiry and transitions the
      // engagement to late_acceptance_pending_initiator_reconfirmation.
      const rpcResult = await recordLateAcceptanceViaRpc(admin, {
        engagement_id,
        actor_user_id: platformAdminUserId,
        actor_email: platformAdminEmail,
        actor_name: platformAdminName,
        audit_org_id: initiatorOrgId,
      });
      if (!rpcResult.ok) {
        throw new Error(
          `atomic_record_late_acceptance failed for ${hash}/${engagement_id}: ${rpcResult.error}`,
        );
      }

      // Confirm POI/credit/payment side-effects did NOT fire.
      const { data: matchRow } = await admin
        .from("matches")
        .select("poi_state, status, state")
        .eq("id", match_id)
        .maybeSingle();
      const { count: ledgerCount } = await admin
        .from("token_ledger")
        .select("id", { count: "exact", head: true })
        .eq("metadata->>engagement_id", engagement_id);

      results.push({
        fixture_hash: hash,
        match_id,
        engagement_id,
        route_admin: `/admin/engagements?match=${match_id}`,
        route_initiator: `/desk/match/${match_id}`,
        match_created_or_reused: matchCreated ? "created" : "reused",
        engagement_created_or_reused: engCreated ? "created" : "reused",
        counterparty_email: COUNTERPARTY_EMAIL,
        counterparty_contact_name: COUNTERPARTY_CONTACT_NAME,
        counterparty_org_id: counterpartyOrgId,
        contacted_at: contactedAtIso,
        expires_at: expiredAtIso,
        late_acceptance_recorded: !rpcResult.idempotent,
        rpc_idempotent: rpcResult.idempotent,
        previous_engagement_status: rpcResult.previous_status,
        engagement_status_after: "late_acceptance_pending_initiator_reconfirmation",
        reconfirmation_window_expires_at: rpcResult.window_expires_at,
        counterparty_response: "accepted_after_expiry",
        initiator_reconfirmation_required: true,
        side_effects_check: {
          poi_state: matchRow?.poi_state ?? null,
          match_status: matchRow?.status ?? null,
          match_state: matchRow?.state ?? null,
          token_ledger_rows_for_engagement: ledgerCount ?? 0,
          poi_completed: false,
          wad_triggered: false,
          credit_burned: (ledgerCount ?? 0) > 0,
          payment_event_created: false,
        },
        audits_emitted: {
          "pending_engagement.accepted_after_expiry":
            rpcResult.idempotent ? "already_present" : "inserted",
          "pending_engagement.late_acceptance_reconfirmed_by_initiator":
            "pending — Daniel triggers via UI Reconfirm action (atomic_reconfirm_late_acceptance RPC)",
          "pending_engagement.late_acceptance_declined_by_initiator":
            "pending — Daniel triggers via UI Decline action (atomic_decline_late_acceptance RPC)",
        },
        ui_messages_expected: {
          counterparty:
            "This engagement has expired. Your acceptance has been recorded, but the initiator must reconfirm before the engagement can proceed.",
          initiator:
            "The counterparty accepted after the engagement expired. Please reconfirm whether you still wish to proceed. No POI has been completed, no WaD has been triggered, and no credit has been used.",
        },
        next_step_for_daniel: [
          "Sign in as daniel-platformadmin@test.izenzo.co.za (or daniel-initiator).",
          `Open /admin/engagements?match=${match_id} — confirm engagement_status = late_acceptance_pending_initiator_reconfirmation.`,
          "Confirm Reconfirm and Decline actions are visible to the initiator/admin.",
          "Trigger Reconfirm → expect pending_engagement.late_acceptance_reconfirmed_by_initiator audit row.",
          "Or trigger Decline → expect pending_engagement.late_acceptance_declined_by_initiator audit row.",
          "Confirm no POI mint, no WaD, no execution kickoff, no credit burn, no payment event resulted from the late acceptance alone.",
        ],
      });
    }

    try {
      await admin.from("admin_audit_logs").insert({
        admin_user_id: null,
        action: "demo.fixture_seeded_controlled_production",
        target_type: "system",
        target_id: null,
        details: {
          function: "seed-cp009-controlled-prod",
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          fixture_hashes: requested,
          seeded_by: actor,
          seeded_at: seededAt,
          contacted_at: contactedAtIso,
          expired_at: expiredAtIso,
          production_demo_mode: true,
          environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
        },
      });
    } catch (e) {
      console.error("[seed-cp009-controlled-prod] audit insert failed:", e);
    }

    return json({
      ok: true,
      scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
      seeded_at: seededAt,
      contacted_at: contactedAtIso,
      expired_at: expiredAtIso,
      fixtures: results,
      notes: [
        "Engagement inserted with is_demo=true and rewritten to engagement_status='expired' with contacted_at 10 days ago and expires_at 3 days ago.",
        "atomic_record_late_acceptance RPC was invoked to transition the engagement to late_acceptance_pending_initiator_reconfirmation and emit pending_engagement.accepted_after_expiry (canonical signed audit).",
        "pending_engagement.late_acceptance_reconfirmed_by_initiator and pending_engagement.late_acceptance_declined_by_initiator are intentionally NOT pre-seeded — Daniel must trigger them via the live UI (atomic_reconfirm_late_acceptance / atomic_decline_late_acceptance RPCs) to evidence the dual-path behaviour.",
        "No POI / WaD / execution / credit / payment / notification / outreach side effects were performed by the seeder.",
        "Cleanup: POST /functions/v1/unseed-cp009-controlled-prod with the same scope.",
      ],
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
