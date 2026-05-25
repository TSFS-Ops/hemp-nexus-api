/**
 * governance-audit_batch-c_test.ts — Batch C writer integration tests.
 *
 * Exercises validateGovernanceInput end-to-end for reason-code normalisation:
 *   • known legacy literals are normalised in-place on the input
 *   • original_reason_code is stashed in metadata when normalisation changed
 *     the value (and ONLY then)
 *   • approved namespaces (api:/system:/payment:/...) do not WARN
 *   • unknown unnamespaced codes WARN but never throw
 *   • unknown disallowed namespaces WARN but never throw
 *   • Batch B HQ-note flow continues to accept its enum values
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type GovernanceWriteInput,
  isApprovedReasonCode,
  validateGovernanceInput,
} from "./governance-audit.ts";

function baseInput(over: Partial<GovernanceWriteInput> = {}): GovernanceWriteInput {
  return {
    event_type: "pending_engagement.outreach_blocked",
    org_id: "00000000-0000-0000-0000-000000000001",
    aggregate_type: "engagement",
    aggregate_id: "00000000-0000-0000-0000-000000000002",
    actor_user_id: "00000000-0000-0000-0000-000000000003",
    source_function: "batch-c-test",
    ...over,
  };
}

// Capture console.warn invocations without leaking noise across tests.
function captureWarn(): { restore: () => void; calls: unknown[][] } {
  const orig = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.warn = orig;
    },
  };
}

Deno.test("validateGovernanceInput — normalises COLLAPSE_OK and preserves original_reason_code", () => {
  const input = baseInput({
    event_type: "finality.recorded",
    aggregate_type: "match",
    reason_code: "COLLAPSE_OK",
    posture_snapshot: { verification_posture: "Standard" },
  });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "system:collapse_ok");
  assertEquals(input.metadata?.original_reason_code, "COLLAPSE_OK");
  // system:* is an approved namespace → no WARN.
  assertEquals(warn.calls.length, 0);
});

Deno.test("validateGovernanceInput — normalises INSUFFICIENT_TOKENS to credit_burn_not_allowed", () => {
  const input = baseInput({
    event_type: "credit.burn_blocked",
    aggregate_type: "credit_ledger",
    reason_code: "INSUFFICIENT_TOKENS",
    posture_snapshot: { verification_posture: "Standard" },
  });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "credit_burn_not_allowed");
  assertEquals(input.metadata?.original_reason_code, "INSUFFICIENT_TOKENS");
  assertEquals(warn.calls.length, 0);
});

Deno.test("validateGovernanceInput — normalises payment provider literals", () => {
  const input = baseInput({
    event_type: "payment.event_created",
    aggregate_type: "payment",
    reason_code: "refund.partial:manual_review",
    posture_snapshot: { verification_posture: "Manual Review Required" },
  });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "payment:refund_partial_manual_review");
  assertEquals(input.metadata?.original_reason_code, "refund.partial:manual_review");
  assertEquals(warn.calls.length, 0);
});

Deno.test("validateGovernanceInput — David-approved code passes through with no metadata stash", () => {
  const input = baseInput({
    reason_code: "missing_email",
  });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "missing_email");
  assertEquals(input.metadata, undefined);
  assertEquals(warn.calls.length, 0);
});

Deno.test("validateGovernanceInput — approved namespaced code is silent", () => {
  for (const code of [
    "api:my-endpoint",
    "action:credit_burn",
    "scope:org",
    "system:bespoke",
    "payment:something",
    "legacy:foo",
  ]) {
    const input = baseInput({ reason_code: code });
    const warn = captureWarn();
    try {
      validateGovernanceInput(input);
    } finally {
      warn.restore();
    }
    assertEquals(input.reason_code, code);
    assertEquals(warn.calls.length, 0, `expected no WARN for ${code}`);
    // Unchanged → no original_reason_code metadata stash.
    assertEquals(input.metadata, undefined);
  }
});

Deno.test("validateGovernanceInput — unknown unnamespaced code WARNs but does NOT throw", () => {
  const input = baseInput({ reason_code: "totally_made_up" });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "totally_made_up");
  assertEquals(warn.calls.length, 1);
});

Deno.test("validateGovernanceInput — unknown DISALLOWED namespace WARNs but does NOT throw", () => {
  const input = baseInput({ reason_code: "random:foo" });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "random:foo");
  assertEquals(warn.calls.length, 1);
});

Deno.test("validateGovernanceInput — null reason_code is fine and silent", () => {
  const input = baseInput({ reason_code: null });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, null);
  assertEquals(warn.calls.length, 0);
});

Deno.test("isApprovedReasonCode — combines allow-list AND approved namespaces", () => {
  assert(isApprovedReasonCode(null));
  assert(isApprovedReasonCode(undefined));
  assert(isApprovedReasonCode("client_instruction"));
  assert(isApprovedReasonCode("system:collapse_ok"));
  assert(isApprovedReasonCode("payment:charge_success"));
  assertEquals(isApprovedReasonCode("random:foo"), false);
  assertEquals(isApprovedReasonCode("totally_made_up"), false);
});

Deno.test("validateGovernanceInput — Batch B HQ-note reason codes still pass", () => {
  const input = baseInput({
    event_type: "hq.note_added",
    aggregate_type: "match",
    reason_code: "client_instruction",
    posture_snapshot: { verification_posture: "Standard" },
  });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "client_instruction");
  assertEquals(warn.calls.length, 0);
});

Deno.test("validateGovernanceInput — document-specific reason codes are NOT in the allow-list (still WARN)", () => {
  // Excluded from Batch C scope by instruction — they belong to the separate
  // AI/documentation-governance scope. Until then they should WARN, not pass.
  const input = baseInput({ reason_code: "missing_required_document" });
  const warn = captureWarn();
  try {
    validateGovernanceInput(input);
  } finally {
    warn.restore();
  }
  assertEquals(input.reason_code, "missing_required_document");
  assertEquals(warn.calls.length, 1);
});
