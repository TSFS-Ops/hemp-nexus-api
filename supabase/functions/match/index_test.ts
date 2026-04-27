// Pure unit tests for the POI mint soft-route flow.
//
//   1. `evaluateSoftRoute` — policy that decides whether an
//      `ELIGIBILITY_FAILED` outcome is safe to soft-route into a Pending
//      Engagement. Rules we MUST not regress: any non-id failure must
//      hard-fail; unilateral matches must hard-fail; ids missing without
//      corresponding names must hard-fail.
//
//   2. `resolveCounterpartyBinding` — email→org lookup over a fake
//      supabase client. Confirms the four binding states stay stable.
//
// The full authenticated 422 → 202 contract lives in
// `e2e_soft_route_test.ts` and runs in the dedicated `e2e-soft-route`
// CI job (which provides the service-role key).
//
// Run:    deno test supabase/functions/match/index_test.ts --allow-net --allow-env
// Filter: --filter "soft-route policy"

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../_shared/eligibility.ts";
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
  // Either reason is acceptable: the policy may catch the missing
  // buyer_name field first OR the missing buyer_id+name pair second.
  // Both are hard-fails for the right reason.
  assert(
    route.reason === "buyer_id_missing_and_no_buyer_name" ||
      route.reason?.startsWith("non_soft_routable_field:buyer_name"),
    `unexpected reason: ${route.reason}`,
  );
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
// 3. LIVE INTEGRATION
//
// The full authenticated 422 → 202 contract test (real user JWT against
// the deployed function, idempotency replay, engagement guard, and
// zero-credit-burn assertion) lives in `e2e_soft_route_test.ts` and is
// run by the dedicated `e2e-soft-route` GitHub Actions job. Keeping it
// in a separate file means this `index_test.ts` stays a fast, hermetic
// pure-unit suite that CI can always run without secrets.
// ────────────────────────────────────────────────────────────────────────

