// =============================================================================
// Integration tests — auto_link_engagement_on_signup trigger
// =============================================================================
// These tests insert real fixtures (organisations, matches, engagements, an
// auth user, and a profiles row) against the live Supabase project using the
// service-role key. They then assert that the trigger:
//
//   1. Auto-links the new user's org into the matching poi_engagement row.
//   2. Fills the *vacant* buyer/seller slot on the linked match — buyer_org_id
//      when seller is already set, or seller_org_id when buyer is already set.
//   3. Writes an `engagement.auto_linked` audit entry whose `details.filled_slots`
//      array contains the expected per-match `{ match_id, engagement_id,
//      filled_slot }` record.
//   4. Does NOT fill any slot when both buyer/seller orgs are already set
//      (and records `filled_slot: null` in the audit payload).
//
// Run:
//   deno test supabase/functions/_shared/auto-link-trigger_integration_test.ts \
//     --allow-net --allow-env
//
// Required env (provided automatically by the supabase--test_edge_functions
// tool): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Every test creates its own scoped fixtures, tagged with a unique suffix, and
// cleans them up in a `finally` block — including the auth.users row, which
// cascades to the profiles row.
// =============================================================================

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ───────────────────────────── helpers ─────────────────────────────

function getClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function tag(): string {
  // Short, collision-resistant suffix for this run's fixtures.
  return `tst-${crypto.randomUUID().slice(0, 8)}`;
}

interface Fixture {
  initiatorOrgId: string;
  recipientOrgId: string;
  matchId: string;
  engagementId: string;
  authUserId: string | null;
  email: string;
  /** Cleanup hooks executed in reverse-insertion order. */
  cleanup: Array<() => Promise<void>>;
}

/**
 * Build base fixtures: two organisations, a match, and a poi_engagement.
 * Caller decides how the buyer/seller slots on the match are populated.
 */
async function buildBase(
  supabase: SupabaseClient,
  opts: {
    suffix: string;
    matchSlots: { buyer_org_id: string | null; seller_org_id: string | null };
    metadata?: Record<string, unknown>;
  }
): Promise<Fixture> {
  const cleanup: Array<() => Promise<void>> = [];
  const email = `auto-link-${opts.suffix}@izenzo-test.invalid`;

  // 1. Initiator org (the org that creates the match)
  const { data: initiatorOrg, error: initOrgErr } = await supabase
    .from("organizations")
    .insert({ name: `Initiator ${opts.suffix}` })
    .select("id")
    .single();
  if (initOrgErr || !initiatorOrg) throw new Error(`init org insert: ${initOrgErr?.message}`);
  cleanup.push(async () => {
    await supabase.from("organizations").delete().eq("id", initiatorOrg.id);
  });

  // 2. Recipient org (the org the new signup will be attached to)
  const { data: recipientOrg, error: recOrgErr } = await supabase
    .from("organizations")
    .insert({ name: `Recipient ${opts.suffix}` })
    .select("id")
    .single();
  if (recOrgErr || !recipientOrg) throw new Error(`recipient org insert: ${recOrgErr?.message}`);
  cleanup.push(async () => {
    await supabase.from("organizations").delete().eq("id", recipientOrg.id);
  });

  // 3. Match — initiator owns it, slots configured per test
  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .insert({
      org_id: initiatorOrg.id,
      hash: `hash-${opts.suffix}`,
      commodity: `Test Commodity ${opts.suffix}`,
      status: "matched",
      state: "discovery",
      poi_state: "DRAFT",
      match_type: "search",
      buyer_org_id: opts.matchSlots.buyer_org_id,
      seller_org_id: opts.matchSlots.seller_org_id,
      metadata: opts.metadata ?? {},
    })
    .select("id")
    .single();
  if (matchErr || !match) throw new Error(`match insert: ${matchErr?.message}`);
  cleanup.push(async () => {
    await supabase.from("matches").delete().eq("id", match.id);
  });

  // 4. Engagement — pending, addressed to the email we'll sign up
  const { data: eng, error: engErr } = await supabase
    .from("poi_engagements")
    .insert({
      match_id: match.id,
      org_id: initiatorOrg.id,
      counterparty_email: email,
      counterparty_type: "unknown",
      engagement_status: "notification_sent",
    })
    .select("id")
    .single();
  if (engErr || !eng) throw new Error(`engagement insert: ${engErr?.message}`);
  cleanup.push(async () => {
    await supabase.from("poi_engagements").delete().eq("id", eng.id);
  });

  return {
    initiatorOrgId: initiatorOrg.id,
    recipientOrgId: recipientOrg.id,
    matchId: match.id,
    engagementId: eng.id,
    authUserId: null,
    email,
    cleanup,
  };
}

