/**
 * Batch 9C — Requester-facing in-app notifications.
 *
 * SSOT-only specs covering:
 *  - the four approved safe milestones map to internal statuses,
 *  - other internal statuses do NOT have a requester notification trigger,
 *  - notification wording contains no forbidden internal/sensitive terms,
 *  - canonical audit name `facilitation_case.requester_notification_emitted`
 *    is registered in the FACILITATION_AUDIT_NAMES SSOT.
 *
 * These specs are pure SSOT assertions — they never call the network and
 * therefore stay green in any CI environment. The edge-function wiring is
 * exercised via integration UAT (Section 2 of the master UAT pack).
 */
import { describe, it, expect } from "vitest";
import {
  REQUESTER_SAFE_NOTIFICATION_TRIGGERS,
  REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS,
  getRequesterSafeNotification,
  assertRequesterSafeNotification,
  FACILITATION_AUDIT_NAMES,
  INTERNAL_STATUSES,
} from "@/lib/facilitation-case-state";

describe("Batch 9C — requester-safe notification SSOT", () => {
  it("exposes exactly the four approved safe milestones", () => {
    const keys = Object.keys(REQUESTER_SAFE_NOTIFICATION_TRIGGERS).sort();
    expect(keys).toEqual(
      [
        "closed",
        "counterparty_responded",
        "ready_for_known_counterparty_poi",
        "unable_to_proceed",
      ].sort(),
    );
  });

  it("returns a trigger for each approved internal status", () => {
    for (const s of [
      "counterparty_responded",
      "ready_for_known_counterparty_poi",
      "unable_to_proceed",
      "closed",
    ]) {
      const t = getRequesterSafeNotification(s);
      expect(t).not.toBeNull();
      expect(t?.title.length).toBeGreaterThan(0);
      expect(t?.body.length).toBeGreaterThan(0);
      expect(t?.type.startsWith("facilitation_case.requester.")).toBe(true);
    }
  });

  it("does NOT emit a requester notification for non-approved statuses", () => {
    const approved = new Set(Object.keys(REQUESTER_SAFE_NOTIFICATION_TRIGGERS));
    for (const s of INTERNAL_STATUSES) {
      if (approved.has(s)) continue;
      expect(getRequesterSafeNotification(s)).toBeNull();
    }
  });

  it("each notification passes the forbidden-substring safety check", () => {
    for (const t of Object.values(REQUESTER_SAFE_NOTIFICATION_TRIGGERS)) {
      expect(() => assertRequesterSafeNotification(t)).not.toThrow();
    }
  });

  it("forbidden substrings include the operator/SLA/compliance vocabulary", () => {
    const required = [
      "sla", "breach", "overdue",
      "compliance", "sanction", "pep",
      "owner", "assignee", "escalat",
      "audit", "evidence pack",
    ];
    for (const term of required) {
      expect(REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS).toContain(term);
    }
  });

  it("rejects a notification whose body leaks an internal term", () => {
    expect(() =>
      assertRequesterSafeNotification({
        key: "x",
        type: "facilitation_case.requester.x",
        title: "ok",
        body: "Compliance review is pending.",
      }),
    ).toThrow(/forbidden term/);
  });

  it("registers the canonical audit name", () => {
    expect(FACILITATION_AUDIT_NAMES).toContain(
      "facilitation_case.requester_notification_emitted",
    );
  });

  it("notification type strings are unique", () => {
    const types = Object.values(REQUESTER_SAFE_NOTIFICATION_TRIGGERS).map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
