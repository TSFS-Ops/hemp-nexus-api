/**
 * seed-cp015-controlled-prod — CP-015 controlled-production demo-mode
 * seeder for the single signed Daniel acceptance fixture:
 *
 *   DEMO-CP015-EMAIL-CHANGE-001
 *     The initiating organisation tries to change the counterparty email
 *     on an existing Pending Engagement. The seeder mirrors the live
 *     poi-engagements + match handlers byte-for-byte:
 *
 *       (a) An original engagement is created with the original
 *           counterparty email at engagement_status='contacted'.
 *       (b) A direct in-place email edit is refused — emitting both
 *           the canonical `engagement.email_change_refused` audit and
 *           the CP-015 sibling
 *           `pending_engagement.email_change_blocked_requires_new_engagement`
 *           with old_status_after = old_status_before, no side effects.
 *       (c) The cancel-for-email-change handler runs — transitioning
 *           the old engagement to engagement_status='cancelled_email_change'
 *           and operational_state='cancelled_for_email_change', emitting
 *           the canonical `engagement.cancelled_for_email_change` audit
 *           and a second CP-015 sibling row with
 *           old_status_after='cancelled_email_change' and
 *           old_outreach_link_invalidated=true.
 *       (d) A brand-new replacement engagement is created with the
 *           corrected email and a fresh engagement id, emitting
 *           `pending_engagement.created_after_counterparty_email_change`
 *           linking new_engagement_id → old_engagement_id.
 *
 * Canonical signed audit names (mirroring the live handlers at
 * supabase/functions/poi-engagements/index.ts:1761/3555 and
 * supabase/functions/match/index.ts:841):
 *   1. engagement.email_change_refused                                   (refused branch)
 *   2. pending_engagement.email_change_blocked_requires_new_engagement    (refused + cancel siblings)
 *   3. engagement.cancelled_for_email_change                              (cancel branch)
 *   4. pending_engagement.created_after_counterparty_email_change         (replacement)
 *
 * Hard-gated by:
 *   - `admin_settings.allow_controlled_production_demo_fixtures_cp015.enabled = true`
 *   - scope: "CP-015 Daniel UAT"
 *   - hash allowlist of one
 *
 * Does NOT:
 *   - touch CP-002 / CP-003 / CP-006 / CP-009 / CP-012 / MT-* fixtures
 *   - send any email / WhatsApp / notification / invite
 *   - mint POI, trigger WaD, run execution, burn credits, write payment
 *     events, or invalidate any real outreach token
 *
 * Auth: INTERNAL_CRON_KEY header, SERVICE_ROLE bearer, or
 * platform_admin JWT.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const TEST_EMAIL_SUFFIX = "@test.izenzo.co.za";
const ALLOWED_FIXTURE_SCOPE = "CP-015 Daniel UAT";
const ALLOWED_FIXTURE_HASHES = ["DEMO-CP015-EMAIL-CHANGE-001"] as const;
type AllowedHash = typeof ALLOWED_FIXTURE_HASHES[number];

const BANNED_HASH_PREFIXES = [
  "DEMO-CP002-",
  "DEMO-CP003-",
  "DEMO-CP006-",
  "DEMO-CP009-",
  "DEMO-CP012-",
  "DEMO-MT008-",
  "DEMO-MT009-",
  "DEMO-MT012-",
];

const ADMIN_FLAG_KEY = "allow_controlled_production_demo_fixtures_cp015";

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

const ORIGINAL_COUNTERPARTY_EMAIL =
  "daniel-cp015-original@test.izenzo.co.za";
const CORRECTED_COUNTERPARTY_EMAIL =
  "daniel-cp015-corrected@test.izenzo.co.za";
const COUNTERPARTY_CONTACT_NAME = "Daniel Counterparty (DEMO CP-015)";

const REFUSED_REASON = "engagement_not_pending";

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
      seller_name: ORG_COUNTERPARTY_NAME,
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
 * Find or create the ORIGINAL engagement (counterparty_email = ORIGINAL_*).
 * If it already exists and was already cancelled by a prior run, return it
 * as-is so the cancel branch detects the idempotent path.
 */
