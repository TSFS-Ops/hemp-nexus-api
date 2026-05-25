/**
 * governance-record-batch-b.test.ts
 *
 * Batch B logic tests — manual HQ notes + correction events.
 *
 * Covers:
 *   - annotateCorrections marks the original event with `correctedBy`
 *   - original + correction events both remain in the list
 *   - repeated-event grouping does not swallow correction events
 *   - hq.note_added maps to hq_note category
 *   - hq.event_corrected maps to hq_correction category
 *   - approved HQ note reason codes mirror the backend allow-list
 */

import { describe, it, expect } from "vitest";
import {
  annotateCorrections,
  APPROVED_REASON_CODES,
  categoriseAction,
  GovernanceEvent,
  groupRepeatedEvents,
  HQ_CORRECTED_BADGE_COPY,
  HQ_NOTE_REASON_CODES,
} from "@/lib/governance/governance-record";

function ev(over: Partial<GovernanceEvent> = {}): GovernanceEvent {
  return {
    id: over.id ?? `e-${Math.random().toString(36).slice(2)}`,
    source: "event_store",
    sourceRowId: over.sourceRowId ?? "src-row",
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

describe("categoriseAction — HQ note/correction taxonomy", () => {
  it("hq.note_added maps to hq_note category", () => {
    expect(categoriseAction("hq.note_added")).toBe("hq_note");
  });

  it("hq.event_corrected maps to hq_correction category", () => {
    expect(categoriseAction("hq.event_corrected")).toBe("hq_correction");
  });

  it("does not fall back to sensitive_admin/hq_decision", () => {
    expect(categoriseAction("hq.note_added")).not.toBe("hq_decision");
    expect(categoriseAction("hq.event_corrected")).not.toBe("sensitive_admin");
  });
});

describe("annotateCorrections", () => {
  const ORIGINAL = ev({
    id: "event_store:original",
    sourceRowId: "original-event-id",
    action: "poi.state_changed",
    category: "poi",
    occurredAt: "2026-05-25T09:00:00.000Z",
  });

  const CORRECTION = ev({
    id: "event_store:correction",
    sourceRowId: "correction-event-id",
    action: "hq.event_corrected",
    category: "hq_correction",
    occurredAt: "2026-05-25T10:30:00.000Z",
    actorId: "admin-1",
    reasonCode: "incorrect_data_correction",
    safeMetadata: {
      corrects_event_id: "original-event-id",
      note: "Data corrected per ops request.",
    },
  });

  it("attaches correctedBy to the original event", () => {
    const out = annotateCorrections([CORRECTION, ORIGINAL]);
    const orig = out.find((e) => e.sourceRowId === "original-event-id");
    expect(orig?.correctedBy).toBeTruthy();
    expect(orig?.correctedBy?.eventId).toBe("correction-event-id");
    expect(orig?.correctedBy?.reasonCode).toBe("incorrect_data_correction");
    expect(orig?.correctedBy?.actorId).toBe("admin-1");
  });

  it("keeps the original event in the list", () => {
    const out = annotateCorrections([CORRECTION, ORIGINAL]);
    expect(out.find((e) => e.sourceRowId === "original-event-id")).toBeTruthy();
  });

  it("keeps the correction event in the list as a separate row", () => {
    const out = annotateCorrections([CORRECTION, ORIGINAL]);
    expect(out.find((e) => e.action === "hq.event_corrected")).toBeTruthy();
  });

  it("does not mutate the input array", () => {
    const input = [CORRECTION, ORIGINAL];
    const before = input.map((e) => e.correctedBy ?? null);
    annotateCorrections(input);
    const after = input.map((e) => e.correctedBy ?? null);
    expect(after).toEqual(before);
  });

  it("ignores corrections whose target id is not in the list", () => {
    const orphan = ev({
      ...CORRECTION,
      sourceRowId: "orphan",
      safeMetadata: { corrects_event_id: "not-in-list" },
    });
    const out = annotateCorrections([orphan, ORIGINAL]);
    const orig = out.find((e) => e.sourceRowId === "original-event-id");
    expect(orig?.correctedBy).toBeFalsy();
  });

  it("the badge copy constant is the expected wording", () => {
    expect(HQ_CORRECTED_BADGE_COPY).toBe("Corrected by later HQ note");
  });
});

describe("groupRepeatedEvents + corrections", () => {
  it("does not collapse a correction with the event it corrects", () => {
    const original = ev({
      id: "o",
      sourceRowId: "orig",
      action: "poi.state_changed",
      occurredAt: "2026-05-25T09:00:00.000Z",
    });
    const correction = ev({
      id: "c",
      sourceRowId: "corr",
      action: "hq.event_corrected",
      category: "hq_correction",
      occurredAt: "2026-05-25T09:01:00.000Z",
      safeMetadata: { corrects_event_id: "orig" },
    });
    const annotated = annotateCorrections([correction, original]);
    const grouped = groupRepeatedEvents(annotated);
    // Two distinct rows — different `action` values cannot share a group.
    expect(grouped).toHaveLength(2);
    expect(grouped.some((g) => g.action === "hq.event_corrected")).toBe(true);
    expect(grouped.some((g) => g.action === "poi.state_changed")).toBe(true);
  });

  it("two corrections at the same time do not fold the original away", () => {
    const original = ev({
      id: "o",
      sourceRowId: "orig",
      occurredAt: "2026-05-25T09:00:00.000Z",
    });
    const c1 = ev({
      id: "c1",
      sourceRowId: "corr-1",
      action: "hq.event_corrected",
      category: "hq_correction",
      occurredAt: "2026-05-25T09:02:00.000Z",
      safeMetadata: { corrects_event_id: "orig" },
    });
    const c2 = ev({
      id: "c2",
      sourceRowId: "corr-2",
      action: "hq.event_corrected",
      category: "hq_correction",
      occurredAt: "2026-05-25T09:01:00.000Z",
      safeMetadata: { corrects_event_id: "orig" },
    });
    const annotated = annotateCorrections([c1, c2, original]);
    expect(annotated.find((e) => e.sourceRowId === "orig")).toBeTruthy();
    expect(annotated.filter((e) => e.action === "hq.event_corrected")).toHaveLength(2);
  });
});

describe("HQ note reason codes (client mirror)", () => {
  it("includes the six allowed reason codes only", () => {
    expect([...HQ_NOTE_REASON_CODES].sort()).toEqual(
      [
        "client_instruction",
        "dispute_reviewed",
        "incorrect_data_correction",
        "manual_verification_completed",
        "other",
        "system_recovery",
      ].sort(),
    );
  });

  it("every HQ note reason code is also in APPROVED_REASON_CODES", () => {
    for (const code of HQ_NOTE_REASON_CODES) {
      expect(APPROVED_REASON_CODES.has(code)).toBe(true);
    }
  });
});
