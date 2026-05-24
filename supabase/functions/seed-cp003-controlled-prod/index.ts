/**
 * seed-cp003-controlled-prod — CP-003 controlled-production demo-mode
 * seeder for the single signed Daniel acceptance fixture:
 *
 *   DEMO-CP003-EMAIL-NO-NAME-001
 *     counterparty email present, counterparty name / person /
 *     organisation missing, pending engagement visible in the admin
 *     queue, outreach blocked until a valid name is added.
 *
 * Mirrors seed-cp002-controlled-prod exactly except:
 *   - counterparty_email is set (and is_demo @test.izenzo.co.za)
 *   - contact_name / contact_type / counterparty_org_id remain NULL
 *   - emits `pending_engagement.identity_incomplete_email_only_detected`
 *     (the signed CP-003 canonical name) plus the legacy sibling
 *     `pending_engagement.outreach_blocked_missing_name`
 *
 * Hard-gated by:
 *   - `admin_settings.allow_controlled_production_demo_fixtures_cp003.enabled = true`
 *   - scope: "CP-003 Daniel UAT"
 *   - hash allowlist of one
 *
 * Does NOT:
 *   - touch CP-002 / MT-008 / MT-009 / MT-012 / CP-006 / CP-009 / CP-012 / CP-015 fixtures
 *   - send any email / WhatsApp / notification / invite
 *   - mint POI, trigger WaD, burn credits, write payment events
 *   - call lifecycle scheduler, ratings, or compliance pipelines
 *
 * Reuses the Daniel demo orgs/accounts already created by the CP-002
 * and MT-009 seeders.
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
const ALLOWED_FIXTURE_SCOPE = "CP-003 Daniel UAT";
const ALLOWED_FIXTURE_HASHES = ["DEMO-CP003-EMAIL-NO-NAME-001"] as const;
type AllowedHash = typeof ALLOWED_FIXTURE_HASHES[number];

const BANNED_HASH_PREFIXES = [
  "DEMO-CP002-",
  "DEMO-CP006-",
  "DEMO-CP009-",
  "DEMO-CP012-",
  "DEMO-CP015-",
  "DEMO-MT008-",
  "DEMO-MT009-",
  "DEMO-MT012-",
];

const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

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

const ADMIN_FLAG_KEY = "allow_controlled_production_demo_fixtures_cp003";

// CP-003: counterparty email present, name missing. The match deliberately
// does NOT carry a seller_name; the engagement contact_name is null too.
const COUNTERPARTY_EMAIL =
  "daniel-cp003-unregistered-counterparty@test.izenzo.co.za";

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
): Promise<{ ok: true; actor: string | null; actorUserId: string | null } | { ok: false; resp: Response }> {
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
        return { ok: true, actor: data.user.email ?? data.user.id, actorUserId: data.user.id };
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
  const v = (data?.value ?? {}) as { enabled?: boolean; scope?: string; allowed_hashes?: string[] };
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
      throw new Error(`existing match ${hash} is not is_demo=true; refusing to mutate`);
    }
    const merged = { ...(existing.metadata as Record<string, unknown> ?? {}), ...meta };
    await admin
      .from("matches")
      .update({ metadata: merged, seller_name: null })
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
      seller_org_id: null, // unregistered counterparty
      buyer_name: ORG_INITIATOR_NAME,
      seller_name: null, // CP-003: counterparty name deliberately absent
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

async function ensurePendingEngagement(
  admin: SupabaseClient,
  args: {
    match_id: string;
    initiator_org_id: string;
    expires_at: string;
    fixture_code: AllowedHash;
  },
): Promise<{ engagement_id: string; created: boolean }> {
  const { data: existing } = await admin
    .from("poi_engagements")
    .select("id")
    .eq("match_id", args.match_id)
    .eq("is_demo", true)
    .maybeSingle();
  if (existing) {
    await admin
      .from("poi_engagements")
      .update({
        engagement_status: "pending",
        counterparty_type: "unknown",
        counterparty_email: COUNTERPARTY_EMAIL,
        counterparty_org_id: null,
        contact_type: null,
        contact_name: null,
        expires_at: args.expires_at,
        contacted_at: null,
        contact_method: null,
        contact_date: null,
        sla_reminder_sent_at: null,
        sla_reminder_count: 0,
        admin_notes:
          `[DEMO ${args.fixture_code}] CP-003 — email on file, counterparty name missing. Outreach disabled until name/person/organisation is added.`,
      })
      .eq("id", existing.id);
    return { engagement_id: existing.id, created: false };
  }
  const { data, error } = await admin
    .from("poi_engagements")
    .insert({
      match_id: args.match_id,
      org_id: args.initiator_org_id,
      counterparty_org_id: null,
      counterparty_email: COUNTERPARTY_EMAIL,
      counterparty_type: "unknown",
      engagement_status: "pending",
      contact_type: null,
      contact_name: null,
      expires_at: args.expires_at,
      sla_reminder_count: 0,
      is_demo: true,
      source: "admin_manual",
      admin_notes:
        `[DEMO ${args.fixture_code}] CP-003 — email on file, counterparty name missing. Outreach disabled until name/person/organisation is added.`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`engagement create failed (${args.fixture_code}): ${error.message}`);
  return { engagement_id: data.id, created: true };
}

async function emitCp003DetectionAudit(
  admin: SupabaseClient,
  args: {
    engagement_id: string;
    match_id: string;
    org_id: string;
    actor_user_id: string | null;
    fixture_code: AllowedHash;
  },
): Promise<{ detection: boolean; legacy_sibling: boolean }> {
  const result = { detection: false, legacy_sibling: false };

  const baseMeta = {
    engagement_id: args.engagement_id,
    match_id: args.match_id,
    organisation_id: args.org_id,
    counterparty_email: COUNTERPARTY_EMAIL,
    counterparty_email_present: true,
    counterparty_name_present: false,
    counterparty_registration_status: "unregistered",
    status: "pending",
    contact_state: "missing_name",
    outreach_enabled: false,
    outreach_sent: false,
    credit_burned: false,
    reason: "missing_counterparty_name",
    cp_rule: "CP-003",
    surface: "seed-fixture",
    fixture_code: args.fixture_code,
    fixture_scope: ALLOWED_FIXTURE_SCOPE,
    production_demo_mode: true,
    seeded_by: "seed-cp003-controlled-prod",
  };

  // Canonical signed CP-003 detection audit (idempotent).
  const { data: priorDetect } = await admin
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "poi_engagement")
    .eq("entity_id", args.engagement_id)
    .eq("action", "pending_engagement.identity_incomplete_email_only_detected")
    .limit(1)
    .maybeSingle();
  if (!priorDetect) {
    await admin.from("audit_logs").insert({
      org_id: args.org_id,
      actor_user_id: args.actor_user_id,
      action: "pending_engagement.identity_incomplete_email_only_detected",
      entity_type: "poi_engagement",
      entity_id: args.engagement_id,
      metadata: baseMeta,
    });
    result.detection = true;
  }

  // Legacy sibling (preserved for backwards compatibility).
  const { data: priorLegacy } = await admin
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "poi_engagement")
    .eq("entity_id", args.engagement_id)
    .eq("action", "pending_engagement.outreach_blocked_missing_name")
    .limit(1)
    .maybeSingle();
  if (!priorLegacy) {
    await admin.from("audit_logs").insert({
      org_id: args.org_id,
      actor_user_id: args.actor_user_id,
      action: "pending_engagement.outreach_blocked_missing_name",
      entity_type: "poi_engagement",
      entity_id: args.engagement_id,
      metadata: baseMeta,
    });
    result.legacy_sibling = true;
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const authResult = await authorise(req, admin);
  if (!authResult.ok) return authResult.resp;
  const { actor, actorUserId: _actorUserId } = authResult;

  let body: {
    confirm?: string;
    password?: string;
    scope?: string;
    hashes?: string[];
    expires_at?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  if (body.confirm !== "RUN_SEED_CP003_CONTROLLED_PROD") {
    return json({ error: "confirm token missing or wrong" }, 400);
  }
  const password = body.password;
  if (!password || password.length < 12) {
    return json({ error: "password (min 12 chars) required in request body — never logged" }, 400);
  }
  if (body.scope !== ALLOWED_FIXTURE_SCOPE) {
    return json({ error: "SCOPE_NOT_ALLOWED", expected: ALLOWED_FIXTURE_SCOPE }, 400);
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

  const now = Date.now();
  const maxExpiry = now + MAX_EXPIRY_MS;
  let expiresAtMs = now + MAX_EXPIRY_MS;
  if (body.expires_at) {
    const parsed = Date.parse(body.expires_at);
    if (Number.isNaN(parsed)) return json({ error: "expires_at must be ISO-8601" }, 400);
    if (parsed > maxExpiry) {
      return json(
        { error: "EXPIRY_TOO_LONG", max_allowed: new Date(maxExpiry).toISOString() },
        400,
      );
    }
    if (parsed <= now) return json({ error: "expires_at must be in the future" }, 400);
    expiresAtMs = parsed;
  }
  const expiresAt = new Date(expiresAtMs).toISOString();

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
            function: "seed-cp003-controlled-prod",
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
            `admin_settings.${ADMIN_FLAG_KEY}.enabled must be true to seed CP-003 fixtures in production.`,
        },
        403,
      );
    }
    if (flag.scope !== ALLOWED_FIXTURE_SCOPE) {
      return json(
        { error: "CONTROLLED_SCOPE_MISMATCH", expected: ALLOWED_FIXTURE_SCOPE, got: flag.scope },
        403,
      );
    }
    for (const h of requested) {
      if (!flag.allowed.includes(h)) {
        return json(
          { error: "HASH_NOT_IN_PERSISTED_ALLOWLIST", hash: h, persisted_allowlist: flag.allowed },
          403,
        );
      }
    }
  }

  try {
    const initiatorOrgId = await findOrCreateOrg(admin, ORG_INITIATOR_NAME);
    // Counterparty parking org; the CP-003 match deliberately leaves
    // seller_org_id NULL (unregistered counterparty shape).
    const counterpartyOrgId = await findOrCreateOrg(admin, ORG_COUNTERPARTY_NAME);

    const userIds: Record<string, string> = {};
    for (const acc of ACCOUNTS) {
      if (!acc.email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) {
        throw new Error(`account ${acc.email} not allowed (must end with ${TEST_EMAIL_SUFFIX})`);
      }
      const uid = await findOrCreateUser(admin, acc.email, password, acc.full_name);
      userIds[acc.key] = uid;
      const orgForProfile = acc.org === "initiator" ? initiatorOrgId : counterpartyOrgId;
      await upsertProfile(admin, uid, orgForProfile, acc.email, acc.full_name);
      await upsertRole(admin, uid, acc.role);
    }
    const platformAdminUserId = userIds["platform_admin"];

    const seededAt = new Date().toISOString();
    const baseMeta = {
      demo_fixture: true,
      fixture_scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      seeded_at: seededAt,
      seeded_by: actor ?? "seed-cp003-controlled-prod",
      expires_at: expiresAt,
    };

    const results: Record<string, unknown>[] = [];
    for (const hash of requested as AllowedHash[]) {
      const meta = { ...baseMeta, fixture_code: hash };
      const { match_id, created: matchCreated } = await ensureMatch(
        admin,
        hash,
        initiatorOrgId,
        meta,
      );
      const { engagement_id, created: engCreated } = await ensurePendingEngagement(admin, {
        match_id,
        initiator_org_id: initiatorOrgId,
        expires_at: expiresAt,
        fixture_code: hash,
      });
      const auditResult = await emitCp003DetectionAudit(admin, {
        engagement_id,
        match_id,
        org_id: initiatorOrgId,
        actor_user_id: platformAdminUserId,
        fixture_code: hash,
      });

      results.push({
        fixture_hash: hash,
        match_id,
        engagement_id,
        route_admin: `/admin/engagements?match=${match_id}`,
        route_initiator: `/desk/match/${match_id}`,
        match_created_or_reused: matchCreated ? "created" : "reused",
        engagement_created_or_reused: engCreated ? "created" : "reused",
        counterparty_email: COUNTERPARTY_EMAIL,
        counterparty_email_present: true,
        counterparty_name: null,
        counterparty_name_present: false,
        counterparty_org_id: null,
        counterparty_type: "unknown",
        engagement_status: "pending",
        contact_state: "missing_name",
        outreach_enabled: false,
        audits_emitted: {
          "pending_engagement.identity_incomplete_email_only_detected":
            auditResult.detection ? "inserted" : "already_present",
          "pending_engagement.outreach_blocked_missing_name":
            auditResult.legacy_sibling ? "inserted" : "already_present",
        },
        next_step_for_daniel: [
          "Attempt outreach via /admin/engagements — Send outreach must be disabled / blocked.",
          "Use Add/Edit contact to provide a counterparty name and re-attempt.",
          "Look for a second audit row " +
            "`pending_engagement.outreach_blocked_missing_counterparty_name` " +
            "if you exercise the preview/send-outreach blocked path.",
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
          function: "seed-cp003-controlled-prod",
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          fixture_hashes: requested,
          seeded_by: actor,
          seeded_at: seededAt,
          expires_at: expiresAt,
          production_demo_mode: true,
          environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
        },
      });
    } catch (e) {
      console.error("[seed-cp003-controlled-prod] audit insert failed:", e);
    }

    return json({
      ok: true,
      scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
      seeded_at: seededAt,
      expires_at: expiresAt,
      fixtures: results,
      notes: [
        "Engagement inserted with is_demo=true, counterparty_type='unknown', engagement_status='pending', counterparty_email set, contact_name NULL.",
        "Match seller_name and seller_org_id deliberately NULL (CP-003 missing-name shape).",
        "pending_engagement.identity_incomplete_email_only_detected audit row emitted once per engagement (canonical signed name).",
        "pending_engagement.outreach_blocked_missing_name legacy sibling also emitted for backward compatibility.",
        "The second canonical audit `pending_engagement.outreach_blocked_missing_counterparty_name` is emitted by live poi-engagements code when Daniel attempts preview-outreach / send-outreach on this fixture — it is intentionally NOT pre-seeded.",
        "No POI / WaD / payment / credit / token / notification / email / outreach side effects.",
        "Cleanup: POST /functions/v1/unseed-cp003-controlled-prod with the same scope.",
      ],
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
