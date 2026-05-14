// ─────────────────────────────────────────────────────────────────────────
// Authenticated end-to-end test for the POI mint soft-route (422 → 202).
//
// This file is the CI-blocking proof that:
//
//   1. A real, signed-in user (not the service role) hitting the deployed
//      `match/{id}/generate-poi` endpoint
//   2. Against a match whose ONLY eligibility failure is `buyer_id` missing
//      (counterparty named but not registered)
//   3. Receives a 202 with a `poi_engagements` row stamped
//      `source = 'eligibility_soft_route'`
//   4. Has zero credits burned
//   5. Is idempotent (same Idempotency-Key → byte-identical engagement)
//   6. Is engagement-locked (a fresh key on the same match → 409
//      ENGAGEMENT_PENDING)
//
// Hermetic by construction: the test resets the fixture match shape and
// scrubs prior engagements/audit/idempotency rows up-front via the service
// role, then re-runs the contract. Skipped (not failed) only when the
// required secrets are absent — the CI job below ALWAYS provides them, so
// in CI a skip is a configuration bug.
//
// Run locally:
//   deno test supabase/functions/match/e2e_soft_route_test.ts \
//     --allow-net --allow-env --no-check
// ─────────────────────────────────────────────────────────────────────────

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL =
  Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY =
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY");

// Controlled fixtures — created and maintained explicitly as the
// soft-route canary in QA. Do not point this at a real customer match.
const FIXTURE_MATCH_ID = "d10e128f-1ca4-4e53-ad78-35e706527fa5";
const FIXTURE_USER_ID = "a08d9adc-433a-4a77-945d-3f909368e2d8";
const FIXTURE_USER_EMAIL = "daniel@izenzo.co.za";
const FIXTURE_ORG_ID = "056152e4-44ff-49f2-802a-72126fa79f11";

// "id-only failure" canonical shape. Eligibility will reject only because
// buyer_id / buyer_org_id are null; everything else is commercially valid.
const FIXTURE_MATCH_SHAPE = {
  org_id: FIXTURE_ORG_ID,
  buyer_name: "Clarkson Grain Company",
  buyer_id: null,
  buyer_org_id: null,
  seller_name: "Izenzo",
  seller_org_id: FIXTURE_ORG_ID,
  seller_id: null, // resolved server-side from seller_org_id
  commodity: "of grain",
  quantity_amount: 8000,
  quantity_unit: "MT",
  price_amount: 70,
  price_currency: "USD",
  match_type: "search",
  status: "matched",
  state: "discovery",
  poi_state: "not_minted",
} as const;

const allEnvPresent = !!(SUPABASE_URL && SERVICE_KEY && ANON_KEY);
if (!allEnvPresent) {
  console.warn(
    "⚠️  e2e_soft_route_test: skipping — missing one of " +
      "VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY",
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function admin() {
  return createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false },
  });
}

/**
 * Reset the fixture match to the canonical id-only-failure shape so the
 * test is hermetic regardless of what previous runs left behind. Also
 * scrubs engagements / audit logs / idempotency rows that would otherwise
 * make the contract assertions ambiguous.
 */
async function resetFixture(): Promise<void> {
  const sb = admin();

  // 1. Reshape the match itself.
  const { error: updErr } = await sb
    .from("matches")
    .update(FIXTURE_MATCH_SHAPE)
    .eq("id", FIXTURE_MATCH_ID);
  if (updErr) {
    throw new Error(`fixture reset: matches.update failed: ${updErr.message}`);
  }

  // 2. Drop any prior engagements for this match.
  await sb.from("poi_engagements").delete().eq("match_id", FIXTURE_MATCH_ID);

  // 3. Drop soft-route audit rows for this match.
  await sb
    .from("audit_logs")
    .delete()
    .eq("entity_id", FIXTURE_MATCH_ID)
    .in("action", [
      "match.poi.soft_routed",
      "match.poi.minted",
      "intent.denied",
    ]);

  // 4. Scrub idempotency keys this test family uses.
  await sb
    .from("idempotency_keys")
    .delete()
    .eq("org_id", FIXTURE_ORG_ID)
    .like("idempotency_key", "e2e-soft-route-%");
}

