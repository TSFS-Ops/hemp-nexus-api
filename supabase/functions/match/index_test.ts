// Pure unit tests for POI mint eligibility under the post-2026-04-27 policy:
//
//   "No hard verification before POI. Name-only counterparties are accepted.
//    Hard verification (KYB/IDV/UBO) remains mandatory at WaD."
//
// What this file proves:
//   1. `evaluateEligibility` accepts a bilateral match with NAMED-but-not-
//      registered counterparties (no buyer_id / seller_id) when commercial
//      terms are present.
//   2. Real commercial gaps (missing price, missing commodity, same buyer
//      and seller) still hard-fail.
//   3. The legacy `evaluateSoftRoute` and `resolveCounterpartyBinding`
//      helpers stay correct so audit-trail behaviour does not regress
//      for any historical 422 still in flight.
//
// Run:    deno test supabase/functions/match/index_test.ts --allow-net --allow-env
// Filter: --filter "eligibility"

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../_shared/eligibility.ts";
import { evaluateSoftRoute, resolveCounterpartyBinding } from "../_shared/soft-route.ts";

// ────────────────────────────────────────────────────────────────────────
// 1. Eligibility under the new "name-only" policy
// ────────────────────────────────────────────────────────────────────────

const NAMED_BILATERAL = {
  match_type: "bilateral",
  buyer_name: "Clarkson Grain Company",
  seller_name: "Izenzo",
  // No buyer_id / seller_id — neither side is registered yet.
  commodity: "wheat",
  quantity_amount: 8000,
  quantity_unit: "MT",
  price_amount: 70,
  price_currency: "USD",
} as Record<string, unknown>;

Deno.test("eligibility: named-but-unregistered bilateral match → eligible", () => {
  const elig = evaluateEligibility(NAMED_BILATERAL);
  assertEquals(elig.eligible, true, `expected eligible, got reasons=${JSON.stringify(elig.reasons)}`);
  assertEquals(elig.failedFields, []);
});

Deno.test("eligibility: missing price → still hard-fails", () => {
  const m = { ...NAMED_BILATERAL, price_amount: undefined } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.eligible, false);
  assert(elig.failedFields.includes("price_amount"));
});

Deno.test("eligibility: missing commodity → still hard-fails", () => {
  const m = { ...NAMED_BILATERAL, commodity: undefined } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.eligible, false);
  assert(elig.failedFields.includes("commodity"));
});

Deno.test("eligibility: missing buyer name → hard-fails (need somebody on each side)", () => {
  const m = { ...NAMED_BILATERAL, buyer_name: undefined } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.eligible, false);
  assert(elig.failedFields.includes("buyer_name"));
});

Deno.test("eligibility: same buyer / seller name (name-only) → WARNING, still eligible", () => {
  // Post-2026-04-27 strictness pass: name-only collision is a WARNING, not an
  // error, so two distinct legal entities sharing a trading name across
  // jurisdictions are not falsely blocked. The warning still surfaces in
  // `reasons` so reviewers see it before sealing.
  const m = {
    ...NAMED_BILATERAL,
    buyer_name: "Same Co",
    seller_name: "  same co  ", // case + whitespace insensitive
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.eligible, true, `expected eligible (warning only), got reasons=${JSON.stringify(elig.reasons)}`);
  const warningCodes = elig.reasons.filter(r => r.severity === "warning").map(r => r.code);
  assert(warningCodes.includes("SAME_COUNTERPARTY_NAME"), `warningCodes=${warningCodes.join(",")}`);
});

Deno.test("eligibility: same buyer_id / seller_id (registered) → SAME_COUNTERPARTY hard-fails", () => {
  const m = {
    ...NAMED_BILATERAL,
    buyer_id: "org-x",
    seller_id: "org-x",
    buyer_name: "Foo",
    seller_name: "Bar",
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.eligible, false);
  const codes = elig.reasons.map((r) => r.code);
  assert(codes.includes("SAME_COUNTERPARTY"), `codes=${codes.join(",")}`);
});

Deno.test("eligibility: unilateral with declaring party + commercial terms → eligible", () => {
  const m = {
    match_type: "unilateral",
    buyer_id: "org-1",
    buyer_name: "Buyer A",
    commodity: "wheat",
    quantity_amount: 10,
    quantity_unit: "MT",
    price_amount: 50,
    price_currency: "USD",
  } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  assertEquals(elig.eligible, true, `reasons=${JSON.stringify(elig.reasons)}`);
});