/**
 * Create an auth user via Admin API, then insert the profiles row that fires
 * the auto-link trigger. Returns the new auth user id.
 */
async function signUpAndAttachProfile(
  supabase: SupabaseClient,
  fixture: Fixture
): Promise<string> {
  const { data: created, error: userErr } = await supabase.auth.admin.createUser({
    email: fixture.email,
    email_confirm: true,
    password: `Test-${crypto.randomUUID()}!`,
    user_metadata: { full_name: `Test ${fixture.email}` },
  });
  if (userErr || !created.user) throw new Error(`auth user create: ${userErr?.message}`);
  const authUserId = created.user.id;
  fixture.authUserId = authUserId;
  fixture.cleanup.push(async () => {
    // Cascades to profiles row via FK.
    await supabase.auth.admin.deleteUser(authUserId);
  });

  // Insert profile — this is the row whose insert/update fires the trigger.
  const { error: profErr } = await supabase.from("profiles").insert({
    id: authUserId,
    org_id: fixture.recipientOrgId,
    email: fixture.email,
    full_name: `Test ${fixture.email}`,
  });
  if (profErr) throw new Error(`profile insert: ${profErr.message}`);

  return authUserId;
}

async function teardown(fixture: Fixture) {
  // Reverse order so FK dependencies unwind cleanly.
  for (const fn of [...fixture.cleanup].reverse()) {
    try {
      await fn();
    } catch (e) {
      console.error("[teardown] cleanup step failed:", e);
    }
  }
  // Belt-and-braces: delete any audit rows tagged at this profile id.
  if (fixture.authUserId) {
    await (await getClient())!
      .from("admin_audit_logs")
      .delete()
      .eq("target_id", fixture.authUserId)
      .in("action", ["engagement.auto_linked", "engagement.welcome_email_dispatch_failed"]);
  }
}

interface FilledSlotEntry {
  match_id: string;
  engagement_id: string;
  filled_slot: "buyer" | "seller" | null;
}

async function fetchAutoLinkAuditFor(
  supabase: SupabaseClient,
  authUserId: string
): Promise<{ details: { filled_slots?: FilledSlotEntry[] } & Record<string, unknown> } | null> {
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("details")
    .eq("action", "engagement.auto_linked")
    .eq("target_id", authUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`audit fetch: ${error.message}`);
  return (data && data[0]) ? (data[0] as { details: Record<string, unknown> & { filled_slots?: FilledSlotEntry[] } }) : null;
}

// ───────────────────────────── tests ─────────────────────────────

