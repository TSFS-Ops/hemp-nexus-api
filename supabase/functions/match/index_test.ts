// Unit + integration tests for the POI mint soft-route flow.
//
// Two layers:
//
//   1. Pure unit tests on `evaluateSoftRoute` — the policy that decides
//      whether an `ELIGIBILITY_FAILED` outcome is safe to soft-route into
//      a Pending Engagement. These are the rules we MUST not regress:
//      any non-id failure must hard-fail; unilateral matches must hard-fail;
//      ids missing without corresponding names must hard-fail.
//
//   2. Live integration tests that hit the deployed `match` edge function
//      against the real database. Skipped if SUPABASE_URL /
//      SUPABASE_SERVICE_ROLE_KEY env vars aren't present.
//
// Run all:    deno test supabase/functions/match/index_test.ts --allow-net --allow-env
// Run unit:   deno test supabase/functions/match/index_test.ts --allow-net --allow-env --filter "soft-route policy"

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  evaluateEligibility,
} from "../_shared/eligibility.ts";
import { evaluateSoftRoute, resolveCounterpartyBinding } from "../_shared/soft-route.ts";

// ────────────────────────────────────────────────────────────────────────
// 1. Pure unit tests — soft-route policy
// ────────────────────────────────────────────────────────────────────────

const VALID_BILATERAL_EXCEPT_BUYER_ID = {
  match_type: "bilateral",
  buyer_name: "Clarkson Grain Company",
  // buyer_id intentionally missing
  seller_id: "seller-org-123",
  seller_name: "Izenzo",
  commodity: "wheat",
  quantity_amount: 8000,
  quantity_unit: "MT",
  price_amount: 70,
  price_currency: "USD",
} as Record<string, unknown>;

Deno.test("soft-route policy: bilateral with only buyer_id missing → eligible", () => {
  const elig = evaluateEligibility(VALID_BILATERAL_EXCEPT_BUYER_ID);
  assertEquals(elig.eligible, false, "sanity: eligibility should fail");
  assertEquals(elig.failedFields, ["buyer_id"]);

  const route = evaluateSoftRoute(VALID_BILATERAL_EXCEPT_BUYER_ID, elig);
  assertEquals(route.eligible, true);
  assertEquals(route.missingBuyerId, true);
  assertEquals(route.missingSellerId, false);
  assertEquals(route.failedFields, ["buyer_id"]);
});

Deno.test("soft-route policy: bilateral with only seller_id missing → eligible", () => {
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    buyer_id: "buyer-org-1",
    seller_id: undefined,
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.failedFields, ["seller_id"]);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, true);
  assertEquals(route.missingSellerId, true);
});

Deno.test("soft-route policy: both ids missing but both names present → eligible", () => {
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    seller_id: undefined,
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.failedFields.sort(), ["buyer_id", "seller_id"].sort());
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, true);
  assertEquals(route.missingBuyerId, true);
  assertEquals(route.missingSellerId, true);
});

Deno.test("soft-route policy: missing price → MUST NOT soft-route", () => {
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    buyer_id: "buyer-org-1",
    price_amount: undefined,
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assert(elig.failedFields.includes("price_amount"));
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  assertEquals(route.reason, "non_soft_routable_field:price_amount");
});

Deno.test("soft-route policy: missing commodity → MUST NOT soft-route", () => {
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    buyer_id: "buyer-org-1",
    commodity: undefined,
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  assert(route.reason?.startsWith("non_soft_routable_field:commodity"));
});

Deno.test("soft-route policy: id missing AND price missing → MUST NOT soft-route", () => {
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    price_amount: undefined,
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  // Either price_amount or buyer_id can come first; both block.
  assert(route.reason?.startsWith("non_soft_routable_field:"));
});

Deno.test("soft-route policy: same buyer/seller (SAME_COUNTERPARTY) → MUST NOT soft-route", () => {
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    buyer_id: "same-id",
    seller_id: "same-id",
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
});

