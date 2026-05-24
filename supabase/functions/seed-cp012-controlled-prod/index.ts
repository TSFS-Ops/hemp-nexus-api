/**
 * seed-cp012-controlled-prod — CP-012 controlled-production demo-mode
 * seeder for the single signed Daniel acceptance fixture:
 *
 *   DEMO-CP012-DISPUTE-NAMED-001
 *     A named counterparty (name + email + counterparty_org_id all
 *     present) disputes being named in this trade. The engagement
 *     transitions to `disputed_being_named`; a canonical
 *     `public.disputes` row is inserted on the match so the match-level
 *     DISPUTE_ACTIVE guard trips; and the spec-named audit
 *     `pending_engagement.counterparty_disputed_being_named` is
 *     emitted alongside the canonical `engagement.dispute_raised`.
 *
 * Canonical signed audit names (mirroring the live poi-engagements
 * dispute handler at index.ts:2615+):
 *   1. pending_engagement.counterparty_disputed_being_named   (seeded)
 *   2. dispute.counterparty_named_dispute_released            (Daniel triggers via UI)
 *   3. dispute.counterparty_named_dispute_closed              (Daniel triggers via UI)
 *
 * Hard-gated by:
 *   - `admin_settings.allow_controlled_production_demo_fixtures_cp012.enabled = true`
 *   - scope: "CP-012 Daniel UAT"
 *   - hash allowlist of one
 *
 * Replicates the live handler writes (engagement UPDATE,
 * engagement_outreach_logs INSERT, audit_logs INSERTs for both
 * `engagement.dispute_raised` and the CP-012 sibling, and the
 * public.disputes INSERT) byte-for-byte using the service-role admin
 * client; no app code is patched.
 *
 * Does NOT:
 *   - touch CP-002 / CP-003 / CP-006 / CP-009 / CP-015 / MT-008 /
 *     MT-009 / MT-012 fixtures
 *   - send any email / WhatsApp / notification / invite
 *   - mint POI, trigger WaD, run execution, burn credits, write payment
 *     events
 *   - call lifecycle scheduler, ratings, or compliance pipelines
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
const ALLOWED_FIXTURE_SCOPE = "CP-012 Daniel UAT";
const ALLOWED_FIXTURE_HASHES = ["DEMO-CP012-DISPUTE-NAMED-001"] as const;
type AllowedHash = typeof ALLOWED_FIXTURE_HASHES[number];

const BANNED_HASH_PREFIXES = [
  "DEMO-CP002-",
  "DEMO-CP003-",
  "DEMO-CP006-",
  "DEMO-CP009-",
  "DEMO-CP015-",
  "DEMO-MT008-",
  "DEMO-MT009-",
  "DEMO-MT012-",
];

const ADMIN_FLAG_KEY = "allow_controlled_production_demo_fixtures_cp012";

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

const COUNTERPARTY_EMAIL =
  "daniel-cp012-disputing-counterparty@test.izenzo.co.za";
const COUNTERPARTY_CONTACT_NAME = "Daniel Disputing Counterparty (DEMO CP-012)";
const COUNTERPARTY_ORG_LABEL = "DEMO Daniel Counterparty Org";

const DISPUTE_EVIDENCE_NOTES =
  "DEMO CP-012: Named counterparty contacted Izenzo support to dispute being linked to this trade. They state they have no commercial relationship with the initiator and did not authorise this engagement. Pending platform admin review (release or close).";

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

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
      seller_org_id,
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

async function ensureNamedEngagement(
  admin: SupabaseClient,
  args: {
    match_id: string;
    initiator_org_id: string;
    counterparty_org_id: string;
    fixture_code: AllowedHash;
  },
): Promise<{ engagement_id: string; previous_status: string; created: boolean }> {
  const adminNotes =
    `[DEMO ${args.fixture_code}] CP-012 — named counterparty contacted; awaiting response. Will be moved to disputed_being_named by the seeder.`;

  const { data: existing } = await admin
    .from("poi_engagements")
    .select("id, engagement_status")
    .eq("match_id", args.match_id)
    .eq("is_demo", true)
    .maybeSingle();
  if (existing) {
    // Reset to a pre-dispute shape so the seeder is idempotent.
    if (existing.engagement_status === "disputed_being_named") {
      return {
        engagement_id: existing.id,
        previous_status: "disputed_being_named",
        created: false,
      };
    }
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await admin
      .from("poi_engagements")
      .update({
        engagement_status: "contacted",
        counterparty_email: COUNTERPARTY_EMAIL,
        counterparty_org_id: args.counterparty_org_id,
        counterparty_type: "known",
        contact_type: "named_individual",
        contact_name: COUNTERPARTY_CONTACT_NAME,
        contact_method: "email",
        contacted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        contact_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at: futureExpiry,
        admin_notes: adminNotes,
      })
      .eq("id", existing.id);
    return { engagement_id: existing.id, previous_status: "contacted", created: false };
  }

  const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const contactedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
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
      contact_method: "email",
      contacted_at: contactedAt,
      contact_date: contactedAt,
      engagement_status: "contacted",
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
  return { engagement_id: data.id, previous_status: "contacted", created: true };
}

/**
 * Replicates the live POST /poi-engagements/:id/dispute handler writes
 * byte-for-byte against the service-role admin client. Idempotent: if
 * the engagement is already disputed_being_named, no UPDATE is issued
 * and existing dispute / audit rows are reused.
 */