/**
 * Mint a real end-user JWT via the admin generate-link → verifyOtp flow.
 * We avoid storing user passwords in CI; the service role can produce a
 * one-shot magic-link token, which the anon client then exchanges for a
 * normal session. The resulting JWT is identical in shape to one a
 * production browser session would carry.
 */
async function mintUserJwt(): Promise<string> {
  const adminClient = admin();
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: FIXTURE_USER_EMAIL,
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token");

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false },
  });
  const verify = await userClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verify.error || !verify.data.session) {
    throw new Error(
      `verifyOtp failed: ${verify.error?.message ?? "no session"}`,
    );
  }

  // Sanity: the JWT MUST belong to the fixture user. Otherwise a stray
  // password reset / link in the inbox could swap identities under us.
  const sub = verify.data.session.user.id;
  if (sub !== FIXTURE_USER_ID) {
    throw new Error(
      `mintUserJwt: unexpected sub ${sub}, expected ${FIXTURE_USER_ID}`,
    );
  }
  return verify.data.session.access_token;
}

async function callGeneratePoi(opts: {
  jwt: string;
  idemKey: string;
  body?: Record<string, unknown>;
}) {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/match/${FIXTURE_MATCH_ID}/generate-poi`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.jwt}`,
        apikey: ANON_KEY!,
        "Content-Type": "application/json",
        "Idempotency-Key": opts.idemKey,
      },
      body: JSON.stringify(opts.body ?? {}),
    },
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text };
  }
  return { status: res.status, body: body as Record<string, unknown> };
}

// ────────────────────────────────────────────────────────────────────────
// The test
// ────────────────────────────────────────────────────────────────────────

Deno.test({
  name:
    "e2e: authenticated user, id-only failure → 202 soft-route + idempotent + engagement-locked + zero burn",
  ignore: !allEnvPresent,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // ── Arrange ────────────────────────────────────────────────────────
    await resetFixture();
    const jwt = await mintUserJwt();
    assertExists(jwt, "must mint a real user JWT");

    const sb = admin();
    const balanceBefore = await sb
      .from("token_balances")
      .select("balance")
      .eq("org_id", FIXTURE_ORG_ID)
      .single();
    if (balanceBefore.error) {
      throw new Error(
        `could not read token balance: ${balanceBefore.error.message}`,
      );
    }
    const startingBalance = balanceBefore.data!.balance as number;

    // ── Act 1: first call should soft-route ───────────────────────────
    const idem = `e2e-soft-route-${crypto.randomUUID()}`;
    const r1 = await callGeneratePoi({
      jwt,
      idemKey: idem,
      body: { counterparty_email: "qa-no-such-org@example.invalid" },
    });

    // ── Assert 1: 202 contract ────────────────────────────────────────
    assertEquals(
      r1.status,
      202,
      `expected 202 soft-route, got ${r1.status} body=${JSON.stringify(r1.body)}`,
    );
    const softRoute = r1.body.soft_route as Record<string, unknown> | undefined;
    assertExists(softRoute, "response must include soft_route block");
    assertEquals(softRoute!.status, "queued");

    const engagement = r1.body.engagement as
      | Record<string, unknown>
      | undefined;
    assertExists(engagement, "response must include engagement");
    assertEquals(engagement!.match_id, FIXTURE_MATCH_ID);
    assertEquals(
      engagement!.source,
      "eligibility_soft_route",
      "engagement.source must be stamped eligibility_soft_route",
    );
    assertEquals(engagement!.engagement_status, "pending");
    assertEquals(engagement!.counterparty_type, "unknown");
    assertEquals(engagement!.counterparty_org_id, null);

    const binding = r1.body.binding as Record<string, unknown> | undefined;
    assertExists(binding, "response must include binding");
    assertEquals(binding!.status, "no_match");

    // ── Assert 2: DB row truly exists with the same shape ─────────────
    const dbRow = await sb
      .from("poi_engagements")
      .select("id, match_id, source, engagement_status, counterparty_org_id")
      .eq("match_id", FIXTURE_MATCH_ID)
      .single();
    if (dbRow.error) {
      throw new Error(`poi_engagements row missing: ${dbRow.error.message}`);
    }
    assertEquals(dbRow.data!.id, engagement!.id);
    assertEquals(dbRow.data!.source, "eligibility_soft_route");
    assertEquals(dbRow.data!.engagement_status, "pending");

    // ── Assert 3: zero credits burned on 202 ──────────────────────────
    const balanceAfter = await sb
      .from("token_balances")
      .select("balance")
      .eq("org_id", FIXTURE_ORG_ID)
      .single();
    assertEquals(
      balanceAfter.data!.balance,
      startingBalance,
      "soft-route 202 MUST NOT burn credits",
    );

    // ── Act 2: same idempotency key → identical engagement ────────────
    const r2 = await callGeneratePoi({
      jwt,
      idemKey: idem,
      body: { counterparty_email: "qa-no-such-org@example.invalid" },
    });
    assertEquals(r2.status, 202);
    const engagement2 = r2.body.engagement as Record<string, unknown>;
    assertEquals(
      engagement2.id,
      engagement!.id,
      "idempotency: same key must replay the same engagement id",
    );

    // ── Act 3: NEW key, same match → engagement guard returns 409 ─────
    const r3 = await callGeneratePoi({
      jwt,
      idemKey: `e2e-soft-route-${crypto.randomUUID()}`,
    });
    assertEquals(
      r3.status,
      409,
      `expected 409 ENGAGEMENT_PENDING, got ${r3.status} body=${JSON.stringify(r3.body)}`,
    );
    assertEquals(r3.body.code, "ENGAGEMENT_PENDING");

    // ── Cleanup ───────────────────────────────────────────────────────
    // Don't leave a queued engagement on the fixture for the next run —
    // resetFixture() at the next start handles it, but be a good citizen.
    await sb
      .from("poi_engagements")
      .delete()
      .eq("match_id", FIXTURE_MATCH_ID);
  },
});

