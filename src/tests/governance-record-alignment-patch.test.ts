/**
 * governance-record-alignment-patch.test.ts
 *
 * Covers the Governance Record client-instruction alignment patch:
 *   • controlled reason-code allow-list (WARN-only mirror on the client)
 *   • UI-side 5-minute repeated-event grouping
 *   • deterministic non-AI "full story" summary
 *   • HQ filter logic (actor type, event type, allowed/blocked, posture,
 *     demo/live)
 *
 * Document-specific scope is intentionally excluded.
 */

import { describe, it, expect } from "vitest";
import {
  APPROVED_REASON_CODES,
  buildFullStorySummary,
  groupRepeatedEvents,
  GovernanceEvent,
} from "@/lib/governance/governance-record";
import { applyEventFilters } from "@/components/admin/governance/GovernanceRecordDetail";

function ev(over: Partial<GovernanceEvent> = {}): GovernanceEvent {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    source: "event_store",
    sourceRowId: "row",
    action: "poi.state_changed",
    category: "poi",
    occurredAt: "2026-05-25T10:00:00.000Z",
    status: "allowed",
    reasonCode: null,
    actorType: "User",
    actorId: "user-1",
    posture: "Standard",
    isDemo: false,
    links: {
      matchId: "match-1",
      poiId: null,
      engagementId: null,
      wadId: null,
      paymentReference: null,
      orgId: "org-1",
      entityType: "match",
      entityId: "match-1",
    },
    safeMetadata: {},
    prevState: null,
    newState: null,
    ...over,
  };
}

describe("APPROVED_REASON_CODES (client mirror)", () => {
  it("includes David's non-document reason codes", () => {
    for (const code of [
      "missing_email",
      "binding_review_required",
      "dispute_active",
      "wad_not_passed",
      "stale_verification",
      "mfa_required",
      "payment_unsettled",
      "credit_burn_not_allowed",
      "legal_hold_active",
      "client_instruction",
      "manual_verification_completed",
      "system_recovery",
      "other",
    ]) {
      expect(APPROVED_REASON_CODES.has(code)).toBe(true);
    }
  });

  it("excludes document-specific reason codes (separate AI/doc scope)", () => {
    for (const code of [
      "missing_required_document",
      "document_expired",
      "document_rejected",
      "document_review_completed",
    ]) {
      expect(APPROVED_REASON_CODES.has(code)).toBe(false);
    }
  });
});

describe("groupRepeatedEvents (5-minute window)", () => {
  it("collapses identical events within 5 minutes into one row", () => {
    const events = [
      ev({ id: "a", occurredAt: "2026-05-25T10:04:00.000Z" }),
      ev({ id: "b", occurredAt: "2026-05-25T10:02:00.000Z" }),
      ev({ id: "c", occurredAt: "2026-05-25T10:00:00.000Z" }),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].repeatedCount).toBe(3);
    expect(grouped[0].members.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks the group when the gap exceeds 5 minutes", () => {
    const events = [
      ev({ id: "a", occurredAt: "2026-05-25T10:10:00.000Z" }),
      ev({ id: "b", occurredAt: "2026-05-25T10:00:00.000Z" }),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].repeatedCount).toBe(1);
    expect(grouped[1].repeatedCount).toBe(1);
  });

  it("breaks the group on a different reason code", () => {
    const events = [
      ev({ id: "a", reasonCode: "dispute_active" }),
      ev({ id: "b", reasonCode: "wad_not_passed" }),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(2);
  });

  it("breaks the group on a different actor", () => {
    const events = [
      ev({ id: "a", actorId: "user-1" }),
      ev({ id: "b", actorId: "user-2" }),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(2);
  });

  it("breaks the group on a different status (allowed vs blocked)", () => {
    const events = [
      ev({ id: "a", status: "blocked" }),
      ev({ id: "b", status: "allowed" }),
    ];
    const grouped = groupRepeatedEvents(events);
    expect(grouped).toHaveLength(2);
  });
});

describe("buildFullStorySummary (§38 deterministic)", () => {
  it("renders David's sentence shape with values present", () => {
    const s = buildFullStorySummary({
      recordStatus: "open",
      poiStatus: "ELIGIBLE",
      wadStatus: "passed",
      executionStatus: "permitted",
      executionReason: "all gates satisfied",
      lastEvent: { action: "poi.state_changed", occurredAt: "2026-05-25T09:00:00.000Z" },
    });
    expect(s).toBe(
      "This record is currently open. POI is ELIGIBLE. WaD is passed. Execution is permitted because all gates satisfied. Last material event was poi.state_changed on 2026-05-25.",
    );
  });

  it("falls back to 'not recorded' for missing fields and never uses AI language", () => {
    const s = buildFullStorySummary({});
    expect(s).toContain("not recorded");
    expect(s).not.toMatch(/likely|probably|may have|appears to|suggests/i);
    expect(s).not.toContain("document"); // documentation status excluded
  });
});

describe("applyEventFilters", () => {
  const base: GovernanceEvent[] = [
    ev({ id: "1", actorType: "HQ Admin", action: "admin.hq_decision_recorded", category: "hq_decision", status: "allowed", posture: "Standard", isDemo: false }),
    ev({ id: "2", actorType: "System", action: "poi.blocked", category: "poi", status: "blocked", posture: "Failed Verification", isDemo: false, reasonCode: "missing_email" }),
    ev({ id: "3", actorType: "Provider", action: "wad.check_failed", category: "wad", status: "manual_review", posture: "Manual Review Required", isDemo: true }),
    ev({ id: "4", actorType: "System", action: "credit.burned", category: "credit", status: "allowed", posture: "Standard", isDemo: false }),
  ];
  const F = {
    actorType: "__any__",
    orgId: "",
    family: "__any__",
    eventType: "",
    poiId: "",
    engagementId: "",
    wadId: "",
    paymentRef: "",
    allowedBlocked: "__any__",
    posture: "__any__",
    riskFlag: "__any__",
    demoLive: "__any__",
  };

  it("filters by actor type", () => {
    const out = applyEventFilters(base, { ...F, actorType: "System" });
    expect(out.map((e) => e.id).sort()).toEqual(["2", "4"]);
  });

  it("filters by exact event type substring", () => {
    const out = applyEventFilters(base, { ...F, eventType: "wad." });
    expect(out.map((e) => e.id)).toEqual(["3"]);
  });

  it("filters by allowed/blocked", () => {
    const out = applyEventFilters(base, { ...F, allowedBlocked: "blocked" });
    expect(out.map((e) => e.id)).toEqual(["2"]);
  });

  it("filters by posture", () => {
    const out = applyEventFilters(base, { ...F, posture: "Failed Verification" });
    expect(out.map((e) => e.id)).toEqual(["2"]);
  });

  it("filters by demo/live", () => {
    expect(applyEventFilters(base, { ...F, demoLive: "demo" }).map((e) => e.id)).toEqual(["3"]);
    expect(applyEventFilters(base, { ...F, demoLive: "live" }).map((e) => e.id).sort()).toEqual(["1", "2", "4"]);
  });

  it("filters by risk-only (blocked + manual_review)", () => {
    const out = applyEventFilters(base, { ...F, riskFlag: "risk_only" });
    expect(out.map((e) => e.id).sort()).toEqual(["2", "3"]);
  });
});
