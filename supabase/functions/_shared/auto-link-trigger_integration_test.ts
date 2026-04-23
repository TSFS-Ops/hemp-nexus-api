// =============================================================================
// Integration tests — auto_link_engagement_on_signup trigger
// =============================================================================
// These tests insert real fixtures (organisations, matches, engagements, an
// auth.users row, and a profiles row) directly against the live Postgres
// database via SUPABASE_DB_URL. They then assert that the
// auto_link_engagement_on_signup trigger:
//
//   1. Auto-links the new user's org into the matching poi_engagement row.
//   2. Fills the *vacant* buyer/seller slot on the linked match — buyer_org_id
//      when seller is already set, or seller_org_id when buyer is already set.
//   3. Writes an `engagement.auto_linked` audit entry whose `details.filled_slots`
//      array contains the expected per-match `{ match_id, engagement_id,
//      filled_slot }` record.
//   4. Records `filled_slot: null` when both buyer/seller slots are already
//      populated (engagement is still linked, but no slot was vacant).
//   5. Is a no-op when no engagement is addressed to the signup email.
//
// Run:
//   deno test supabase/functions/_shared/auto-link-trigger_integration_test.ts \
//     --allow-net --allow-env
//
// Required env (provided automatically by supabase--test_edge_functions):
//   SUPABASE_DB_URL — full Postgres connection string with elevated privileges.
//
// Every test creates its own scoped fixtures, tagged with a unique suffix, and
// cleans them up in a `finally` block — including the auth.users row, which
// cascades to the profiles row.
// =============================================================================

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

// ───────────────────────────── helpers ─────────────────────────────

/**
 * Build a connection config. Prefer the elevated PG* env vars (the same
 * sandbox-managed role that has full DML/DDL on the public schema) over
 * SUPABASE_DB_URL, which connects as a low-privilege role and cannot
 * INSERT/DELETE on app tables.
 */
function getConnectConfig():
  | { kind: "params"; cfg: Record<string, string | number> }
  | { kind: "url"; url: string }
  | null {
  const host = Deno.env.get("PGHOST");
  const user = Deno.env.get("PGUSER");
  const password = Deno.env.get("PGPASSWORD");
  const database = Deno.env.get("PGDATABASE");
  const port = Deno.env.get("PGPORT");
  if (host && user && password && database) {
    return {
      kind: "params",
      cfg: {
        hostname: host,
        user,
        password,
        database,
        port: port ? Number(port) : 5432,
        tls: { enabled: false },
      } as Record<string, string | number>,
    };
  }
  const url = Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("DB_URL");
  if (url) return { kind: "url", url };
  return null;
}

async function connect(): Promise<Client | null> {
  const cfg = getConnectConfig();
  if (!cfg) return null;
  // deno-lint-ignore no-explicit-any
  const client = new Client(cfg.kind === "url" ? cfg.url : (cfg.cfg as any));
  await client.connect();
  return client;
}

function tag(): string {
  return `tst-${crypto.randomUUID().slice(0, 8)}`;
}

interface Fixture {
  initiatorOrgId: string;
  recipientOrgId: string;
  matchId: string;
  engagementId: string;
  authUserId: string;
  email: string;
}

/**
 * Build base fixtures: two organisations, a match, and a poi_engagement.
 * Caller decides how the buyer/seller slots on the match are populated.
 * Returns IDs only; teardown is centralised in `teardown()`.
 */