Deno.test({
  name: "trigger fills buyer_org_id when seller slot is already taken",
  // These tests require live DB access. The supabase--test_edge_functions
  // runner provides it; locally `deno test` will skip if env is missing.
  ignore: !getClient(),
  fn: async () => {
    const supabase = getClient()!;
    const suffix = tag();

    // Pre-existing seller occupies the seller slot — buyer slot is vacant.
    const sellerOnly = await supabase
      .from("organizations")
      .insert({ name: `Pre-seller ${suffix}` })
      .select("id")
      .single();
    if (sellerOnly.error || !sellerOnly.data) throw new Error(sellerOnly.error?.message);

    const fixture = await buildBase(supabase, {
      suffix,
      matchSlots: { buyer_org_id: null, seller_org_id: sellerOnly.data.id },
      metadata: { tradeSide: "seller" }, // creator declared seller; recipient is therefore buyer
    });
    fixture.cleanup.push(async () => {
      await supabase.from("organizations").delete().eq("id", sellerOnly.data!.id);
    });

    try {
      const authUserId = await signUpAndAttachProfile(supabase, fixture);

      // Verify match slot
      const { data: matchAfter } = await supabase
        .from("matches")
        .select("buyer_org_id, seller_org_id")
        .eq("id", fixture.matchId)
        .single();
      assertEquals(matchAfter?.buyer_org_id, fixture.recipientOrgId, "buyer_org_id should be filled with recipient org");
      assertEquals(matchAfter?.seller_org_id, sellerOnly.data!.id, "seller_org_id should be untouched");

      // Verify engagement linked
      const { data: engAfter } = await supabase
        .from("poi_engagements")
        .select("counterparty_org_id, counterparty_type")
        .eq("id", fixture.engagementId)
        .single();
      assertEquals(engAfter?.counterparty_org_id, fixture.recipientOrgId);
      assertEquals(engAfter?.counterparty_type, "known");

      // Verify audit payload
      const audit = await fetchAutoLinkAuditFor(supabase, authUserId);
      assertExists(audit, "audit row should exist");
      const slots = audit!.details.filled_slots;
      assertExists(slots, "filled_slots array should be present");
      assertEquals(slots!.length, 1);
      assertEquals(slots![0].match_id, fixture.matchId);
      assertEquals(slots![0].engagement_id, fixture.engagementId);
      assertEquals(slots![0].filled_slot, "buyer");
      assertEquals((audit!.details as Record<string, unknown>).org_id, fixture.recipientOrgId);
      assertEquals((audit!.details as Record<string, unknown>).linked_engagement_count, 1);
    } finally {
      await teardown(fixture);
    }
  },
});

Deno.test({
  name: "trigger fills seller_org_id when buyer slot is already taken",
  ignore: !getClient(),
  fn: async () => {
    const supabase = getClient()!;
    const suffix = tag();

    const buyerOnly = await supabase
      .from("organizations")
      .insert({ name: `Pre-buyer ${suffix}` })
      .select("id")
      .single();
    if (buyerOnly.error || !buyerOnly.data) throw new Error(buyerOnly.error?.message);

    const fixture = await buildBase(supabase, {
      suffix,
      matchSlots: { buyer_org_id: buyerOnly.data.id, seller_org_id: null },
      metadata: { tradeSide: "buyer" }, // creator declared buyer; recipient is therefore seller
    });
    fixture.cleanup.push(async () => {
      await supabase.from("organizations").delete().eq("id", buyerOnly.data!.id);
    });

    try {
      const authUserId = await signUpAndAttachProfile(supabase, fixture);

      const { data: matchAfter } = await supabase
        .from("matches")
        .select("buyer_org_id, seller_org_id")
        .eq("id", fixture.matchId)
        .single();
      assertEquals(matchAfter?.seller_org_id, fixture.recipientOrgId, "seller_org_id should be filled with recipient org");
      assertEquals(matchAfter?.buyer_org_id, buyerOnly.data!.id, "buyer_org_id should be untouched");

      const audit = await fetchAutoLinkAuditFor(supabase, authUserId);
      assertExists(audit);
      const slots = audit!.details.filled_slots!;
      assertEquals(slots.length, 1);
      assertEquals(slots[0].match_id, fixture.matchId);
      assertEquals(slots[0].filled_slot, "seller");
    } finally {
      await teardown(fixture);
    }
  },
});