Deno.test("soft-route policy: unilateral match → MUST NOT soft-route", () => {
  const m = {
    match_type: "unilateral",
    commodity: "wheat",
    quantity_amount: 100,
    quantity_unit: "MT",
    price_amount: 50,
    price_currency: "USD",
    // declaring party missing entirely
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  assertEquals(route.reason, "soft_route_not_supported_for_unilateral");
});

Deno.test("soft-route policy: buyer_id missing AND buyer_name missing → MUST NOT soft-route", () => {
  // No name on the missing side — there is nothing to engage with.
  const m = {
    ...VALID_BILATERAL_EXCEPT_BUYER_ID,
    buyer_name: undefined,
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  assertEquals(route.reason, "buyer_id_missing_and_no_buyer_name");
});

// ────────────────────────────────────────────────────────────────────────
// 2. Pure unit tests — binding resolver (mocked supabase)
// ────────────────────────────────────────────────────────────────────────

function makeFakeSupabase(behaviour: "match" | "no_match" | "error") {
  return {
    from(_t: string) {
      const chain = {
        select() { return chain; },
        ilike() { return chain; },
        not() { return chain; },
        limit() { return chain; },
        async maybeSingle() {
          if (behaviour === "error") return { data: null, error: { message: "boom" } };
          if (behaviour === "match") return { data: { org_id: "org-real" }, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

Deno.test("binding resolver: no email → no_email", async () => {
  const r = await resolveCounterpartyBinding(makeFakeSupabase("no_match"), null, "rid");
  assertEquals(r.status, "no_email");
});

Deno.test("binding resolver: matched email → bound", async () => {
  const r = await resolveCounterpartyBinding(makeFakeSupabase("match"), "user@example.com", "rid");
  assertEquals(r.status, "bound");
  if (r.status === "bound") assertEquals(r.org_id, "org-real");
});

Deno.test("binding resolver: unmatched email → no_match", async () => {
  const r = await resolveCounterpartyBinding(makeFakeSupabase("no_match"), "user@example.com", "rid");
  assertEquals(r.status, "no_match");
});

Deno.test("binding resolver: lookup error → lookup_error", async () => {
  const r = await resolveCounterpartyBinding(makeFakeSupabase("error"), "user@example.com", "rid");
  assertEquals(r.status, "lookup_error");
});

// ────────────────────────────────────────────────────────────────────────
// 3. LIVE INTEGRATION — deployed match function, real DB
//    Proves the 422 → 202 contract on a controlled match. Skips silently
//    if env vars aren't present (so CI without secrets stays green).
// ────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TEST_MATCH_ID = "d10e128f-1ca4-4e53-ad78-35e706527fa5"; // Daniel-shape match
const TEST_USER_ID = "a08d9adc-433a-4a77-945d-3f909368e2d8";   // Daniel
const TEST_ORG_ID = "056152e4-44ff-49f2-802a-72126fa79f11";    // Izenzo

async function mintUserJwt(): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // Generate a magic-link admin URL, pull the access_token out — service
  // role is allowed to do this. Lets us hit the function with a real user
  // JWT so the auth path matches production traffic.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "daniel@izenzo.co.za",
  });
  if (error || !data?.properties?.hashed_token) return null;
  // Exchange the OTP token for a session
  const anonKey = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return null;
  const userClient = createClient(SUPABASE_URL, anonKey);
  const verify = await userClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verify.error || !verify.data.session) return null;
  return verify.data.session.access_token;
}

async function callGeneratePoi(jwt: string, idemKey: string, body?: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/match/${TEST_MATCH_ID}/generate-poi`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify(body ?? {}),
    },
  );
  return { status: res.status, body: await res.json() };
}

async function deleteEngagementForTestMatch() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  await admin.from("poi_engagements").delete().eq("match_id", TEST_MATCH_ID);
  await admin.from("audit_logs")
    .delete()
    .eq("entity_id", TEST_MATCH_ID)
    .in("action", ["match.poi.soft_routed", "intent.denied"]);
  await admin.from("idempotency_keys")
    .delete()
    .eq("org_id", TEST_ORG_ID)
    .like("idempotency_key", "soft-route-it-%");
}

Deno.test({
  name: "live integration: id-only failure → 202 with engagement + binding",
  ignore: !SUPABASE_URL || !SERVICE_KEY,
  fn: async () => {
    const jwt = await mintUserJwt();
    assertExists(jwt, "could not mint user JWT — check service-role + anon keys");
    await deleteEngagementForTestMatch();

    const idem = `soft-route-it-${crypto.randomUUID()}`;
    const r = await callGeneratePoi(jwt!, idem, {
      counterparty_email: "qa-no-such-org@example.invalid",
    });

    assertEquals(r.status, 202, `expected 202 got ${r.status} body=${JSON.stringify(r.body)}`);
    assertExists(r.body.soft_route);
    assertEquals(r.body.soft_route.status, "queued");
    assertExists(r.body.engagement);
    assertEquals(r.body.engagement.source, "eligibility_soft_route");
    assertEquals(r.body.engagement.match_id, TEST_MATCH_ID);
    assertEquals(r.body.engagement.engagement_status, "pending");
    assertEquals(r.body.engagement.counterparty_type, "unknown");
    assertEquals(r.body.engagement.counterparty_org_id, null);
    assertExists(r.body.binding);
    assertEquals(r.body.binding.status, "no_match");

    // Idempotency: same key → byte-identical body
    const r2 = await callGeneratePoi(jwt!, idem, {
      counterparty_email: "qa-no-such-org@example.invalid",
    });
    assertEquals(r2.status, 202);
    assertEquals(r2.body.engagement.id, r.body.engagement.id);

    // Subsequent attempt with NEW key but same match → 409
    // ENGAGEMENT_PENDING (the engagement guard at the top of the handler
    // now blocks it). This proves the soft-route stays queued and does
    // NOT silently re-mint.
    const r3 = await callGeneratePoi(jwt!, `soft-route-it-${crypto.randomUUID()}`);
    assertEquals(r3.status, 409, `expected 409 got ${r3.status} body=${JSON.stringify(r3.body)}`);
    assertEquals(r3.body.code, "ENGAGEMENT_PENDING");
  },
});

Deno.test({
  name: "live integration: NO credit charged on soft-route 202",
  ignore: !SUPABASE_URL || !SERVICE_KEY,
  fn: async () => {
    const jwt = await mintUserJwt();
    assertExists(jwt);
    await deleteEngagementForTestMatch();

    const admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    const before = await admin.from("token_balances")
      .select("balance").eq("org_id", TEST_ORG_ID).single();

    const r = await callGeneratePoi(jwt!, `soft-route-it-${crypto.randomUUID()}`);
    assertEquals(r.status, 202);

    const after = await admin.from("token_balances")
      .select("balance").eq("org_id", TEST_ORG_ID).single();
    assertEquals(after.data?.balance, before.data?.balance,
      "soft-route 202 must NOT burn credits");
  },
});
