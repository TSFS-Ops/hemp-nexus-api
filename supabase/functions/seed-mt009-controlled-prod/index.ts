/**
 * seed-mt009-controlled-prod — Controlled production demo-mode seeder.
 *
 * NARROW, AUDITED, ALLOWLISTED exception to the production seed lockout.
 * Only the five MT-009 Phase 2 fixtures listed in ALLOWED_FIXTURE_HASHES
 * may be inserted, and only when the explicit operator flag
 * `admin_settings.allow_controlled_production_demo_fixtures.enabled = true`
 * is in place.
 *
 * Does NOT:
 *   - weaken `is_production_environment()` or the `seed-daniel-fixtures`
 *     production guard;
 *   - touch MT-008 / MT-012 fixtures;
 *   - create POI / WaD / payment / credit / token / notification / email
 *     / rating / compliance / lifecycle side effects;
 *   - send emails, invites, or notifications;
 *   - wire any hard MT-009 progression block.
 *
 * Auth: same contract as seed-daniel-fixtures.
 *   - INTERNAL_CRON_KEY via x-internal-key header, OR
 *   - SUPABASE_SERVICE_ROLE_KEY via Authorization: Bearer …, OR
 *   - platform_admin JWT.
 *
 * Request:
 *   POST /functions/v1/seed-mt009-controlled-prod
 *   {
 *     "confirm": "RUN_SEED_MT009_CONTROLLED_PROD",
 *     "password": "<min 12 chars>",
 *     "scope":    "MT-009 Phase 2 Daniel UAT",
 *     "hashes":   ["DEMO-MT009-NC-...", "..."],
 *     "expires_at": "<ISO, optional; max now + 30d>"
 *   }
 *
 * Reuses existing Daniel @test.izenzo.co.za accounts and demo orgs already
 * created by seed-daniel-fixtures (idempotent upsert here too).
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const TEST_EMAIL_SUFFIX = "@test.izenzo.co.za";

const ALLOWED_FIXTURE_SCOPE = "MT-009 Phase 2 Daniel UAT";
const ALLOWED_FIXTURE_HASHES = [
  "DEMO-MT009-NC-BUYERMISSING-001",
  "DEMO-MT009-NC-SELLERMISSING-002",
  "DEMO-MT009-NC-BOTHMISSING-003",
  "DEMO-MT009-NC-REPLACEBUYER-004",
  "DEMO-MT009-NC-CLEAN-005",
] as const;
type AllowedHash = typeof ALLOWED_FIXTURE_HASHES[number];

// Explicitly-banned hashes that must never be touched by this function,
// even if (somehow) added to the request body. Defence in depth.
const BANNED_HASH_PREFIXES = ["DEMO-MT008-", "DEMO-MT012-"];

const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const ORG_INITIATOR_NAME = "DEMO Daniel Initiator Org";
const ORG_COUNTERPARTY_NAME = "DEMO Daniel Counterparty Org";

const ACCOUNTS = [
  {
    key: "platform_admin",
    email: "daniel-platformadmin@test.izenzo.co.za",
    full_name: "Daniel (Platform Admin · DEMO)",
    role: "platform_admin" as const,
    org: "initiator" as const, // parking org for profiles.org_id NOT NULL
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

function isProductionTier(): boolean {
  const tier = (Deno.env.get("ENVIRONMENT_TIER") ?? "").toLowerCase();
  return tier === "production" || tier === "live" || tier === "prod";
}

async function authorise(
  req: Request,
  admin: SupabaseClient,
): Promise<{ ok: true; actor: string | null } | { ok: false; resp: Response }> {
  const internal = req.headers.get("x-internal-key");
  if (INTERNAL_CRON_KEY && internal && internal === INTERNAL_CRON_KEY) {
    return { ok: true, actor: "internal_cron" };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return { ok: true, actor: "service_role" };
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
      if (roleRow) return { ok: true, actor: data.user.email ?? data.user.id };
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
    .eq("key", "allow_controlled_production_demo_fixtures")
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

// ── Daniel account / org upserts (idempotent; reused across re-seeds) ──

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

// ── MT-009 match + named contact upserts ──────────────────────────────

interface MatchUpsertResult {
  match_id: string;
  created: boolean;
}

async function ensureMt009Match(
  admin: SupabaseClient,
  hash: AllowedHash,
  buyer_org_id: string,
  seller_org_id: string,
  meta: Record<string, unknown>,
): Promise<MatchUpsertResult> {
  // Lookup by (org_id, hash) — buyer is creator.
  const { data: existing } = await admin
    .from("matches")
    .select("id, is_demo, metadata")
    .eq("org_id", buyer_org_id)
    .eq("hash", hash)
    .maybeSingle();
  if (existing) {
    if (existing.is_demo !== true) {
      // Refuse to touch any row that is not already a demo row.
      throw new Error(
        `existing match ${hash} is not is_demo=true; refusing to mutate non-demo production row`,
      );
    }
    const merged = { ...(existing.metadata as Record<string, unknown> ?? {}), ...meta };
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
      seller_org_id,
      buyer_name: ORG_INITIATOR_NAME,
      seller_name: "DEMO Counterparty Co.",
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

async function ensureSeededNamedContact(
  admin: SupabaseClient,
  args: {
    match_id: string;
    side: "buyer" | "seller";
    org_id: string;
    contact_name: string;
    contact_email: string;
    assigned_by_user_id: string;
    fixture_code: AllowedHash;
    fixture_scope: string;
  },
): Promise<string> {
  // Hard re-assert is_demo on match before touching its children.
  const { data: m } = await admin
    .from("matches")
    .select("id, is_demo")
    .eq("id", args.match_id)
    .eq("is_demo", true)
    .maybeSingle();
  if (!m) {
    throw new Error(
      `ensureSeededNamedContact: match not is_demo (${args.fixture_code})`,
    );
  }
  const { data: existing } = await admin
    .from("match_named_contacts")
    .select("id")
    .eq("match_id", args.match_id)
    .eq("side", args.side)
    .eq("status", "active")
    .maybeSingle();
  if (existing) return existing.id;
  const { data: inserted, error } = await admin
    .from("match_named_contacts")
    .insert({
      match_id: args.match_id,
      side: args.side,
      org_id: args.org_id,
      contact_name: args.contact_name,
      contact_email: args.contact_email,
      assigned_by_user_id: args.assigned_by_user_id,
      assigned_by_role: "platform_admin_override",
      status: "active",
      metadata: {
        demo_fixture: true,
        fixture_code: args.fixture_code,
        fixture_scope: args.fixture_scope,
        production_demo_mode: true,
        seeded_by: "seed-mt009-controlled-prod",
      },
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(
      `ensureSeededNamedContact insert failed (${args.fixture_code}/${args.side}): ${error.message}`,
    );
  }
  return inserted.id;
}

// Per-fixture seeding shape. Returns the rich verification payload.
async function seedOneFixture(
  admin: SupabaseClient,
  args: {
    hash: AllowedHash;
    buyer_org_id: string;
    seller_org_id: string;
    platform_admin_user_id: string;
    meta: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const { hash, buyer_org_id, seller_org_id, platform_admin_user_id, meta } = args;
  const { match_id, created } = await ensureMt009Match(
    admin,
    hash,
    buyer_org_id,
    seller_org_id,
    meta,
  );

  const seedContact = (side: "buyer" | "seller", suffix: string) =>
    ensureSeededNamedContact(admin, {
      match_id,
      side,
      org_id: side === "buyer" ? buyer_org_id : seller_org_id,
      contact_name:
        side === "buyer" ? "DEMO Buyer Authorised Contact" : "DEMO Seller Authorised Contact",
      contact_email: `demo-${side}-${suffix}@example.invalid`,
      assigned_by_user_id: platform_admin_user_id,
      fixture_code: hash,
      fixture_scope: ALLOWED_FIXTURE_SCOPE,
    });

  // Mirror the gap pattern from seed-daniel-fixtures so the panel renders
  // the same shape in production demo mode.
  switch (hash) {
    case "DEMO-MT009-NC-BUYERMISSING-001":
      await seedContact("seller", "nc-001");
      break;
    case "DEMO-MT009-NC-SELLERMISSING-002":
      await seedContact("buyer", "nc-002");
      break;
    case "DEMO-MT009-NC-BOTHMISSING-003":
      // no pre-seeded contacts
      break;
    case "DEMO-MT009-NC-REPLACEBUYER-004":
      await seedContact("buyer", "initial-004");
      await seedContact("seller", "nc-004");
      break;
    case "DEMO-MT009-NC-CLEAN-005":
      await seedContact("buyer", "nc-005");
      await seedContact("seller", "nc-005");
      break;
  }

  // Verification fields.
  const { count: activeContactCount } = await admin
    .from("match_named_contacts")
    .select("id", { count: "exact", head: true })
    .eq("match_id", match_id)
    .eq("status", "active");
  const { data: contactRows } = await admin
    .from("match_named_contacts")
    .select("side, status")
    .eq("match_id", match_id)
    .eq("status", "active");
  const buyerActive = (contactRows ?? []).some((r) => r.side === "buyer");
  const sellerActive = (contactRows ?? []).some((r) => r.side === "seller");
  const requiresNamedContact = !buyerActive && !sellerActive
    ? "both"
    : !buyerActive
      ? "buyer"
      : !sellerActive
        ? "seller"
        : null;

  return {
    fixture_hash: hash,
    match_id,
    route: `/desk/match/${match_id}`,
    created_or_reused: created ? "created" : "reused",
    active_named_contact_count: activeContactCount ?? 0,
    requires_named_contact: requiresNamedContact,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body, null, 2), {
      status,
      headers: corsHeaders,
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const authResult = await authorise(req, admin);
  if (!authResult.ok) return authResult.resp;
  const actor = authResult.actor;

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

  if (body.confirm !== "RUN_SEED_MT009_CONTROLLED_PROD") {
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
      {
        error: "SCOPE_NOT_ALLOWED",
        message: `scope must equal "${ALLOWED_FIXTURE_SCOPE}"`,
      },
      400,
    );
  }
  const requested = Array.isArray(body.hashes) ? body.hashes : [];
  if (requested.length === 0) {
    return json({ error: "hashes (non-empty array) required" }, 400);
  }
  // Allowlist + ban check.
  for (const h of requested) {
    if (BANNED_HASH_PREFIXES.some((p) => h.startsWith(p))) {
      return json(
        { error: "BANNED_HASH", message: `hash ${h} is explicitly banned` },
        400,
      );
    }
    if (!ALLOWED_FIXTURE_HASHES.includes(h as AllowedHash)) {
      return json(
        {
          error: "HASH_NOT_ALLOWED",
          message: `hash ${h} not in MT-009 Phase 2 allowlist`,
          allowed: ALLOWED_FIXTURE_HASHES,
        },
        400,
      );
    }
  }

  // Expiry guard: default now + 30d, cap at now + 30d.
  const now = Date.now();
  const maxExpiry = now + MAX_EXPIRY_MS;
  let expiresAtMs = now + MAX_EXPIRY_MS;
  if (body.expires_at) {
    const parsed = Date.parse(body.expires_at);
    if (Number.isNaN(parsed)) {
      return json({ error: "expires_at must be ISO-8601" }, 400);
    }
    if (parsed > maxExpiry) {
      return json(
        {
          error: "EXPIRY_TOO_LONG",
          message: "expires_at cannot exceed now + 30 days",
          max_allowed: new Date(maxExpiry).toISOString(),
        },
        400,
      );
    }
    if (parsed <= now) {
      return json({ error: "expires_at must be in the future" }, 400);
    }
    expiresAtMs = parsed;
  }
  const expiresAt = new Date(expiresAtMs).toISOString();

  // Production-tier gate: in production, require the controlled flag AND
  // the persisted allowlist to also contain every requested hash.
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
            function: "seed-mt009-controlled-prod",
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
            "admin_settings.allow_controlled_production_demo_fixtures.enabled must be true to seed MT-009 fixtures in production.",
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
    // 1. Orgs (re-used across the Daniel fixture system).
    const initiatorOrgId = await findOrCreateOrg(admin, ORG_INITIATOR_NAME);
    const counterpartyOrgId = await findOrCreateOrg(admin, ORG_COUNTERPARTY_NAME);

    // 2. Accounts (only @test.izenzo.co.za; no new accounts beyond the
    //    existing three Daniel test users).
    const userIds: Record<string, string> = {};
    for (const acc of ACCOUNTS) {
      if (!acc.email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) {
        throw new Error(`account ${acc.email} not allowed (must end with ${TEST_EMAIL_SUFFIX})`);
      }
      const uid = await findOrCreateUser(admin, acc.email, password, acc.full_name);
      userIds[acc.key] = uid;
      const orgForProfile =
        acc.org === "initiator" ? initiatorOrgId : counterpartyOrgId;
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
      seeded_by: actor ?? "seed-mt009-controlled-prod",
      expires_at: expiresAt,
    };

    const results: Record<string, unknown>[] = [];
    for (const hash of requested as AllowedHash[]) {
      const meta = { ...baseMeta, fixture_code: hash };
      const r = await seedOneFixture(admin, {
        hash,
        buyer_org_id: initiatorOrgId,
        seller_org_id: counterpartyOrgId,
        platform_admin_user_id: platformAdminUserId,
        meta,
      });
      results.push(r);
    }

    // Audit.
    try {
      await admin.from("admin_audit_logs").insert({
        admin_user_id: null,
        action: "demo.fixture_seeded_controlled_production",
        target_type: "system",
        target_id: null,
        details: {
          function: "seed-mt009-controlled-prod",
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
      console.error("[seed-mt009-controlled-prod] audit insert failed:", e);
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
        "All matches inserted with is_demo=true and the full controlled-production metadata envelope.",
        "No POI / WaD / payment / credit / token / notification / email / lifecycle side effects.",
        "Cleanup: POST /functions/v1/unseed-mt009-controlled-prod with the same scope.",
      ],
    });
  } catch (err) {
    return json(
      { ok: false, error: (err as Error).message },
      500,
    );
  }
});