// ─────────────────────────────────────────────────────────────────────────
// POI-004 #5 — concurrent soft-route inserts must collapse to ONE row.
//
// Two requests fire in the same tick with DIFFERENT Idempotency-Keys
// against a freshly-reset fixture. Whichever transaction wins INSERTs the
// poi_engagements row; the loser hits the UNIQUE(match_id) constraint
// (SQLSTATE 23505) and the handler must recover by re-fetching and
// returning the same row. Acceptance:
//
//   • Exactly ONE poi_engagements row exists for the fixture match.
//   • Either both responses are 202 with the SAME engagement.id, or one
//     is 202 and the loser is 409 ENGAGEMENT_PENDING (the engagement
//     guard at the top of the handler raced ahead). Both outcomes are
//     idempotent and acceptable.
//   • Zero credits burned (soft-route never charges).
//   • No 5xx response under any interleaving.
//
// This is the runtime backstop for the structural assertions in
// src/tests/poi-004-idempotency.test.ts.
// ─────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "e2e: POI-004 — concurrent soft-route calls produce exactly one engagement row, no 5xx, no burn",
  ignore: !allEnvPresent,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetFixture();
    const jwt = await mintUserJwt();

    const sb = admin();
    const balanceBefore = await sb
      .from("token_balances")
      .select("balance")
      .eq("org_id", FIXTURE_ORG_ID)
      .single();
    const startingBalance = balanceBefore.data!.balance as number;

    // Fire both requests in the same tick, distinct Idempotency-Keys.
    const keyA = `e2e-soft-route-${crypto.randomUUID()}`;
    const keyB = `e2e-soft-route-${crypto.randomUUID()}`;
    const [rA, rB] = await Promise.all([
      callGeneratePoi({
        jwt,
        idemKey: keyA,
        body: { counterparty_email: "qa-no-such-org@example.invalid" },
      }),
      callGeneratePoi({
        jwt,
        idemKey: keyB,
        body: { counterparty_email: "qa-no-such-org@example.invalid" },
      }),
    ]);

    // No 5xx under any interleaving.
    assert(
      rA.status < 500,
      `concurrent A returned 5xx: ${rA.status} ${JSON.stringify(rA.body)}`,
    );
    assert(
      rB.status < 500,
      `concurrent B returned 5xx: ${rB.status} ${JSON.stringify(rB.body)}`,
    );

    // Acceptable shapes:
    //   - both 202 with same engagement.id (UNIQUE recovery path), OR
    //   - one 202 + one 409 ENGAGEMENT_PENDING (engagement guard race).
    const statuses = [rA.status, rB.status].sort();
    const ok202Pair = statuses[0] === 202 && statuses[1] === 202;
    const ok202Plus409 = statuses[0] === 202 && statuses[1] === 409;
    assert(
      ok202Pair || ok202Plus409,
      `unexpected concurrent status pair ${statuses.join(",")} A=${JSON.stringify(rA.body)} B=${JSON.stringify(rB.body)}`,
    );

    if (ok202Pair) {
      const idA = (rA.body.engagement as Record<string, unknown>)?.id;
      const idB = (rB.body.engagement as Record<string, unknown>)?.id;
      assertEquals(
        idA,
        idB,
        "concurrent 202s must reference the SAME engagement.id (UNIQUE recovery)",
      );
    } else {
      // The 409 loser must carry the canonical ENGAGEMENT_PENDING code.
      const loser = rA.status === 409 ? rA : rB;
      assertEquals(loser.body.code, "ENGAGEMENT_PENDING");
    }

    // Exactly one engagement row in the database for this match.
    const rows = await sb
      .from("poi_engagements")
      .select("id")
      .eq("match_id", FIXTURE_MATCH_ID);
    assertEquals(
      (rows.data ?? []).length,
      1,
      `expected exactly 1 poi_engagements row, got ${(rows.data ?? []).length}`,
    );

    // Zero credits burned.
    const balanceAfter = await sb
      .from("token_balances")
      .select("balance")
      .eq("org_id", FIXTURE_ORG_ID)
      .single();
    assertEquals(
      balanceAfter.data!.balance,
      startingBalance,
      "soft-route concurrent calls MUST NOT burn credits",
    );

    // Cleanup.
    await sb
      .from("poi_engagements")
      .delete()
      .eq("match_id", FIXTURE_MATCH_ID);
  },
});

