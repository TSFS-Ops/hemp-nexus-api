import { describe, it, expect } from "vitest";
import {
  assertTransition,
  isTransitionAllowed,
  P5TransitionError,
  type TransitionActor,
} from "@/lib/p5-governance/transitions";

const reviewer: TransitionActor = {
  roles: ["compliance_analyst"],
  type: "user",
};
const admin: TransitionActor = {
  roles: ["platform_admin"],
  type: "user",
};
const randomUser: TransitionActor = {
  roles: ["customer_entity_owner"],
  type: "user",
};
const system: TransitionActor = { roles: [], type: "system" };

describe("P-5 transition guard", () => {
  it("incomplete → submitted allowed (submit)", () => {
    expect(
      assertTransition({
        from: "incomplete",
        to: "submitted",
        action: "submit",
        actor: reviewer,
      }),
    ).toBeTruthy();
  });

  it("submitted → under_review by reviewer/system allowed", () => {
    expect(
      assertTransition({
        from: "submitted",
        to: "under_review",
        action: "assign_review",
        actor: reviewer,
      }),
    ).toBeTruthy();
    expect(
      assertTransition({
        from: "submitted",
        to: "under_review",
        action: "assign_review",
        actor: system,
      }),
    ).toBeTruthy();
  });

  it("under_review → more_information_required requires reason + note", () => {
    expect(() =>
      assertTransition({
        from: "under_review",
        to: "more_information_required",
        action: "request_more_information",
        actor: reviewer,
      }),
    ).toThrow(/reason code/i);
    expect(() =>
      assertTransition({
        from: "under_review",
        to: "more_information_required",
        action: "request_more_information",
        actor: reviewer,
        reasonCode: "manual_review_required",
      }),
    ).toThrow(/note/i);
    expect(
      assertTransition({
        from: "under_review",
        to: "more_information_required",
        action: "request_more_information",
        actor: reviewer,
        reasonCode: "manual_review_required",
        note: "please attach UBO docs",
      }),
    ).toBeTruthy();
  });

  it("under_review → internally_ready requires reviewer role", () => {
    expect(() =>
      assertTransition({
        from: "under_review",
        to: "internally_ready",
        action: "approve_internal",
        actor: randomUser,
      }),
    ).toThrow(/role/i);
    expect(
      assertTransition({
        from: "under_review",
        to: "internally_ready",
        action: "approve_internal",
        actor: reviewer,
      }),
    ).toBeTruthy();
  });

  it("internally_ready → ready_to_proceed requires admin", () => {
    expect(() =>
      assertTransition({
        from: "internally_ready",
        to: "ready_to_proceed",
        action: "approve_ready_to_proceed",
        actor: reviewer,
      }),
    ).toThrow();
    expect(
      assertTransition({
        from: "internally_ready",
        to: "ready_to_proceed",
        action: "approve_ready_to_proceed",
        actor: admin,
      }),
    ).toBeTruthy();
  });

  it("internally_ready → provider_dependent allowed", () => {
    expect(
      assertTransition({
        from: "internally_ready",
        to: "provider_dependent",
        action: "mark_provider_dependent",
        actor: reviewer,
      }),
    ).toBeTruthy();
  });

  it("on_hold → under_review (release_hold) requires reason + note", () => {
    expect(() =>
      assertTransition({
        from: "on_hold",
        to: "under_review",
        action: "release_hold",
        actor: reviewer,
      }),
    ).toThrow(/reason/i);
    expect(
      assertTransition({
        from: "on_hold",
        to: "under_review",
        action: "release_hold",
        actor: reviewer,
        reasonCode: "compliance_hold_released",
        note: "evidence received and validated",
      }),
    ).toBeTruthy();
  });

  it("apply_hold requires reason+note", () => {
    expect(() =>
      assertTransition({
        from: "under_review",
        to: "on_hold",
        action: "apply_hold",
        actor: reviewer,
      }),
    ).toThrow(/reason/i);
    expect(
      assertTransition({
        from: "under_review",
        to: "on_hold",
        action: "apply_hold",
        actor: reviewer,
        reasonCode: "compliance_hold_applied",
        note: "adverse media review",
      }),
    ).toBeTruthy();
  });

  it("rejected → reopened requires admin + reason + note", () => {
    expect(() =>
      assertTransition({
        from: "rejected",
        to: "reopened",
        action: "reopen",
        actor: reviewer,
      }),
    ).toThrow();
    expect(
      assertTransition({
        from: "rejected",
        to: "reopened",
        action: "reopen",
        actor: admin,
      }),
    ).toBeTruthy();
  });

  it("ready_to_proceed → reopened allowed by admin", () => {
    expect(
      assertTransition({
        from: "ready_to_proceed",
        to: "reopened",
        action: "reopen",
        actor: admin,
      }),
    ).toBeTruthy();
  });

  it("waive/override require reason + note and admin", () => {
    expect(() =>
      assertTransition({
        from: "internally_ready",
        to: "waived",
        action: "waive",
        actor: reviewer,
        reasonCode: "waiver_granted",
        note: "approved by exec",
      }),
    ).toThrow(/role/i);
    expect(
      assertTransition({
        from: "internally_ready",
        to: "waived",
        action: "waive",
        actor: admin,
        reasonCode: "waiver_granted",
        note: "approved by exec",
      }),
    ).toBeTruthy();
    expect(
      assertTransition({
        from: "blocked",
        to: "override_approved",
        action: "override",
        actor: admin,
        reasonCode: "override_approved",
        note: "exec override after risk review",
      }),
    ).toBeTruthy();
  });

  it("escalate requires reason + note", () => {
    expect(() =>
      assertTransition({
        from: "under_review",
        to: "escalated",
        action: "escalate",
        actor: reviewer,
      }),
    ).toThrow(/reason/i);
    expect(
      assertTransition({
        from: "under_review",
        to: "escalated",
        action: "escalate",
        actor: reviewer,
        reasonCode: "high_risk_escalation",
        note: "sanctions hit pending dual review",
      }),
    ).toBeTruthy();
  });

  it("illegal transitions throw", () => {
    expect(() =>
      assertTransition({
        from: "incomplete",
        to: "ready_to_proceed",
        action: "approve_ready_to_proceed",
        actor: admin,
      }),
    ).toThrow(P5TransitionError);
    expect(() =>
      assertTransition({
        from: "rejected",
        to: "ready_to_proceed",
        action: "approve_ready_to_proceed",
        actor: admin,
      }),
    ).toThrow(/illegal/i);
    expect(() =>
      assertTransition({
        from: "ready_to_proceed",
        to: "ready_to_proceed",
        action: "approve_ready_to_proceed",
        actor: admin,
      }),
    ).toThrow(/no-op/i);
  });

  it("isTransitionAllowed mirrors the table without throwing", () => {
    expect(
      isTransitionAllowed("submitted", "under_review", "assign_review"),
    ).toBe(true);
    expect(
      isTransitionAllowed("incomplete", "ready_to_proceed", "approve_ready_to_proceed"),
    ).toBe(false);
  });
});
