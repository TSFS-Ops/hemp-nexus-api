/**
 * Phase 2 Gap Closure — static adoption tests for admin.hq_decision_recorded
 * wiring across sensitive admin endpoints. Mirrors the existing adoption
 * test pattern (grep-based) so it runs without DB access.
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordAdminHqDecision } from "./admin-hq-audit.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

const WIRED_ENDPOINTS = [
  ["admin-refund-approve",                 "refund.approve"],
  ["admin-refund-decline",                 "refund.decline"],
  ["admin-payment-dispute-record",         "payment_dispute.record_manual"],
  ["admin-payment-dispute-resolve-won",    "payment_dispute.resolve_won"],
  ["admin-payment-dispute-resolve-lost",   "payment_dispute.resolve_lost"],
  ["admin-billing-hold-apply",             "billing_hold.apply"],
  ["admin-billing-hold-release",           "billing_hold.release"],
] as const;

for (const [endpoint, actionCode] of WIRED_ENDPOINTS) {
  Deno.test(`${endpoint} wires admin.hq_decision_recorded fail-closed`, async () => {
    const src = await read(`${endpoint}/index.ts`);
    assertStringIncludes(src, "recordAdminHqDecision");
    assertStringIncludes(src, `actionCode: "${actionCode}"`);
    assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
    assertStringIncludes(src, `sourceFunction: "${endpoint}"`);
    // Reason must be the operator-supplied reason, not a hard-coded string.
    assert(/reason:\s*p\.data\.reason/.test(src), `${endpoint} must forward operator reason`);
  });
}

Deno.test("recordAdminHqDecision rejects short / empty reason (REASON_REQUIRED contract)", async () => {
  let threw = false;
  try {
    await recordAdminHqDecision({
      admin: {} as any,
      sourceFunction: "test",
      actionCode: "test.action",
      actorUserId: "u",
      orgId: "o",
      aggregateId: "a",
      aggregateType: "t",
      reason: "short",
    });
  } catch (e) {
    threw = true;
    assertStringIncludes(String((e as Error).message), "ADMIN_HQ_REASON_REQUIRED");
  }
  assert(threw, "must throw on missing reason");
});

Deno.test("payment.event_created still emitted by token-purchase webhook charge.success path", async () => {
  const src = await read("token-purchase/index.ts");
  assertStringIncludes(src, '"payment.event_created"');
  assertStringIncludes(src, 'source_function: "token-purchase/webhook"');
  // Idempotency derived from Paystack reference → webhook retries dedupe at writer.
  assertStringIncludes(src, "idempotency_extra: reference");
});