// ─────────────────────────────────────────────────────────────────────────
// POI-004 #2 — same Idempotency-Key, two concurrent requests.
//
// Belt-and-braces over the cache layer: two parallel requests with the
// SAME Idempotency-Key against the same fixture must both return 202,
// reference the SAME engagement.id, and produce exactly one DB row. No
// duplicate burn, no duplicate audit row.
// ─────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "e2e: POI-004 — concurrent calls with SAME Idempotency-Key replay to one engagement",
  ignore: !allEnvPresent,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetFixture();
    const jwt = await mintUserJwt();
    const sb = admin();

    const sameKey = `e2e-soft-route-${crypto.randomUUID()}`;
    const [rA, rB] = await Promise.all([
      callGeneratePoi({
        jwt,
        idemKey: sameKey,
        body: { counterparty_email: "qa-no-such-org@example.invalid" },
      }),
      callGeneratePoi({
        jwt,
        idemKey: sameKey,
        body: { counterparty_email: "qa-no-such-org@example.invalid" },
      }),
    ]);

    assert(rA.status < 500 && rB.status < 500, "no 5xx allowed");
    assertEquals(rA.status, 202);
    assertEquals(rB.status, 202);

    const idA = (rA.body.engagement as Record<string, unknown>)?.id;
    const idB = (rB.body.engagement as Record<string, unknown>)?.id;
    assertEquals(idA, idB, "same Idempotency-Key must replay same engagement.id");

    const rows = await sb
      .from("poi_engagements")
      .select("id")
      .eq("match_id", FIXTURE_MATCH_ID);
    assertEquals((rows.data ?? []).length, 1);

    // Audit: exactly one soft_routed row for this match.
    const audit = await sb
      .from("audit_logs")
      .select("id")
      .eq("entity_id", FIXTURE_MATCH_ID)
      .eq("action", "match.poi.soft_routed");
    assertEquals(
      (audit.data ?? []).length,
      1,
      `expected exactly 1 match.poi.soft_routed audit row, got ${(audit.data ?? []).length}`,
    );

    await sb.from("poi_engagements").delete().eq("match_id", FIXTURE_MATCH_ID);
  },
});
