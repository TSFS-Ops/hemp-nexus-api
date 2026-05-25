/**
 * Batch D — Governance waiver/bypass taxonomy + policy-version tests.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVED_REASON_CODES,
  CONTROLLED_TAXONOMY,
  EVENT_FAMILIES,
  isApprovedReasonCode,
  isCriticalEvent,
  POSTURE_LABELS,
  validateGovernanceInput,
} from "./governance-audit.ts";
import {
  GOVERNANCE_WAIVER_POLICY_VERSION,
  POLICY_VERSION_BY_EVENT_TYPE,
} from "./governance-policy-versions.ts";

const ALL = [
  "governance.waiver_granted",
  "governance.waiver_renewed",
  "governance.waiver_consumed",
  "governance.waiver_expired",
  "governance.bypass_granted",
  "governance.bypass_renewed",
  "governance.bypass_consumed",
  "governance.bypass_expired",
] as const;

Deno.test("Batch D: governance family registered", () => {
  assert((EVENT_FAMILIES as readonly string[]).includes("governance"));
});

Deno.test("Batch D: all 8 waiver/bypass events in controlled taxonomy", () => {
  for (const ev of ALL) assert(CONTROLLED_TAXONOMY.has(ev), `missing: ${ev}`);
});

Deno.test("Batch D: all 8 waiver/bypass events are fail-closed (critical)", () => {
  for (const ev of ALL) assert(isCriticalEvent(ev), `not critical: ${ev}`);
});

Deno.test("Batch D: policy version stamped for every waiver event", () => {
  for (const ev of ALL) {
    assertEquals(POLICY_VERSION_BY_EVENT_TYPE[ev], GOVERNANCE_WAIVER_POLICY_VERSION);
  }
});

Deno.test("Batch D: posture labels Waiver/Bypass Applied still controlled", () => {
  assert(POSTURE_LABELS.has("Waiver Applied"));
  assert(POSTURE_LABELS.has("Bypass Applied"));
});

Deno.test("Batch D: new waiver reason codes approved", () => {
  for (const r of [
    "waiver_missing",
    "waiver_expired",
    "waiver_consumed",
    "waiver_revoked",
    "waiver_renewed",
    "bypass_granted_for_record",
    "waiver_granted_for_record",
  ]) {
    assert(APPROVED_REASON_CODES.has(r), `not approved: ${r}`);
    assert(isApprovedReasonCode(r));
  }
});

Deno.test("Batch D: critical waiver event requires posture_snapshot", () => {
  let threw = false;
  try {
    validateGovernanceInput({
      event_type: "governance.waiver_granted",
      org_id: "00000000-0000-0000-0000-000000000001",
      aggregate_type: "match",
      aggregate_id: "00000000-0000-0000-0000-000000000002",
      actor_user_id: "00000000-0000-0000-0000-000000000003",
      source_function: "test",
    });
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("GOV_AUDIT_POSTURE_REQUIRED"));
  }
  assert(threw, "expected posture-required throw");
});

Deno.test("Batch D: critical waiver event with valid posture passes validation", () => {
  validateGovernanceInput({
    event_type: "governance.bypass_granted",
    org_id: "00000000-0000-0000-0000-000000000001",
    aggregate_type: "match",
    aggregate_id: "00000000-0000-0000-0000-000000000002",
    actor_user_id: "00000000-0000-0000-0000-000000000003",
    source_function: "test",
    reason_code: "client_instruction",
    posture_snapshot: {
      verification_posture: "Bypass Applied",
      policy_version: GOVERNANCE_WAIVER_POLICY_VERSION,
      bypass_applied: true,
    },
  });
});
