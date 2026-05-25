/**
 * governance-reason-codes_test.ts — Batch C tests.
 *
 * Covers the pure normaliser, the legacy literal map, and the namespace
 * approval helper. The writer-level WARN-only integration is exercised in
 * governance-audit_batch-c_test.ts.
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVED_REASON_CODE_NAMESPACES,
  isApprovedNamespacedReasonCode,
  LEGACY_REASON_CODE_MAP,
  normaliseReasonCode,
  reasonCodeNamespace,
} from "./governance-reason-codes.ts";

Deno.test("normaliseReasonCode — null/undefined/empty → null", () => {
  assertEquals(normaliseReasonCode(null), null);
  assertEquals(normaliseReasonCode(undefined), null);
  assertEquals(normaliseReasonCode(""), null);
  assertEquals(normaliseReasonCode("   "), null);
});

Deno.test("normaliseReasonCode — collapse/finality literals", () => {
  assertEquals(normaliseReasonCode("COLLAPSE_OK"), "system:collapse_ok");
  assertEquals(normaliseReasonCode("COLLAPSE_FINAL"), "system:collapse_final");
});

Deno.test("normaliseReasonCode — gate-failure literals", () => {
  assertEquals(normaliseReasonCode("HARD_GATE_FAILED"), "system:hard_gate_failed");
  assertEquals(normaliseReasonCode("DISCOVERY_GATE_FAILED"), "system:discovery_gate_failed");
  assertEquals(normaliseReasonCode("UBO_INCOMPLETE"), "system:ubo_incomplete");
});

Deno.test("normaliseReasonCode — credit/token literals", () => {
  assertEquals(normaliseReasonCode("TOKEN_BURN_RPC_ERROR"), "system:token_burn_rpc_error");
  // INSUFFICIENT_TOKENS folds into the David-approved business code.
  assertEquals(normaliseReasonCode("INSUFFICIENT_TOKENS"), "credit_burn_not_allowed");
});

Deno.test("normaliseReasonCode — payment/provider literals", () => {
  assertEquals(normaliseReasonCode("charge.success"), "payment:charge_success");
  assertEquals(normaliseReasonCode("charge.failed"), "payment:charge_failed");
  assertEquals(normaliseReasonCode("refund.processed"), "payment:refund_processed");
  assertEquals(
    normaliseReasonCode("refund.partial:manual_review"),
    "payment:refund_partial_manual_review",
  );
  assertEquals(
    normaliseReasonCode("refund.rejected:no_matching_purchase"),
    "payment:refund_rejected_no_matching_purchase",
  );
  assertEquals(
    normaliseReasonCode("refund.rejected:org_mismatch"),
    "payment:refund_rejected_org_mismatch",
  );
  assertEquals(normaliseReasonCode("chargeback.won"), "payment:chargeback_won");
  assertEquals(normaliseReasonCode("chargeback.lost"), "payment:chargeback_lost");
  assertEquals(normaliseReasonCode("dispute.create"), "payment:dispute_create");
});

Deno.test("normaliseReasonCode — David-approved codes pass through unchanged", () => {
  for (const code of [
    "client_instruction",
    "missing_email",
    "wad_not_passed",
    "dispute_active",
    "other",
  ]) {
    assertEquals(normaliseReasonCode(code), code);
  }
});

Deno.test("normaliseReasonCode — unknown unnamespaced codes pass through unchanged", () => {
  assertEquals(normaliseReasonCode("not_a_real_code"), "not_a_real_code");
});

Deno.test("normaliseReasonCode — unknown namespaced codes pass through unchanged", () => {
  assertEquals(normaliseReasonCode("api:my-endpoint"), "api:my-endpoint");
  assertEquals(normaliseReasonCode("scope:org"), "scope:org");
  assertEquals(normaliseReasonCode("random:foo"), "random:foo");
});

Deno.test("normaliseReasonCode — never throws on arbitrary input", () => {
  // Should be impossible to throw — defensive call shape.
  assertEquals(normaliseReasonCode("   COLLAPSE_OK   "), "system:collapse_ok");
});

Deno.test("APPROVED_REASON_CODE_NAMESPACES — exact set of six prefixes", () => {
  assertEquals(
    [...APPROVED_REASON_CODE_NAMESPACES].sort(),
    ["action", "api", "legacy", "payment", "scope", "system"],
  );
});

Deno.test("reasonCodeNamespace — extracts prefix or returns null", () => {
  assertEquals(reasonCodeNamespace("system:collapse_ok"), "system");
  assertEquals(reasonCodeNamespace("payment:charge_success"), "payment");
  assertEquals(reasonCodeNamespace("client_instruction"), null);
  assertEquals(reasonCodeNamespace(null), null);
  assertEquals(reasonCodeNamespace(""), null);
  // Leading colon is not a valid namespace.
  assertEquals(reasonCodeNamespace(":foo"), null);
});

Deno.test("isApprovedNamespacedReasonCode — allows approved namespaces only", () => {
  assert(isApprovedNamespacedReasonCode("system:foo"));
  assert(isApprovedNamespacedReasonCode("payment:anything"));
  assert(isApprovedNamespacedReasonCode("api:custom_endpoint"));
  assert(isApprovedNamespacedReasonCode("action:credit_burn"));
  assert(isApprovedNamespacedReasonCode("scope:org"));
  assert(isApprovedNamespacedReasonCode("legacy:something"));
  // Disallowed namespace
  assertEquals(isApprovedNamespacedReasonCode("random:foo"), false);
  // Unnamespaced
  assertEquals(isApprovedNamespacedReasonCode("client_instruction"), false);
  assertEquals(isApprovedNamespacedReasonCode(null), false);
});

Deno.test("LEGACY_REASON_CODE_MAP — covers every literal called out in Batch C scope", () => {
  for (const k of [
    "COLLAPSE_OK",
    "COLLAPSE_FINAL",
    "HARD_GATE_FAILED",
    "DISCOVERY_GATE_FAILED",
    "UBO_INCOMPLETE",
    "TOKEN_BURN_RPC_ERROR",
    "INSUFFICIENT_TOKENS",
    "charge.success",
    "charge.failed",
    "refund.processed",
    "refund.partial:manual_review",
    "refund.rejected:no_matching_purchase",
    "refund.rejected:org_mismatch",
    "chargeback.won",
    "chargeback.lost",
    "dispute.create",
  ]) {
    assert(LEGACY_REASON_CODE_MAP[k], `missing literal: ${k}`);
  }
});