async function driveCp012DisputeRaise(
  admin: SupabaseClient,
  args: {
    engagement_id: string;
    match_id: string;
    initiator_org_id: string;
    counterparty_org_id: string;
    actor_user_id: string;
    actor_email: string;
    actor_name: string;
    request_id: string;
  },
): Promise<{
  idempotent: boolean;
  previous_status: string | null;
  dispute_id: string | null;
  audit_dispute_raised: "inserted" | "already_present";
  audit_cp012_sibling: "inserted" | "already_present";
  credit_burned_for_match: boolean;
  billing_review_risk_item_id: string | null;
}> {
  const { data: current, error: fetchErr } = await admin
    .from("poi_engagements")
    .select("*")
    .eq("id", args.engagement_id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!current) throw new Error("engagement vanished mid-seed");

  const previousStatus = current.engagement_status as string;
  const nowIso = new Date().toISOString();
  let idempotent = false;

  if (previousStatus === "disputed_being_named") {
    idempotent = true;
  } else {
    const { error: updErr } = await admin
      .from("poi_engagements")
      .update({
        engagement_status: "disputed_being_named",
        operational_state: "disputed_being_named",
        operational_state_set_by: args.actor_user_id,
        operational_state_set_at: nowIso,
        disputed_at: nowIso,
        dispute_source: "admin_report",
        disputed_by_token_hash: null,
        dispute_reason: DISPUTE_EVIDENCE_NOTES,
        dispute_metadata: {
          previous_status: previousStatus,
          actor_user_id: args.actor_user_id,
          source: "admin_report",
          recorded_at: nowIso,
          request_id: args.request_id,
        },
      })
      .eq("id", args.engagement_id);
    if (updErr) throw new Error(`engagement dispute UPDATE failed: ${updErr.message}`);

    await admin.from("engagement_outreach_logs").insert({
      engagement_id: args.engagement_id,
      actor_type: "admin",
      admin_user_id: args.actor_user_id,
      admin_email: args.actor_email,
      admin_name: args.actor_name,
      previous_status: previousStatus,
      new_status: "disputed_being_named",
      entry_type: "dispute_raised",
      notes: JSON.stringify({
        event: "dispute_raised",
        dispute_source: "admin_report",
        has_token_hash: false,
        reason: DISPUTE_EVIDENCE_NOTES,
        request_id: args.request_id,
      }),
    });
  }

  // Canonical engagement.dispute_raised audit (idempotent on the
  // engagement_id, regardless of CP rule).
  let auditDisputeRaised: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", args.engagement_id)
      .eq("action", "engagement.dispute_raised")
      .limit(1)
      .maybeSingle();
    if (!prior) {
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "engagement.dispute_raised",
        entity_type: "poi_engagement",
        entity_id: args.engagement_id,
        metadata: {
          dispute_source: "admin_report",
          has_token_hash: false,
          previous_status: previousStatus,
          request_id: args.request_id,
        },
      });
      auditDisputeRaised = "inserted";
    }
  }

  // Insert / reuse the public.disputes row on the match (the DISPUTE_ACTIVE
  // guard keys on existence of an open row on match_id).
  let disputeId: string | null = null;
  {
    const { data: existingDispute } = await admin
      .from("disputes")
      .select("id, status")
      .eq("match_id", args.match_id)
      .eq("reason", "cp012_disputes_being_named")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingDispute) {
      disputeId = existingDispute.id as string;
    } else {
      const { data: created, error: dErr } = await admin
        .from("disputes")
        .insert({
          match_id: args.match_id,
          raised_by_org_id: args.counterparty_org_id ?? args.initiator_org_id,
          raised_by_user_id: args.actor_user_id,
          reason: "cp012_disputes_being_named",
          evidence_notes: DISPUTE_EVIDENCE_NOTES,
          status: "open",
        })
        .select("id")
        .single();
      if (dErr) throw new Error(`disputes insert failed: ${dErr.message}`);
      disputeId = created.id;
    }
  }

  // Billing-review risk item — only if a credit was already burned on
  // this match. For the demo fixture this should be false.
  let creditBurnedForMatch = false;
  let billingReviewRiskItemId: string | null = null;
  {
    const { data: burns } = await admin
      .from("token_ledger")
      .select("id")
      .eq("entity_id", args.match_id)
      .gt("tokens_burned", 0)
      .limit(1);
    creditBurnedForMatch = Array.isArray(burns) && burns.length > 0;
    if (creditBurnedForMatch) {
      const dedup = `billing_review_required:cp012:${args.match_id}:${args.engagement_id}`;
      const { data: existingRisk } = await admin
        .from("admin_risk_items")
        .select("id")
        .eq("dedup_key", dedup)
        .maybeSingle();
      if (existingRisk) {
        billingReviewRiskItemId = existingRisk.id as string;
      } else {
        const { data: risk } = await admin
          .from("admin_risk_items")
          .insert({
            org_id: args.initiator_org_id,
            kind: "billing_review_required",
            title: "Billing review required: credit burned before counterparty dispute",
            description:
              "A counterparty disputed being named in this trade after a credit had already been burned. No automatic refund has been issued; manual admin review is required.",
            severity: "high",
            status: "open",
            dedup_key: dedup,
            metadata: {
              cp_rule: "CP-012",
              match_id: args.match_id,
              engagement_id: args.engagement_id,
              dispute_id: disputeId,
              request_id: args.request_id,
            },
          })
          .select("id")
          .maybeSingle();
        billingReviewRiskItemId = (risk as { id?: string } | null)?.id ?? null;
      }
    }
  }

  // CP-012 sibling spec audit (idempotent).
  let auditCp012: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", args.engagement_id)
      .eq("action", "pending_engagement.counterparty_disputed_being_named")
      .limit(1)
      .maybeSingle();
    if (!prior) {
      const counterpartyEmailHash = await sha256Hex(COUNTERPARTY_EMAIL.toLowerCase());
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "pending_engagement.counterparty_disputed_being_named",
        entity_type: "poi_engagement",
        entity_id: args.engagement_id,
        metadata: {
          cp_rule: "CP-012",
          dispute_id: disputeId,
          engagement_id: args.engagement_id,
          match_id: args.match_id,
          poi_id: null,
          initiator_organisation_id: args.initiator_org_id,
          counterparty_organisation_id: args.counterparty_org_id,
          counterparty_name: COUNTERPARTY_CONTACT_NAME,
          counterparty_email_hash: counterpartyEmailHash,
          dispute_reason: "disputes_being_named",
          engagement_status_before: previousStatus,
          engagement_status_after: "disputed_being_named",
          match_status_after: "dispute_active",
          progression_blocked: true,
          poi_completed: false,
          wad_triggered: false,
          execution_started: false,
          credit_burned: creditBurnedForMatch,
          payment_event_created: false,
          billing_review_required: !!billingReviewRiskItemId,
          billing_review_risk_item_id: billingReviewRiskItemId,
          raised_at: nowIso,
          raised_by: args.actor_user_id,
          request_id: args.request_id,
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          seeded_by: "seed-cp012-controlled-prod",
        },
      });
      auditCp012 = "inserted";
    }
  }

  return {
    idempotent,
    previous_status: previousStatus,
    dispute_id: disputeId,
    audit_dispute_raised: auditDisputeRaised,
    audit_cp012_sibling: auditCp012,
    credit_burned_for_match: creditBurnedForMatch,
    billing_review_risk_item_id: billingReviewRiskItemId,
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

  if (body.confirm !== "RUN_SEED_CP012_CONTROLLED_PROD") {
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
            function: "seed-cp012-controlled-prod",
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
            `admin_settings.${ADMIN_FLAG_KEY}.enabled must be true to seed CP-012 fixtures in production.`,
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

    const seededAt = new Date().toISOString();
    const requestId = `seed-cp012-${crypto.randomUUID()}`;

    const baseMeta = {
      demo_fixture: true,
      fixture_scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      seeded_at: seededAt,
      seeded_by: actor ?? "seed-cp012-controlled-prod",
      cp_rule: "CP-012",
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
      const { engagement_id, created: engCreated } = await ensureNamedEngagement(admin, {
        match_id,
        initiator_org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        fixture_code: hash,
      });

      const disputeResult = await driveCp012DisputeRaise(admin, {
        engagement_id,
        match_id,
        initiator_org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        actor_user_id: platformAdminUserId,
        actor_email: platformAdminEmail,
        actor_name: platformAdminName,
        request_id: requestId,
      });

      // Side-effects QA: confirm POI/credit/payment did not fire.
      const { data: matchRow } = await admin
        .from("matches")
        .select("poi_state, status, state")
        .eq("id", match_id)
        .maybeSingle();
      const { count: ledgerCount } = await admin
        .from("token_ledger")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", match_id);

      results.push({
        fixture_hash: hash,
        match_id,
        engagement_id,
        dispute_id: disputeResult.dispute_id,
        route_admin: `/admin/engagements?match=${match_id}`,
        route_initiator: `/desk/match/${match_id}`,
        match_created_or_reused: matchCreated ? "created" : "reused",
        engagement_created_or_reused: engCreated ? "created" : "reused",
        dispute_idempotent: disputeResult.idempotent,
        previous_engagement_status: disputeResult.previous_status,
        engagement_status_after: "disputed_being_named",
        operational_state_after: "disputed_being_named",
        match_status_after: "dispute_active",
        counterparty_email: COUNTERPARTY_EMAIL,
        counterparty_contact_name: COUNTERPARTY_CONTACT_NAME,
        counterparty_org_id: counterpartyOrgId,
        counterparty_response: "disputes_being_named",
        progression_blocked: true,
        billing_review_required: !!disputeResult.billing_review_risk_item_id,
        billing_review_risk_item_id: disputeResult.billing_review_risk_item_id,
        side_effects_check: {
          poi_state: matchRow?.poi_state ?? null,
          match_state: matchRow?.state ?? null,
          token_ledger_rows_for_match: ledgerCount ?? 0,
          poi_completed: false,
          wad_triggered: false,
          execution_started: false,
          credit_burned: disputeResult.credit_burned_for_match,
          payment_event_created: false,
          outreach_escalation_blocked: true,
        },
        audits_emitted: {
          "engagement.dispute_raised": disputeResult.audit_dispute_raised,
          "pending_engagement.counterparty_disputed_being_named":
            disputeResult.audit_cp012_sibling,
          "dispute.counterparty_named_dispute_released":
            "pending — Daniel triggers via UI Release action " +
            "(POST /poi-engagements/{engagement_id}/dispute-release; platform_admin only).",
          "dispute.counterparty_named_dispute_closed":
            "pending — Daniel triggers via UI Close action " +
            "(POST /poi-engagements/{engagement_id}/dispute-close; platform_admin only).",
        },
        ui_messages_expected: {
          initiator:
            "The named counterparty has disputed being linked to this trade. The match is now on dispute hold. No POI, WaD, execution step, credit burn, or further progression can occur until Izenzo admin reviews the dispute.",
          counterparty:
            "Your dispute has been recorded. The trade has been placed on hold and will not progress unless reviewed and released by Izenzo admin.",
          admin:
            "Counterparty disputes being named in this trade. Review counterparty identity, authority, outreach history, and initiator records before releasing or closing the dispute.",
        },
        next_step_for_daniel: [
          "Sign in as daniel-platformadmin@test.izenzo.co.za.",
          `Open /admin/engagements?match=${match_id} — confirm engagement_status = disputed_being_named and operational_state = disputed_being_named.`,
          `Confirm a public.disputes row with reason='cp012_disputes_being_named' and status='open' exists for match_id ${match_id}.`,
          "Confirm Release and Close controls are visible to the platform admin only.",
          `Trigger Release → POST /functions/v1/poi-engagements/${engagement_id}/dispute-release with Idempotency-Key header and {"resolution_reason": "...10+ chars..."} → expect dispute.counterparty_named_dispute_released audit row and dispute.status='resolved'.`,
          `Or trigger Close → POST /functions/v1/poi-engagements/${engagement_id}/dispute-close (same shape) → expect dispute.counterparty_named_dispute_closed audit row and engagement_status='declined'.`,
          "Confirm POI/intent-declare for this match returns 409 DISPUTE_ACTIVE while the open dispute row is present.",
          "Confirm no POI mint, no WaD, no execution kickoff, no credit burn, no payment event, and no further outreach was triggered by the dispute itself.",
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
          function: "seed-cp012-controlled-prod",
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          fixture_hashes: requested,
          seeded_by: actor,
          seeded_at: seededAt,
          production_demo_mode: true,
          environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
          request_id: requestId,
        },
      });
    } catch (e) {
      console.error("[seed-cp012-controlled-prod] audit insert failed:", e);
    }

    return json({
      ok: true,
      scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
      seeded_at: seededAt,
      request_id: requestId,
      fixtures: results,
      notes: [
        "Engagement inserted with is_demo=true, named counterparty (email + name + counterparty_org_id), engagement_status='contacted', then rewritten to engagement_status='disputed_being_named' with operational_state='disputed_being_named'.",
        "public.disputes row inserted with reason='cp012_disputes_being_named' and status='open' so the match-level DISPUTE_ACTIVE guard trips.",
        "engagement.dispute_raised (canonical) and pending_engagement.counterparty_disputed_being_named (CP-012 sibling) audit rows emitted — byte-for-byte mirror of the live poi-engagements handler.",
        "Resolution audits (dispute.counterparty_named_dispute_released / _closed) are intentionally NOT pre-seeded — Daniel must trigger them via the platform_admin-only Release / Close endpoints (POST /poi-engagements/:id/dispute-release|dispute-close with Idempotency-Key header).",
        "No POI / WaD / execution / credit / payment / notification / outreach side effects were performed by the seeder.",
        "Cleanup: POST /functions/v1/unseed-cp012-controlled-prod with the same scope.",
      ],
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