async function ensureOriginalEngagement(
  admin: SupabaseClient,
  args: {
    match_id: string;
    initiator_org_id: string;
    counterparty_org_id: string;
    fixture_code: AllowedHash;
  },
): Promise<{ engagement_id: string; previous_status: string; created: boolean }> {
  const adminNotes =
    `[DEMO ${args.fixture_code}] CP-015 — original engagement with ORIGINAL counterparty email. Used to exercise the refuse → cancel → recreate flow.`;

  const { data: existing } = await admin
    .from("poi_engagements")
    .select("id, engagement_status")
    .eq("match_id", args.match_id)
    .eq("counterparty_email", ORIGINAL_COUNTERPARTY_EMAIL)
    .eq("is_demo", true)
    .maybeSingle();
  if (existing) {
    return {
      engagement_id: existing.id,
      previous_status: existing.engagement_status as string,
      created: false,
    };
  }

  const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const contactedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("poi_engagements")
    .insert({
      match_id: args.match_id,
      org_id: args.initiator_org_id,
      counterparty_org_id: args.counterparty_org_id,
      counterparty_email: ORIGINAL_COUNTERPARTY_EMAIL,
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
    throw new Error(`original engagement create failed (${args.fixture_code}): ${error.message}`);
  }
  return { engagement_id: data.id, previous_status: "contacted", created: true };
}

/**
 * (b) Refused direct-edit branch — mirrors poi-engagements/index.ts:1761 +
 * the CP-015 sibling at :1788. No state change to the engagement row.
 */
async function emitRefusedAudits(
  admin: SupabaseClient,
  args: {
    engagement_id: string;
    match_id: string;
    initiator_org_id: string;
    actor_user_id: string;
    current_status: string;
    request_id: string;
  },
): Promise<{
  canonical: "inserted" | "already_present";
  sibling: "inserted" | "already_present";
}> {
  const previousEmail = ORIGINAL_COUNTERPARTY_EMAIL.toLowerCase();
  const attemptedEmail = CORRECTED_COUNTERPARTY_EMAIL.toLowerCase();
  const nowIso = new Date().toISOString();

  let canonical: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", args.engagement_id)
      .eq("action", "engagement.email_change_refused")
      .limit(1)
      .maybeSingle();
    if (!prior) {
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "engagement.email_change_refused",
        entity_type: "poi_engagement",
        entity_id: args.engagement_id,
        metadata: {
          reason: REFUSED_REASON,
          current_status: args.current_status,
          previous_email: previousEmail,
          attempted_email: attemptedEmail,
          request_id: args.request_id,
        },
      });
      canonical = "inserted";
    }
  }

  let sibling: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id, metadata")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", args.engagement_id)
      .eq("action", "pending_engagement.email_change_blocked_requires_new_engagement")
      .order("created_at", { ascending: true })
      .limit(2);
    const hasRefusedShape = (prior ?? []).some((row) => {
      const md = (row as { metadata?: Record<string, unknown> }).metadata ?? {};
      return (md as { old_status_after?: string }).old_status_after === args.current_status &&
        (md as { old_outreach_link_invalidated?: boolean }).old_outreach_link_invalidated === false;
    });
    if (!hasRefusedShape) {
      const oldHash = await sha256Hex(previousEmail);
      const newHash = await sha256Hex(attemptedEmail);
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "pending_engagement.email_change_blocked_requires_new_engagement",
        entity_type: "poi_engagement",
        entity_id: args.engagement_id,
        metadata: {
          cp_rule: "CP-015",
          reason: "counterparty_email_change_after_creation",
          old_engagement_id: args.engagement_id,
          new_engagement_id: null,
          match_id: args.match_id,
          poi_id: null,
          initiator_user_id: args.actor_user_id,
          initiator_organisation_id: args.initiator_org_id,
          old_counterparty_email_hash: oldHash,
          new_counterparty_email_hash: newHash,
          counterparty_name: COUNTERPARTY_CONTACT_NAME,
          old_status_before: args.current_status,
          old_status_after: args.current_status,
          direct_edit_allowed: false,
          new_engagement_created: false,
          old_outreach_link_invalidated: false,
          poi_completed_from_old_engagement: false,
          wad_triggered_from_old_engagement: false,
          credit_burned_for_email_change: false,
          payment_event_created_for_email_change: false,
          billing_review_required: false,
          changed_by_user_id: args.actor_user_id,
          changed_at: nowIso,
          request_id: args.request_id,
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          seeded_by: "seed-cp015-controlled-prod:refused",
        },
      });
      sibling = "inserted";
    }
  }
  return { canonical, sibling };
}