Deno.test({
  name: "trigger does not change slots when both buyer and seller already populated",
  ignore: !getClient(),
  fn: async () => {
    const supabase = getClient()!;
    const suffix = tag();

    // Two pre-existing parties already on both slots
    const preBuyer = await supabase.from("organizations").insert({ name: `PreB ${suffix}` }).select("id").single();
    const preSeller = await supabase.from("organizations").insert({ name: `PreS ${suffix}` }).select("id").single();
    if (preBuyer.error || preSeller.error) throw new Error("pre-party insert failed");

    const fixture = await buildBase(supabase, {
      suffix,
      matchSlots: { buyer_org_id: preBuyer.data!.id, seller_org_id: preSeller.data!.id },
      metadata: {},
    });
    fixture.cleanup.push(async () => {
      await supabase.from("organizations").delete().eq("id", preBuyer.data!.id);
      await supabase.from("organizations").delete().eq("id", preSeller.data!.id);
    });

    try {
      const authUserId = await signUpAndAttachProfile(supabase, fixture);

      // Slots must NOT have been touched.
      const { data: matchAfter } = await supabase
        .from("matches")
        .select("buyer_org_id, seller_org_id")
        .eq("id", fixture.matchId)
        .single();
      assertEquals(matchAfter?.buyer_org_id, preBuyer.data!.id, "buyer_org_id must be untouched");
      assertEquals(matchAfter?.seller_org_id, preSeller.data!.id, "seller_org_id must be untouched");

      // The engagement is still auto-linked (counterparty_org_id set)…
      const { data: engAfter } = await supabase
        .from("poi_engagements")
        .select("counterparty_org_id, counterparty_type")
        .eq("id", fixture.engagementId)
        .single();
      assertEquals(engAfter?.counterparty_org_id, fixture.recipientOrgId);
      assertEquals(engAfter?.counterparty_type, "known");

      // …and audit records filled_slot: null because no slot was vacant.
      const audit = await fetchAutoLinkAuditFor(supabase, authUserId);
      assertExists(audit);
      const slots = audit!.details.filled_slots!;
      assertEquals(slots.length, 1);
      assertEquals(slots[0].match_id, fixture.matchId);
      assertEquals(slots[0].filled_slot, null, "filled_slot should be null when no slot was vacant");
    } finally {
      await teardown(fixture);
    }
  },
});

Deno.test({
  name: "trigger is a no-op when no engagement matches the signup email",
  ignore: !getClient(),
  fn: async () => {
    const supabase = getClient()!;
    const suffix = tag();

    // Build orgs but skip engagement — recipient signs up but no engagement
    // is addressed to them, so trigger should not write any audit row.
    const cleanup: Array<() => Promise<void>> = [];
    const recipient = await supabase.from("organizations").insert({ name: `Lonely ${suffix}` }).select("id").single();
    if (recipient.error || !recipient.data) throw new Error(recipient.error?.message);
    cleanup.push(async () => { await supabase.from("organizations").delete().eq("id", recipient.data!.id); });

    const email = `lonely-${suffix}@izenzo-test.invalid`;
    const created = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      password: `Test-${crypto.randomUUID()}!`,
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message);
    const authUserId = created.data.user.id;
    cleanup.push(async () => { await supabase.auth.admin.deleteUser(authUserId); });

    try {
      const { error: profErr } = await supabase.from("profiles").insert({
        id: authUserId,
        org_id: recipient.data!.id,
        email,
        full_name: `Lonely ${suffix}`,
      });
      if (profErr) throw new Error(profErr.message);

      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id")
        .eq("action", "engagement.auto_linked")
        .eq("target_id", authUserId);
      if (error) throw new Error(error.message);
      assertEquals(data?.length ?? 0, 0, "no engagement.auto_linked row should be written");
    } finally {
      for (const fn of cleanup.reverse()) {
        try { await fn(); } catch (e) { console.error("[teardown]", e); }
      }
    }
  },
});