// ────────────────────────────────────────────────────────────────────────
// 2. Soft-route helper still correct (defensive — fires only for residual
//    422s; under the new policy these are rare).
// ────────────────────────────────────────────────────────────────────────

Deno.test("soft-route: missing price still NOT soft-routable", () => {
  const m = { ...NAMED_BILATERAL, price_amount: undefined } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  assertEquals(route.reason, "non_soft_routable_field:price_amount");
});

Deno.test("soft-route: unilateral never soft-routable", () => {
  const m = { match_type: "unilateral", commodity: "wheat" } as Record<string, unknown>;
  const elig = evaluateEligibility(m);
  const route = evaluateSoftRoute(m, elig);
  assertEquals(route.eligible, false);
  assertEquals(route.reason, "soft_route_not_supported_for_unilateral");
});

// ────────────────────────────────────────────────────────────────────────
// 3. Binding resolver — used by both the soft-route legacy path and by
//    the poi-engagements PATCH contract.
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
// 4. Counterparty registration gate (post-2026-04-27 policy)
// ────────────────────────────────────────────────────────────────────────

import { evaluateCounterpartyGate } from "../_shared/soft-route.ts";

const CALLER = "org-caller";

Deno.test("cp-gate: both sides registered → proceed", () => {
  const m = { match_type: "search", buyer_org_id: CALLER, seller_org_id: "org-other", buyer_name: "B", seller_name: "S" };
  assertEquals(evaluateCounterpartyGate(m, CALLER).decision, "proceed");
});

Deno.test("cp-gate: named seller, no seller_org_id → soft_route", () => {
  const m = { match_type: "search", buyer_org_id: CALLER, seller_org_id: null, buyer_name: "B", seller_name: "Amstad Produce LLC" };
  const r = evaluateCounterpartyGate(m, CALLER);
  assertEquals(r.decision, "soft_route");
  if (r.decision === "soft_route") {
    assertEquals(r.missing_party, "seller");
    assertEquals(r.counterparty_name, "Amstad Produce LLC");
  }
});

Deno.test("cp-gate: named buyer, no buyer_org_id → soft_route", () => {
  const m = { match_type: "search", buyer_org_id: null, seller_org_id: CALLER, buyer_name: "Acme Buyer", seller_name: "S" };
  const r = evaluateCounterpartyGate(m, CALLER);
  assertEquals(r.decision, "soft_route");
  if (r.decision === "soft_route") assertEquals(r.missing_party, "buyer");
});

Deno.test("cp-gate: missing seller name AND seller_org_id → missing_details", () => {
  const m = { match_type: "search", buyer_org_id: CALLER, seller_org_id: null, buyer_name: "B", seller_name: "" };
  const r = evaluateCounterpartyGate(m, CALLER);
  assertEquals(r.decision, "missing_details");
  if (r.decision === "missing_details") {
    assertEquals(r.missing_party, "seller");
    assert(r.missing.includes("name"));
    assert(r.missing.includes("org"));
  }
});

Deno.test("cp-gate: whitespace-only seller name → missing_details", () => {
  const m = { match_type: "search", buyer_org_id: CALLER, seller_org_id: null, buyer_name: "B", seller_name: "   " };
  assertEquals(evaluateCounterpartyGate(m, CALLER).decision, "missing_details");
});

Deno.test("cp-gate: unilateral always proceeds (handled elsewhere)", () => {
  const m = { match_type: "unilateral", buyer_org_id: CALLER, seller_org_id: null, buyer_name: "B", seller_name: "" };
  assertEquals(evaluateCounterpartyGate(m, CALLER).decision, "proceed");
});

Deno.test("cp-gate: production regression — match d945c7cb (search, named seller, no seller ids)", () => {
  // Exact shape of the production row that surfaced the bug.
  const m = {
    match_type: "search",
    state: "discovery",
    status: "matched",
    buyer_org_id: "354a6566-57a1-4d79-abae-19b31b6ddce5",
    seller_org_id: null,
    buyer_name: "Pending verification (legacy)",
    seller_name: "Amstad Produce LLC",
    commodity: "potatoes",
    price_amount: 50,
    price_currency: "USD",
    quantity_amount: 1000,
    quantity_unit: "MT",
  };
  const r = evaluateCounterpartyGate(m, "354a6566-57a1-4d79-abae-19b31b6ddce5");
  assertEquals(r.decision, "soft_route");
  if (r.decision === "soft_route") {
    assertEquals(r.missing_party, "seller");
    assertEquals(r.counterparty_name, "Amstad Produce LLC");
  }
});