async function buildBase(
  client: Client,
  opts: {
    suffix: string;
    matchSlots: { buyerOrgId: string | null; sellerOrgId: string | null };
    metadata?: Record<string, unknown>;
  }
): Promise<Omit<Fixture, "authUserId">> {
  const email = `auto-link-${opts.suffix}@izenzo-test.invalid`;

  const initRes = await client.queryObject<{ id: string }>(
    `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`,
    [`Initiator ${opts.suffix}`]
  );
  const initiatorOrgId = initRes.rows[0].id;

  const recRes = await client.queryObject<{ id: string }>(
    `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`,
    [`Recipient ${opts.suffix}`]
  );
  const recipientOrgId = recRes.rows[0].id;

  const matchRes = await client.queryObject<{ id: string }>(
    `INSERT INTO public.matches
       (org_id, hash, commodity, status, state, poi_state, match_type,
        buyer_org_id, seller_org_id, metadata)
     VALUES ($1, $2, $3, 'matched', 'discovery', 'DRAFT', 'search', $4, $5, $6::jsonb)
     RETURNING id`,
    [
      initiatorOrgId,
      `hash-${opts.suffix}`,
      `Test Commodity ${opts.suffix}`,
      opts.matchSlots.buyerOrgId,
      opts.matchSlots.sellerOrgId,
      JSON.stringify(opts.metadata ?? {}),
    ]
  );
  const matchId = matchRes.rows[0].id;

  const engRes = await client.queryObject<{ id: string }>(
    `INSERT INTO public.poi_engagements
       (match_id, org_id, counterparty_email, counterparty_type, engagement_status)
     VALUES ($1, $2, $3, 'unknown', 'notification_sent')
     RETURNING id`,
    [matchId, initiatorOrgId, email]
  );
  const engagementId = engRes.rows[0].id;

  return { initiatorOrgId, recipientOrgId, matchId, engagementId, email };
}

/**
 * Create an auth.users row and the profiles row that fires the trigger.
 * Returns the new auth user id.
 */
async function signUpAndAttachProfile(
  client: Client,
  base: Omit<Fixture, "authUserId">
): Promise<string> {
  const userRes = await client.queryObject<{ id: string }>(
    `INSERT INTO auth.users
       (id, instance_id, email, raw_user_meta_data, aud, role, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, $2::jsonb,
             'authenticated', 'authenticated', now(), now())
     RETURNING id`,
    [base.email, JSON.stringify({ full_name: `Test ${base.email}` })]
  );
  const authUserId = userRes.rows[0].id;

  // Inserting the profile fires the trigger.
  await client.queryArray(
    `INSERT INTO public.profiles (id, org_id, email, full_name)
     VALUES ($1, $2, $3, $4)`,
    [authUserId, base.recipientOrgId, base.email, `Test ${base.email}`]
  );

  return authUserId;
}

async function teardown(client: Client, ids: {
  authUserId?: string;
  matchId?: string;
  engagementId?: string;
  initiatorOrgId?: string;
  recipientOrgId?: string;
  extraOrgIds?: string[];
}) {
  // Order matters because of FK constraints. Audit logs first.
  if (ids.authUserId) {
    await client.queryArray(
      `DELETE FROM public.admin_audit_logs
         WHERE target_id = $1
           AND action IN ('engagement.auto_linked','engagement.welcome_email_dispatch_failed')`,
      [ids.authUserId]
    ).catch((e) => console.error("[teardown] audit:", e));
  }
  if (ids.engagementId) {
    await client.queryArray(`DELETE FROM public.poi_engagements WHERE id = $1`, [ids.engagementId])
      .catch((e) => console.error("[teardown] eng:", e));
  }
  if (ids.matchId) {
    await client.queryArray(`DELETE FROM public.matches WHERE id = $1`, [ids.matchId])
      .catch((e) => console.error("[teardown] match:", e));
  }
  // auth.users delete cascades to profiles (FK ON DELETE CASCADE).
  if (ids.authUserId) {
    await client.queryArray(`DELETE FROM auth.users WHERE id = $1`, [ids.authUserId])
      .catch((e) => console.error("[teardown] user:", e));
  }
  for (const orgId of [ids.initiatorOrgId, ids.recipientOrgId, ...(ids.extraOrgIds ?? [])]) {
    if (!orgId) continue;
    await client.queryArray(`DELETE FROM public.organizations WHERE id = $1`, [orgId])
      .catch((e) => console.error("[teardown] org:", e));
  }
}

interface FilledSlotEntry {
  match_id: string;
  engagement_id: string;
  filled_slot: "buyer" | "seller" | null;
}

interface AutoLinkDetails {
  user_email?: string;
  org_id?: string;
  linked_engagement_count?: number;
  welcome_email_dispatched?: boolean;
  filled_slots?: FilledSlotEntry[];
}

