/**
 * match-ai-summary-action — pure-validation tests.
 *
 * We don't stand up the full Supabase stack here; we re-declare the
 * minimal action/audit/task-kind tables and assert the contract that
 * Phase 4 depends on:
 *
 *   • only three external actions are allowed;
 *   • each action maps to a canonical `ai_review.client_summary_*`
 *     audit name;
 *   • each action maps to an internal `ai_intel_tasks.kind` from the
 *     CHECK list (review_ai_result | widen_search_criteria |
 *     notify_originator).
 *
 * The runtime function MUST keep these mappings in sync.
 */
import {
  assertEquals,
  assertArrayIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AI_REVIEW_AUDIT_NAMES } from "../_shared/ai-review-audit.ts";

const ACTIONS = ["flag_incorrect", "request_more_intel", "ask_izenzo_to_proceed"] as const;

const AUDIT_BY_ACTION = {
  flag_incorrect: "ai_review.client_summary_flagged_incorrect",
  request_more_intel: "ai_review.client_summary_requested_more_intel",
  ask_izenzo_to_proceed: "ai_review.client_summary_asked_to_proceed",
} as const;

const TASK_KIND_BY_ACTION = {
  flag_incorrect: "review_ai_result",
  request_more_intel: "widen_search_criteria",
  ask_izenzo_to_proceed: "notify_originator",
} as const;

// The kinds that ai_intel_tasks.kind CHECK accepts (mirrored from the
// Phase 1 migration). Keep in sync if that CHECK ever changes.
const ALLOWED_TASK_KINDS = new Set([
  "review_ai_result",
  "approve_shortlist",
  "approve_outreach",
  "send_outreach",
  "follow_up",
  "mark_response",
  "escalate_interested",
  "escalate_to_verification",
  "widen_search_criteria",
  "verify_basic_details",
  "invite_counterparty",
  "link_to_match",
  "notify_originator",
  "provider_failure_review",
  "other",
]);

Deno.test("Phase 4: exactly three external actions are allowed", () => {
  assertEquals(ACTIONS.length, 3);
  assertArrayIncludes(
    [...ACTIONS],
    ["flag_incorrect", "request_more_intel", "ask_izenzo_to_proceed"],
  );
});

Deno.test("Phase 4: each external action maps to a canonical client_summary audit name", () => {
  for (const a of ACTIONS) {
    const name = AUDIT_BY_ACTION[a];
    assertEquals(
      AI_REVIEW_AUDIT_NAMES.includes(name as never),
      true,
      `audit name not in SSOT: ${name}`,
    );
    const prefix = ["ai_review", "client_summary_"].join(".");
    assertEquals(
      name.startsWith(prefix),
      true,
      `audit name not in client_summary namespace: ${name}`,
    );
  }
});

Deno.test("Phase 4: each external action maps to an allowed ai_intel_tasks.kind", () => {
  for (const a of ACTIONS) {
    const kind = TASK_KIND_BY_ACTION[a];
    assertEquals(
      ALLOWED_TASK_KINDS.has(kind),
      true,
      `task kind '${kind}' not in ai_intel_tasks.kind CHECK list`,
    );
  }
});

Deno.test("Phase 4: external actions do NOT include outreach / POI / match / verification transitions", () => {
  const forbiddenSubstrings = [
    "outreach",
    "poi",
    "match_state",
    "kyb",
    "wad",
    "verified",
    "approve",
    "reject",
    "send",
  ];
  for (const a of ACTIONS) {
    for (const f of forbiddenSubstrings) {
      // We allow the audit name to contain "summary" — but never the
      // forbidden state-mutation verbs.
      assertEquals(
        a.includes(f),
        false,
        `external action name '${a}' suggests forbidden state mutation '${f}'`,
      );
    }
  }
});
