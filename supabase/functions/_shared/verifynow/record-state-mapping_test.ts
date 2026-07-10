/**
 * Regression tests for `mapInternalStatusToRecordState`.
 *
 * These tests enforce the boundary between VerifyNow/internal workflow
 * statuses and the DB-persisted `p5scr_idv_records.state` enum guarded by the
 * check constraint `p5scr_idv_records_state_check`.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_IDV_RECORD_STATES,
  isAllowedIdvRecordState,
  mapInternalStatusToRecordState,
} from "./record-state-mapping.ts";
import {
  IDV_OUTCOME_MAP,
  type InternalIdvStatus,
  resolveVerifyNowOutcome,
} from "./result-mapping.ts";

// Mirror of the DB check constraint. Update this list ONLY when a migration
// changes `p5scr_idv_records_state_check`.
const DB_ALLOWED_STATES = [
  "idv_pending",
  "provider_pending",
  "manual_review_required",
  "cleared",
  "cleared_with_conditions",
  "failed",
  "rejected",
  "screening_expired",
] as const;

const ALL_INTERNAL_STATUSES: InternalIdvStatus[] = [
  "idv_completed",
  "manual_review_required",
  "retry_required",
  "alternative_document_required",
  "provider_pending",
  "provider_error",
  "provider_not_available",
  "blocked_pending_admin_decision",
  "pending",
  "failed",
  "expired",
  "unsupported",
  "error",
];

Deno.test("allowed record states match the DB check constraint list", () => {
  assertEquals([...ALLOWED_IDV_RECORD_STATES], [...DB_ALLOWED_STATES]);
});

Deno.test("every InternalIdvStatus maps to a DB-allowed state", () => {
  for (const s of ALL_INTERNAL_STATUSES) {
    const mapped = mapInternalStatusToRecordState(s);
    assert(
      isAllowedIdvRecordState(mapped),
      `InternalIdvStatus "${s}" mapped to disallowed state "${mapped}"`,
    );
  }
});

Deno.test("every raw VerifyNow outcome, after resolution, maps to a DB-allowed state", () => {
  const rawOutcomes = Object.keys(IDV_OUTCOME_MAP) as (keyof typeof IDV_OUTCOME_MAP)[];
  for (const raw of rawOutcomes) {
    for (const route_can_unlock of [true, false]) {
      const resolved = resolveVerifyNowOutcome({ raw_outcome: raw, route_can_unlock });
      const state = mapInternalStatusToRecordState(resolved.internal_status);
      assert(
        isAllowedIdvRecordState(state),
        `raw=${raw} route_can_unlock=${route_can_unlock} -> ${resolved.internal_status} -> ${state}`,
      );
    }
  }
});

Deno.test("workflow-only statuses are NOT accepted as record states directly", () => {
  const workflowOnly: InternalIdvStatus[] = [
    "idv_completed",
    "retry_required",
    "alternative_document_required",
    "provider_error",
    "provider_not_available",
    "blocked_pending_admin_decision",
    "pending",
    "expired",
    "unsupported",
    "error",
  ];
  for (const s of workflowOnly) {
    assert(
      !isAllowedIdvRecordState(s),
      `workflow-only status "${s}" must not be a valid record state`,
    );
  }
});

Deno.test("unknown / unsupported / error map to manual_review_required, never cleared", () => {
  assertEquals(mapInternalStatusToRecordState("unsupported"), "manual_review_required");
  assertEquals(mapInternalStatusToRecordState("error"), "manual_review_required");
  assertEquals(mapInternalStatusToRecordState("provider_error"), "manual_review_required");
  assertEquals(mapInternalStatusToRecordState(undefined), "manual_review_required");
  assertEquals(mapInternalStatusToRecordState(null), "manual_review_required");
  assertEquals(
    mapInternalStatusToRecordState("something-brand-new"),
    "manual_review_required",
  );
});

Deno.test("idv_completed maps to cleared", () => {
  assertEquals(mapInternalStatusToRecordState("idv_completed"), "cleared");
});

Deno.test("supporting-only clear_match remains manual_review_required (never cleared)", () => {
  const resolved = resolveVerifyNowOutcome({
    raw_outcome: "clear_match",
    route_can_unlock: false,
  });
  assertEquals(resolved.internal_status, "manual_review_required");
  assertEquals(resolved.unlocks_controlled_actions, false);
  const state = mapInternalStatusToRecordState(resolved.internal_status);
  assertEquals(state, "manual_review_required");
});

Deno.test("controlled-action clear_match maps to cleared", () => {
  const resolved = resolveVerifyNowOutcome({
    raw_outcome: "clear_match",
    route_can_unlock: true,
  });
  assertEquals(resolved.internal_status, "idv_completed");
  assertEquals(mapInternalStatusToRecordState(resolved.internal_status), "cleared");
});

Deno.test("blocked_pending_admin_decision maps to rejected", () => {
  assertEquals(
    mapInternalStatusToRecordState("blocked_pending_admin_decision"),
    "rejected",
  );
  for (const raw of ["blocked_id", "deceased", "suspected_fraud"] as const) {
    const resolved = resolveVerifyNowOutcome({ raw_outcome: raw, route_can_unlock: true });
    assertEquals(mapInternalStatusToRecordState(resolved.internal_status), "rejected");
  }
});

Deno.test("failed and expired retain their identity mappings", () => {
  assertEquals(mapInternalStatusToRecordState("failed"), "failed");
  assertEquals(mapInternalStatusToRecordState("expired"), "screening_expired");
});