async function fetchAutoLinkAuditFor(
  client: Client,
  authUserId: string
): Promise<AutoLinkDetails | null> {
  const res = await client.queryObject<{ details: AutoLinkDetails }>(
    `SELECT details FROM public.admin_audit_logs
      WHERE action = 'engagement.auto_linked' AND target_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [authUserId]
  );
  return res.rows[0]?.details ?? null;
}

// ───────────────────────────── tests ─────────────────────────────

const noDb = !getConnectConfig();

Deno.test({
  name: "trigger fills buyer_org_id when seller slot is already taken",
  ignore: noDb,
  fn: async () => {
    const client = (await connect())!;
    const suffix = tag();
    const preSellerRes = await client.queryObject<{ id: string }>(
      `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`,
      [`Pre-seller ${suffix}`]
    );
    const preSellerId = preSellerRes.rows[0].id;

    const base = await buildBase(client, {
      suffix,
      matchSlots: { buyerOrgId: null, sellerOrgId: preSellerId },
      metadata: { tradeSide: "seller" }, // creator declared seller; recipient should land on buyer slot
    });
    let authUserId: string | undefined;

    try {
      authUserId = await signUpAndAttachProfile(client, base);

      const matchAfter = await client.queryObject<{ buyer_org_id: string; seller_org_id: string }>(
        `SELECT buyer_org_id, seller_org_id FROM public.matches WHERE id = $1`,
        [base.matchId]
      );
      assertEquals(matchAfter.rows[0].buyer_org_id, base.recipientOrgId, "buyer_org_id should be filled with recipient org");
      assertEquals(matchAfter.rows[0].seller_org_id, preSellerId, "seller_org_id should be untouched");

      const engAfter = await client.queryObject<{ counterparty_org_id: string; counterparty_type: string }>(
        `SELECT counterparty_org_id, counterparty_type FROM public.poi_engagements WHERE id = $1`,
        [base.engagementId]
      );
      assertEquals(engAfter.rows[0].counterparty_org_id, base.recipientOrgId);
      assertEquals(engAfter.rows[0].counterparty_type, "known");

      const details = await fetchAutoLinkAuditFor(client, authUserId);
      assertExists(details, "audit row must exist");
      assertEquals(details!.org_id, base.recipientOrgId);
      assertEquals(details!.linked_engagement_count, 1);
      const slots = details!.filled_slots;
      assertExists(slots, "filled_slots array must be present");
      assertEquals(slots!.length, 1);
      assertEquals(slots![0].match_id, base.matchId);
      assertEquals(slots![0].engagement_id, base.engagementId);
      assertEquals(slots![0].filled_slot, "buyer");
    } finally {
      await teardown(client, { ...base, authUserId, extraOrgIds: [preSellerId] });
      await client.end();
    }
  },
});

Deno.test({
  name: "trigger fills seller_org_id when buyer slot is already taken",
  ignore: noDb,
  fn: async () => {
    const client = (await connect())!;
    const suffix = tag();
    const preBuyerRes = await client.queryObject<{ id: string }>(
      `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`,
      [`Pre-buyer ${suffix}`]
    );
    const preBuyerId = preBuyerRes.rows[0].id;

    const base = await buildBase(client, {
      suffix,
      matchSlots: { buyerOrgId: preBuyerId, sellerOrgId: null },
      metadata: { tradeSide: "buyer" },
    });
    let authUserId: string | undefined;

    try {
      authUserId = await signUpAndAttachProfile(client, base);

      const matchAfter = await client.queryObject<{ buyer_org_id: string; seller_org_id: string }>(
        `SELECT buyer_org_id, seller_org_id FROM public.matches WHERE id = $1`,
        [base.matchId]
      );
      assertEquals(matchAfter.rows[0].seller_org_id, base.recipientOrgId, "seller_org_id should be filled with recipient org");
      assertEquals(matchAfter.rows[0].buyer_org_id, preBuyerId, "buyer_org_id should be untouched");

      const details = await fetchAutoLinkAuditFor(client, authUserId);
      assertExists(details);
      const slots = details!.filled_slots!;
      assertEquals(slots.length, 1);
      assertEquals(slots[0].match_id, base.matchId);
      assertEquals(slots[0].filled_slot, "seller");
    } finally {
      await teardown(client, { ...base, authUserId, extraOrgIds: [preBuyerId] });
      await client.end();
    }
  },
});

Deno.test({
  name: "trigger does not change slots when both buyer and seller already populated; audit records filled_slot=null",
  ignore: noDb,
  fn: async () => {
    const client = (await connect())!;
    const suffix = tag();

    const preBuyer = await client.queryObject<{ id: string }>(
      `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`, [`PreB ${suffix}`]
    );
    const preSeller = await client.queryObject<{ id: string }>(
      `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`, [`PreS ${suffix}`]
    );

    const base = await buildBase(client, {
      suffix,
      matchSlots: { buyerOrgId: preBuyer.rows[0].id, sellerOrgId: preSeller.rows[0].id },
      metadata: {},
    });
    let authUserId: string | undefined;

    try {
      authUserId = await signUpAndAttachProfile(client, base);

      const matchAfter = await client.queryObject<{ buyer_org_id: string; seller_org_id: string }>(
        `SELECT buyer_org_id, seller_org_id FROM public.matches WHERE id = $1`, [base.matchId]
      );
      assertEquals(matchAfter.rows[0].buyer_org_id, preBuyer.rows[0].id, "buyer_org_id must be untouched");
      assertEquals(matchAfter.rows[0].seller_org_id, preSeller.rows[0].id, "seller_org_id must be untouched");

      // Engagement is still auto-linked.
      const engAfter = await client.queryObject<{ counterparty_org_id: string; counterparty_type: string }>(
        `SELECT counterparty_org_id, counterparty_type FROM public.poi_engagements WHERE id = $1`,
        [base.engagementId]
      );
      assertEquals(engAfter.rows[0].counterparty_org_id, base.recipientOrgId);
      assertEquals(engAfter.rows[0].counterparty_type, "known");

      // Audit records the engagement but with filled_slot=null because no slot was vacant.
      const details = await fetchAutoLinkAuditFor(client, authUserId);
      assertExists(details);
      const slots = details!.filled_slots!;
      assertEquals(slots.length, 1);
      assertEquals(slots[0].match_id, base.matchId);
      assertEquals(slots[0].filled_slot, null, "filled_slot should be null when no slot was vacant");
    } finally {
      await teardown(client, {
        ...base,
        authUserId,
        extraOrgIds: [preBuyer.rows[0].id, preSeller.rows[0].id],
      });
      await client.end();
    }
  },
});

Deno.test({
  name: "trigger is a no-op when no engagement matches the signup email",
  ignore: noDb,
  fn: async () => {
    const client = (await connect())!;
    const suffix = tag();
    const recRes = await client.queryObject<{ id: string }>(
      `INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`, [`Lonely ${suffix}`]
    );
    const recipientOrgId = recRes.rows[0].id;
    const email = `lonely-${suffix}@izenzo-test.invalid`;

    let authUserId: string | undefined;
    try {
      const userRes = await client.queryObject<{ id: string }>(
        `INSERT INTO auth.users
           (id, instance_id, email, aud, role, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
                 $1, 'authenticated', 'authenticated', now(), now())
         RETURNING id`,
        [email]
      );
      authUserId = userRes.rows[0].id;

      await client.queryArray(
        `INSERT INTO public.profiles (id, org_id, email, full_name) VALUES ($1, $2, $3, $4)`,
        [authUserId, recipientOrgId, email, `Lonely ${suffix}`]
      );

      const auditCount = await client.queryObject<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.admin_audit_logs
          WHERE action = 'engagement.auto_linked' AND target_id = $1`,
        [authUserId]
      );
      assertEquals(auditCount.rows[0].count, "0", "no engagement.auto_linked row should be written");
    } finally {
      await teardown(client, { authUserId, recipientOrgId });
      await client.end();
    }
  },
});
