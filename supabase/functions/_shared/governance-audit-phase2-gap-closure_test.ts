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
  // Pass 3 — remaining sensitive admin endpoints.
  ["admin-compliance-hold-release",        "compliance_hold.release"],
  ["admin-compliance-hold-close",          "compliance_hold.close"],
  ["admin-residency-review-approve",       "residency_review.approve"],
  ["admin-residency-review-decline",       "residency_review.decline"],
  ["admin-credit-org",                     "credit_org.adjust"],
  ["admin-trade-request-exception-hold-release", "trade_request_exception.release"],
  ["admin-trade-request-archive-override", "trade_request.archive_override"],
] as const;

const MULTI_OP_ENDPOINTS: Array<[string, readonly string[]]> = [
  ["admin-counterparty-corrections", [
    "counterparty.correct.link_to_org",
    "counterparty.correct.merge",
  ]],
  ["admin-match-corrections", [
    "match.correct.jurisdiction",
    "match.correct.relink_counterparty",
    "match.correct.archive_duplicate",
  ]],
  ["admin-manual-overrides", [
    "manual_override.${parsed.operation}",
  ]],
];

for (const [endpoint, actionCode] of WIRED_ENDPOINTS) {
  Deno.test(`${endpoint} wires admin.hq_decision_recorded fail-closed`, async () => {
    const src = await read(`${endpoint}/index.ts`);
    assertStringIncludes(src, "recordAdminHqDecision");
    assertStringIncludes(src, `actionCode: "${actionCode}"`);
    assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
    assertStringIncludes(src, `sourceFunction: "${endpoint}"`);
    // Reason must be the operator-supplied reason, not a hard-coded string.
    assert(
      /reason:\s*(p\.data\.reason|reason|parsed\.data\.reason|parsed\.reason|\(parsed as \{ reason: string \}\)\.reason)/
        .test(src),
      `${endpoint} must forward operator reason`,
    );
  });
}

for (const [endpoint, actionCodes] of MULTI_OP_ENDPOINTS) {
  Deno.test(`${endpoint} wires admin.hq_decision_recorded (multi-operation) fail-closed`, async () => {
    const src = await read(`${endpoint}/index.ts`);
    assertStringIncludes(src, "recordAdminHqDecision");
    assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
    assertStringIncludes(src, `sourceFunction: "${endpoint}"`);
    for (const code of actionCodes) {
      assertStringIncludes(src, code);
    }
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
