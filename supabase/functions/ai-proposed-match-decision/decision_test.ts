/**
 * Phase 3C targeted Deno tests for ai-proposed-match-decision.
 *
 * These tests exercise the pure validation + payload-shape helpers used by
 * the handler in index.ts. The helpers are the exact same code paths the
 * handler runs at request time, so behavioural guarantees asserted here
 * carry through to the deployed function.
 *
 * No network. No database. No "Verified" wording is introduced.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  ACTIONS,
  TERMINAL,
  CONFIDENCE,
  ESCALATION_TARGETS,
  FEEDBACK_REASONS,
  APPROVED_PRIOR_STATUSES,
  canApproveForClientView,
  canApproveForOutreach,
  isValidFeedbackReason,
  isValidEscalationTarget,
  buildApprovedPayload,
  buildOriginalPayloadSnapshot,
  shouldSnapshotOriginal,
} from "./validation.ts";

import { AI_REVIEW_AUDIT_NAMES } from "../_shared/ai-review-audit.ts";

const SAMPLE_ROW = {
  status: "approved",
  suggested_counterparty_name: "Acme Trading SA",
  counterparty_role: "buyer",
  jurisdiction: "ZA",
  sector_or_product_fit: "metals",
  capacity_indicator: "mid",
  prior_activity_summary: "active 2024",
  source_summary: "registry hit",
  match_rationale: "geographic + sector",
  fit_label: "strong_fit",
  confidence_level: "medium",
  confidence_override: null,
  original_payload: null,
  edited_payload: null,
};

// ── 1. approve_for_client_view returns 409 unless prior internal approval ──
Deno.test("approve_for_client_view requires prior internal approval", () => {
  for (
    const status of [
      "draft",
      "under_review",
      "needs_more_research",
      "escalated",
      "rejected",
      "archived",
      "expired",
      "closed",
    ]
  ) {
    assertEquals(
      canApproveForClientView(status),
      false,
      `status '${status}' must NOT be eligible for client-view approval`,
    );
  }
});

// ── 2. approve_for_client_view only after valid prior approval ──
Deno.test("approve_for_client_view accepted only after valid approval", () => {
  for (const status of ["approved", "approved_internal", "approved_client_view"]) {
    assert(
      canApproveForClientView(status),
      `status '${status}' must be eligible for client-view approval`,
    );
    assert(APPROVED_PRIOR_STATUSES.has(status));
  }
});

// ── 3. approve_for_client_view writes/populates approved_payload ──
Deno.test("buildApprovedPayload populates expected fields and stamps approval metadata", () => {
  const now = "2026-06-15T10:00:00.000Z";
  const userId = "11111111-1111-1111-1111-111111111111";
  const payload = buildApprovedPayload(SAMPLE_ROW, now, userId);
  assertEquals(payload.suggested_counterparty_name, "Acme Trading SA");
  assertEquals(payload.counterparty_role, "buyer");
  assertEquals(payload.jurisdiction, "ZA");
  assertEquals(payload.match_rationale, "geographic + sector");
  assertEquals(payload.approved_at, now);
  assertEquals(payload.approved_by, userId);
  // confidence_override (when present) must win over confidence_level.
  const withOverride = buildApprovedPayload(
    { ...SAMPLE_ROW, confidence_override: "high" },
    now,
    userId,
  );
  assertEquals(withOverride.confidence_level, "high");
});

// ── 4. edit_payload snapshots original_payload exactly once ──
Deno.test("shouldSnapshotOriginal returns true only on first edit", () => {
  assertEquals(shouldSnapshotOriginal({ original_payload: null }), true);
  assertEquals(shouldSnapshotOriginal({ original_payload: undefined }), true);
  assertEquals(
    shouldSnapshotOriginal({ original_payload: { snapshot_at: "x" } }),
    false,
  );
});

// ── 5. edit_payload updates edited_payload (shape contract) ──
Deno.test("buildOriginalPayloadSnapshot captures advisory fields + snapshot_at", () => {
  const now = "2026-06-15T10:00:00.000Z";
  const snap = buildOriginalPayloadSnapshot(SAMPLE_ROW, now);
  assertEquals(snap.suggested_counterparty_name, "Acme Trading SA");
  assertEquals(snap.confidence_level, "medium");
  assertEquals(snap.snapshot_at, now);
});

// ── 6. Invalid feedback_reason is rejected ──
Deno.test("invalid feedback_reason is rejected", () => {
  for (const bad of ["", "totally_made_up", "VERIFIED", null, undefined, 123, {}]) {
    assertEquals(isValidFeedbackReason(bad), false, `bad=${JSON.stringify(bad)}`);
  }
});

// ── 7. Valid fixed feedback_reason is accepted ──
Deno.test("valid fixed feedback_reasons are accepted", () => {
  for (const r of FEEDBACK_REASONS) {
    assertEquals(isValidFeedbackReason(r), true, `expected '${r}' valid`);
  }
  // Spot-check the contracted vocabulary.
  for (
    const r of [
      "wrong_company",
      "wrong_country",
      "wrong_product",
      "duplicate",
      "not_commercially_relevant",
      "other",
    ]
  ) {
    assert(FEEDBACK_REASONS.has(r), `missing canonical feedback_reason '${r}'`);
  }
});

// ── 8. Escalation targets verification/wad/kyb/compliance accepted ──
Deno.test("escalation targets verification/wad/kyb/compliance are accepted", () => {
  for (const t of ["verification", "wad", "kyb", "compliance"]) {
    assertEquals(isValidEscalationTarget(t), true, `'${t}' must be valid`);
    assert(ESCALATION_TARGETS.has(t));
  }
  // And the escalation audit name is canonical (i.e. audited).
  assert(
    AI_REVIEW_AUDIT_NAMES.includes("ai_review.proposed_match_escalated"),
    "ai_review.proposed_match_escalated must be in canonical audit names",
  );
});

// ── 9. Invalid escalation target is rejected ──
Deno.test("invalid escalation target is rejected", () => {
  for (const bad of ["", "anything", "legal", "ops", null, undefined, 1, {}]) {
    assertEquals(
      isValidEscalationTarget(bad),
      false,
      `bad=${JSON.stringify(bad)}`,
    );
  }
});

// ── 10. No tested branch uses "Verified" wording for AI confidence ──
Deno.test("confidence taxonomy does not include 'verified' wording", async () => {
  // The confidence set is strictly low|medium|high — never 'verified'.
  assertEquals([...CONFIDENCE].sort(), ["high", "low", "medium"]);
  for (const level of CONFIDENCE) {
    assertNotEquals(level.toLowerCase(), "verified");
  }
  // And no user-facing string in the handler labels AI output as 'verified'.
  // We scan the handler source for the token in any case form.
  const src = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  // Strip comments — the file documents that no 'verified' claim is implied.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const lower = stripped.toLowerCase();
  // No code path should produce a string containing the word 'verified'.
  assertEquals(
    /\bverified\b/.test(lower),
    false,
    "handler must not introduce 'verified' wording for AI confidence",
  );
});

// ── Sanity: ACTIONS list contains the Phase 3 additions and TERMINAL is shared ──
Deno.test("ACTIONS list contains the Phase 3 review-queue actions", () => {
  for (
    const a of [
      "set_due_date",
      "mark_duplicate",
      "mark_not_relevant",
      "set_feedback_reason",
      "request_rerun",
      "approve_for_client_view",
      "approve_for_outreach",
      "edit_payload",
    ]
  ) {
    assert(ACTIONS.includes(a as never), `ACTIONS must include '${a}'`);
  }
  assert(TERMINAL.has("approved_client_view"));
  assertStringIncludes(
    AI_REVIEW_AUDIT_NAMES.join(","),
    "ai_review.proposed_match_approved_for_client_view",
  );
});

// approve_for_outreach mirrors the same prior-approval gate.
Deno.test("approve_for_outreach gate mirrors client-view gate", () => {
  for (const status of ["approved", "approved_internal", "approved_client_view"]) {
    assert(canApproveForOutreach(status));
  }
  for (const status of ["draft", "under_review", "rejected", "archived"]) {
    assertEquals(canApproveForOutreach(status), false);
  }
});