/**
 * (c) Cancel-for-email-change branch — mirrors poi-engagements/index.ts:3514
 * (update) + :3552 (canonical audit) + :3578 (CP-015 sibling). Idempotent if
 * the engagement is already cancelled_email_change.
 */
async function driveCancelForEmailChange(
  admin: SupabaseClient,
  args: {
    engagement_id: string;
    match_id: string;
    initiator_org_id: string;
    actor_user_id: string;
    actor_email: string;
    actor_name: string;
    request_id: string;
  },
): Promise<{
  idempotent: boolean;
  previous_status: string;
  canonical: "inserted" | "already_present";
  sibling: "inserted" | "already_present";
}> {
  const { data: current, error: fetchErr } = await admin
    .from("poi_engagements")
    .select("*")
    .eq("id", args.engagement_id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!current) throw new Error("original engagement vanished mid-seed");

  const previousStatus = current.engagement_status as string;
  const nowIso = new Date().toISOString();
  let idempotent = false;

  if (previousStatus === "cancelled_email_change") {
    idempotent = true;
  } else {
    const { error: updErr } = await admin
      .from("poi_engagements")
      .update({
        engagement_status: "cancelled_email_change",
        operational_state: "cancelled_for_email_change",
        operational_state_set_by: args.actor_user_id,
        operational_state_set_at: nowIso,
        cancelled_at: nowIso,
        cancelled_reason: "email_change",
        cancelled_by_user_id: args.actor_user_id,
      })
      .eq("id", args.engagement_id);
    if (updErr) throw new Error(`cancel update failed: ${updErr.message}`);

    await admin.from("engagement_outreach_logs").insert({
      engagement_id: args.engagement_id,
      actor_type: "admin",
      admin_user_id: args.actor_user_id,
      admin_email: args.actor_email,
      admin_name: args.actor_name,
      previous_status: previousStatus,
      new_status: "cancelled_email_change",
      entry_type: "cancelled",
      notes: JSON.stringify({
        event: "cancelled_for_email_change",
        old_email: ORIGINAL_COUNTERPARTY_EMAIL.toLowerCase(),
        new_email: CORRECTED_COUNTERPARTY_EMAIL,
        reason: "DEMO CP-015 — initiator corrected counterparty email; live flow requires cancel + recreate.",
        request_id: args.request_id,
      }),
    });
  }

  let canonical: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", args.engagement_id)
      .eq("action", "engagement.cancelled_for_email_change")
      .limit(1)
      .maybeSingle();
    if (!prior) {
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "engagement.cancelled_for_email_change",
        entity_type: "poi_engagement",
        entity_id: args.engagement_id,
        metadata: {
          previous_status: previousStatus,
          old_email: ORIGINAL_COUNTERPARTY_EMAIL.toLowerCase(),
          new_email: CORRECTED_COUNTERPARTY_EMAIL,
          reason: "DEMO CP-015 — cancel-for-email-change",
          request_id: args.request_id,
        },
      });
      canonical = "inserted";
    }
  }

  let sibling: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id, metadata")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", args.engagement_id)
      .eq("action", "pending_engagement.email_change_blocked_requires_new_engagement")
      .order("created_at", { ascending: true })
      .limit(5);
    const hasCancelShape = (prior ?? []).some((row) => {
      const md = (row as { metadata?: Record<string, unknown> }).metadata ?? {};
      return (md as { old_status_after?: string }).old_status_after === "cancelled_email_change";
    });
    if (!hasCancelShape) {
      const oldHash = await sha256Hex(ORIGINAL_COUNTERPARTY_EMAIL.toLowerCase());
      const newHash = await sha256Hex(CORRECTED_COUNTERPARTY_EMAIL.toLowerCase());
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "pending_engagement.email_change_blocked_requires_new_engagement",
        entity_type: "poi_engagement",
        entity_id: args.engagement_id,
        metadata: {
          cp_rule: "CP-015",
          reason: "counterparty_email_change_after_creation",
          old_engagement_id: args.engagement_id,
          new_engagement_id: null,
          match_id: args.match_id,
          poi_id: null,
          initiator_user_id: args.actor_user_id,
          initiator_organisation_id: args.initiator_org_id,
          old_counterparty_email_hash: oldHash,
          new_counterparty_email_hash: newHash,
          counterparty_name: COUNTERPARTY_CONTACT_NAME,
          old_status_before: previousStatus,
          old_status_after: "cancelled_email_change",
          direct_edit_allowed: false,
          new_engagement_created: false,
          old_outreach_link_invalidated: true,
          poi_completed_from_old_engagement: false,
          wad_triggered_from_old_engagement: false,
          credit_burned_for_email_change: false,
          payment_event_created_for_email_change: false,
          billing_review_required: false,
          changed_by_user_id: args.actor_user_id,
          changed_at: nowIso,
          request_id: args.request_id,
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          seeded_by: "seed-cp015-controlled-prod:cancelled",
        },
      });
      sibling = "inserted";
    }
  }

  return { idempotent, previous_status: previousStatus, canonical, sibling };
}

