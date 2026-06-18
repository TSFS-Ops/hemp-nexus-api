/**
 * Batch 9B — Positive-response next-step tasks (SSOT + invariant tests).
 *
 * These tests pin server/browser SSOTs and the contracts that the
 * facilitation-case-admin-action edge function relies on. Behavioural
 * server tests run separately as part of the facilitation UAT.
 */
import { describe, it, expect } from "vitest";
import {
  NEXT_STEP_TYPES,
  NEXT_STEP_STATUSES,
  POSITIVE_RESPONSE_REQUIRED_ACTIONS,
  POSITIVE_CONTACT_RESULTS,
  NEXT_STEP_STATUS_LABELS,
  FACILITATION_AUDIT_NAMES,
  OUTCOMES,
} from "@/lib/facilitation-case-state";

describe("Batch 9B — next-step task SSOT", () => {
  it("defines the canonical next-step type and status enum", () => {
    expect(NEXT_STEP_TYPES).toEqual(["positive_response_followup"]);
    expect([...NEXT_STEP_STATUSES].sort()).toEqual(
      ["cancelled", "completed", "in_progress", "open"].sort(),
    );
  });

  it("required-actions checklist covers every master-spec item", () => {
    const joined = POSITIVE_RESPONSE_REQUIRED_ACTIONS.join(" | ").toLowerCase();
    for (const fragment of [
      "verify basic counterparty details",
      "create or update the counterparty organisation",
      "invite the counterparty",
      "link the counterparty",
      "notify the requester",
      "next poi-related step",
    ]) {
      expect(joined).toContain(fragment);
    }
    expect(POSITIVE_RESPONSE_REQUIRED_ACTIONS.length).toBeGreaterThanOrEqual(6);
  });

  it("only 'reached_counterparty' counts as a positive contact-attempt signal", () => {
    expect(POSITIVE_CONTACT_RESULTS).toEqual(["reached_counterparty"]);
    // Negative results must not appear in the positive list.
    for (const negative of [
      "no_answer",
      "left_message",
      "wrong_contact",
      "declined",
      "requested_more_information",
      "other",
    ]) {
      expect((POSITIVE_CONTACT_RESULTS as readonly string[]).includes(negative)).toBe(false);
    }
  });

  it("registers all next-step audit names in the canonical list", () => {
    for (const name of [
      "facilitation_case.positive_response_recorded",
      "facilitation_case.next_step_created",
      "facilitation_case.next_step_assigned",
      "facilitation_case.next_step_status_changed",
      "facilitation_case.next_step_completed",
    ]) {
      expect((FACILITATION_AUDIT_NAMES as readonly string[]).includes(name)).toBe(true);
    }
  });

  it("status labels exist for every next-step status", () => {
    for (const s of NEXT_STEP_STATUSES) {
      expect(NEXT_STEP_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("Batch 9A closure vocabulary is unchanged by Batch 9B", () => {
    // Sanity: the three Batch 9A aliases remain in OUTCOMES so 9A tests stay green.
    for (const o of ["no_response", "invalid_details", "closed_by_admin"]) {
      expect((OUTCOMES as readonly string[]).includes(o)).toBe(true);
    }
  });
});