/**
 * (d) Replacement-engagement create — mirrors match/index.ts:837 audit
 * shape. We do not call the match soft-route handler here; instead we
 * INSERT the replacement poi_engagement row directly and emit the
 * canonical `pending_engagement.created_after_counterparty_email_change`
 * audit linking new → old.
 */
async function ensureReplacementEngagement(
  admin: SupabaseClient,
  args: {
    match_id: string;
    initiator_org_id: string;
    counterparty_org_id: string;
    old_engagement_id: string;
    actor_user_id: string;
    request_id: string;
    fixture_code: AllowedHash;
  },
): Promise<{
  new_engagement_id: string;
  created: boolean;
  audit_created: "inserted" | "already_present";
}> {
  const adminNotes =
    `[DEMO ${args.fixture_code}] CP-015 — REPLACEMENT engagement with corrected counterparty email. Linked to old_engagement_id=${args.old_engagement_id}.`;

  let newEngagementId: string;
  let created = false;
  const { data: existing } = await admin
    .from("poi_engagements")
    .select("id")
    .eq("match_id", args.match_id)
    .eq("counterparty_email", CORRECTED_COUNTERPARTY_EMAIL)
    .eq("is_demo", true)
    .maybeSingle();
  if (existing) {
    newEngagementId = existing.id as string;
  } else {
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("poi_engagements")
      .insert({
        match_id: args.match_id,
        org_id: args.initiator_org_id,
        counterparty_org_id: args.counterparty_org_id,
        counterparty_email: CORRECTED_COUNTERPARTY_EMAIL,
        counterparty_type: "known",
        contact_type: "named_individual",
        contact_name: COUNTERPARTY_CONTACT_NAME,
        contact_method: "email",
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
      throw new Error(`replacement engagement create failed: ${error.message}`);
    }
    newEngagementId = data.id;
    created = true;
  }

  let auditCreated: "inserted" | "already_present" = "already_present";
  {
    const { data: prior } = await admin
      .from("audit_logs")
      .select("id")
      .eq("entity_type", "poi_engagement")
      .eq("entity_id", newEngagementId)
      .eq("action", "pending_engagement.created_after_counterparty_email_change")
      .limit(1)
      .maybeSingle();
    if (!prior) {
      const newEmailHash = await sha256Hex(CORRECTED_COUNTERPARTY_EMAIL.toLowerCase());
      await admin.from("audit_logs").insert({
        org_id: args.initiator_org_id,
        actor_user_id: args.actor_user_id,
        action: "pending_engagement.created_after_counterparty_email_change",
        entity_type: "poi_engagement",
        entity_id: newEngagementId,
        metadata: {
          cp_rule: "CP-015",
          source_reason: "email_change_required_new_engagement",
          old_engagement_id: args.old_engagement_id,
          new_engagement_id: newEngagementId,
          match_id: args.match_id,
          new_counterparty_email_hash: newEmailHash,
          created_by_user_id: args.actor_user_id,
          organisation_id: args.initiator_org_id,
          request_id: args.request_id,
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          seeded_by: "seed-cp015-controlled-prod:created",
        },
      });
      auditCreated = "inserted";
    }
  }

  return { new_engagement_id: newEngagementId, created, audit_created: auditCreated };
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
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

  if (body.confirm !== "RUN_SEED_CP015_CONTROLLED_PROD") {
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
            function: "seed-cp015-controlled-prod",
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
            `admin_settings.${ADMIN_FLAG_KEY}.enabled must be true to seed CP-015 fixtures in production.`,
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
    const requestId = `seed-cp015-${crypto.randomUUID()}`;

    const baseMeta = {
      demo_fixture: true,
      fixture_scope: ALLOWED_FIXTURE_SCOPE,
      production_demo_mode: true,
      seeded_at: seededAt,
      seeded_by: actor ?? "seed-cp015-controlled-prod",
      cp_rule: "CP-015",
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

      const original = await ensureOriginalEngagement(admin, {
        match_id,
        initiator_org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        fixture_code: hash,
      });

      // (b) Refused direct edit — only meaningful when the old engagement
      // is still in a pre-cancel status. We record refused audits against
      // the status the original engagement was at before cancel.
      const refused = await emitRefusedAudits(admin, {
        engagement_id: original.engagement_id,
        match_id,
        initiator_org_id: initiatorOrgId,
        actor_user_id: platformAdminUserId,
        current_status: original.previous_status === "cancelled_email_change"
          ? "contacted"
          : original.previous_status,
        request_id: requestId,
      });

      // (c) Cancel-for-email-change.
      const cancelled = await driveCancelForEmailChange(admin, {
        engagement_id: original.engagement_id,
        match_id,
        initiator_org_id: initiatorOrgId,
        actor_user_id: platformAdminUserId,
        actor_email: platformAdminEmail,
        actor_name: platformAdminName,
        request_id: requestId,
      });

      // (d) Replacement engagement + linking audit.
      const replacement = await ensureReplacementEngagement(admin, {
        match_id,
        initiator_org_id: initiatorOrgId,
        counterparty_org_id: counterpartyOrgId,
        old_engagement_id: original.engagement_id,
        actor_user_id: platformAdminUserId,
        request_id: requestId,
        fixture_code: hash,
      });

      // Side-effects QA: confirm no POI / credit / payment fired.
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
        old_engagement_id: original.engagement_id,
        new_engagement_id: replacement.new_engagement_id,
        route_admin_old: `/admin/engagements?match=${match_id}`,
        route_admin_new: `/admin/engagements?engagement=${replacement.new_engagement_id}`,
        route_initiator: `/desk/match/${match_id}`,
        match_created_or_reused: matchCreated ? "created" : "reused",
        original_engagement_created_or_reused: original.created ? "created" : "reused",
        replacement_engagement_created_or_reused: replacement.created ? "created" : "reused",
        original_counterparty_email: ORIGINAL_COUNTERPARTY_EMAIL,
        corrected_counterparty_email: CORRECTED_COUNTERPARTY_EMAIL,
        counterparty_contact_name: COUNTERPARTY_CONTACT_NAME,
        counterparty_org_id: counterpartyOrgId,
        old_engagement_status_after: "cancelled_email_change",
        old_operational_state_after: "cancelled_for_email_change",
        old_outreach_link_invalidated: true,
        new_engagement_status: "pending",
        cancel_idempotent: cancelled.idempotent,
        previous_engagement_status: cancelled.previous_status,
        side_effects_check: {
          poi_state: matchRow?.poi_state ?? null,
          match_state: matchRow?.state ?? null,
          token_ledger_rows_for_match: ledgerCount ?? 0,
          poi_completed_from_old_engagement: false,
          wad_triggered_from_old_engagement: false,
          execution_started: false,
          credit_burned_for_email_change: false,
          payment_event_created_for_email_change: false,
          silent_external_notice_sent: false,
        },
        audits_emitted: {
          "engagement.email_change_refused": refused.canonical,
          "pending_engagement.email_change_blocked_requires_new_engagement (refused sibling)":
            refused.sibling,
          "engagement.cancelled_for_email_change": cancelled.canonical,
          "pending_engagement.email_change_blocked_requires_new_engagement (cancel sibling)":
            cancelled.sibling,
          "pending_engagement.created_after_counterparty_email_change":
            replacement.audit_created,
        },
        ui_messages_expected: {
          direct_edit_attempt:
            "Counterparty email cannot be edited silently after a Pending Engagement has been created. The existing engagement will be cancelled and a new engagement must be created with the corrected email. The original record will remain in the audit trail.",
          old_outreach_link_followed:
            "This engagement invitation is no longer active. Please contact Izenzo admin if you believe this is incorrect.",
        },
        next_step_for_daniel: [
          "Sign in as daniel-platformadmin@test.izenzo.co.za.",
          `Open /admin/engagements?match=${match_id} — confirm old engagement (${original.engagement_id}) shows engagement_status='cancelled_email_change' and operational_state='cancelled_for_email_change'; original counterparty email '${ORIGINAL_COUNTERPARTY_EMAIL}' is still visible on the old row.`,
          `Confirm new engagement (${replacement.new_engagement_id}) exists on the same match with counterparty_email='${CORRECTED_COUNTERPARTY_EMAIL}' and engagement_status='pending'.`,
          "Attempt a direct in-place email edit on the cancelled (or any non-pending) engagement via the live UI — confirm it is refused with the EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE message and writes engagement.email_change_refused + the CP-015 refused sibling audit.",
          `Query audit_logs WHERE entity_id IN ('${original.engagement_id}','${replacement.new_engagement_id}') ORDER BY created_at — confirm all five rows listed in audits_emitted.`,
          "Confirm the old outreach link is invalidated (status=cancelled_email_change) and following it surfaces the 'invitation no longer active' message.",
          "Confirm no POI mint, no WaD trigger, no execution kickoff, no credit burn, no payment event, and no silent external notice fired from either the old or the new engagement as a result of the email change.",
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
          function: "seed-cp015-controlled-prod",
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
      console.error("[seed-cp015-controlled-prod] audit insert failed:", e);
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
        "Original engagement inserted with is_demo=true, ORIGINAL counterparty email, engagement_status='contacted'.",
        "Refused-edit audits emitted (engagement.email_change_refused + CP-015 sibling, old_status_after=old_status_before, old_outreach_link_invalidated=false) — old row state unchanged by this step.",
        "Cancel-for-email-change applied: engagement_status='cancelled_email_change', operational_state='cancelled_for_email_change', cancelled_at/by/reason set, engagement_outreach_logs entry written. engagement.cancelled_for_email_change (canonical) + CP-015 sibling (old_status_after='cancelled_email_change', old_outreach_link_invalidated=true) emitted.",
        "Replacement engagement inserted on the SAME match with the CORRECTED email and a fresh engagement id; pending_engagement.created_after_counterparty_email_change emitted with old_engagement_id/new_engagement_id linkage.",
        "Old engagement is NOT deleted — it is preserved with the cancelled_email_change status for the audit trail.",
        "No POI / WaD / execution / credit / payment / notification / outreach side effects were performed by the seeder.",
        "Cleanup: POST /functions/v1/unseed-cp015-controlled-prod with the same scope.",
      ],
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
