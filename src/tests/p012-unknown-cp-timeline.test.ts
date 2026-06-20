/**
 * P012 — Unknown-counterparty user-facing timeline tests.
 *
 * Pure-logic tests for the SSOT module. RLS/edge-function behaviour is
 * covered by Deno tests; UI behaviour is exercised by component tests.
 */
import { describe, it, expect } from "vitest";
import {
  UNKNOWN_CP_STATUS_ORDER,
  UNKNOWN_CP_STATUS_LABEL,
  UNKNOWN_CP_STATUS_COPY,
  UNKNOWN_CP_STATUS_GROUP,
  UNKNOWN_CP_INTERNAL_ONLY_STATUSES,
  UNKNOWN_CP_AUDIT_EVENT_NAMES,
  UNKNOWN_CP_FORBIDDEN_WORDS,
  UNKNOWN_CP_BLOCKED_PROGRESSION_COPY,
  UNKNOWN_CP_SLA_NOTE,
  UNKNOWN_CP_PANEL_HEADING,
  UNKNOWN_CP_PANEL_SUBHEADING,
  getAllowedActions,
  isUserVisibleStatus,
  type UnknownCpStatus,
} from "@/lib/unknown-cp-timeline";

describe("P012 — Unknown-Counterparty Timeline SSOT", () => {
  it("has 17 ordered statuses with no duplicates", () => {
    expect(UNKNOWN_CP_STATUS_ORDER.length).toBe(17);
    expect(new Set(UNKNOWN_CP_STATUS_ORDER).size).toBe(17);
  });

  it("only outreach_prepared is internal-only", () => {
    expect(UNKNOWN_CP_INTERNAL_ONLY_STATUSES.size).toBe(1);
    expect(UNKNOWN_CP_INTERNAL_ONLY_STATUSES.has("outreach_prepared")).toBe(true);
  });

  it("isUserVisibleStatus hides outreach_prepared and shows everything else", () => {
    for (const s of UNKNOWN_CP_STATUS_ORDER) {
      expect(isUserVisibleStatus(s)).toBe(s !== "outreach_prepared");
    }
  });

  it("every status has a label, group, and copy (except outreach_prepared which has empty copy)", () => {
    for (const s of UNKNOWN_CP_STATUS_ORDER) {
      expect(UNKNOWN_CP_STATUS_LABEL[s]).toBeTruthy();
      expect(UNKNOWN_CP_STATUS_GROUP[s]).toBeTruthy();
      if (s === "outreach_prepared") expect(UNKNOWN_CP_STATUS_COPY[s]).toBe("");
      else expect(UNKNOWN_CP_STATUS_COPY[s]).toBeTruthy();
    }
  });

  it("approved copy is verbatim for material statuses", () => {
    expect(UNKNOWN_CP_STATUS_COPY.poi_created).toContain("Proof of Intention has been created with an unknown counterparty");
    expect(UNKNOWN_CP_STATUS_COPY.converted_to_known_counterparty).toContain("required POI/WaD gates are satisfied");
    expect(UNKNOWN_CP_STATUS_COPY.counterparty_declined).toContain("declined to engage");
    expect(UNKNOWN_CP_BLOCKED_PROGRESSION_COPY).toContain("not available while the counterparty is unknown");
    expect(UNKNOWN_CP_SLA_NOTE).toContain("24/7");
    expect(UNKNOWN_CP_PANEL_HEADING).toBe("Unknown-counterparty facilitation");
    expect(UNKNOWN_CP_PANEL_SUBHEADING).toContain("Track Izenzo support progress");
  });

  it("status copy never uses forbidden words except where status itself is the event", () => {
    for (const s of UNKNOWN_CP_STATUS_ORDER) {
      const copy = UNKNOWN_CP_STATUS_COPY[s].toLowerCase();
      for (const w of UNKNOWN_CP_FORBIDDEN_WORDS) {
        // converted/onboarding statuses describe actual recorded events.
        if (
          (w === "onboarded" || w === "contacted" || w === "approved" || w === "verified" ||
            w === "cleared" || w === "accepted" || w === "guaranteed")
        ) {
          expect(copy).not.toContain(w);
        }
      }
    }
  });

  it("11 audit events are registered (matches client spec)", () => {
    expect(UNKNOWN_CP_AUDIT_EVENT_NAMES.length).toBe(11);
    expect(UNKNOWN_CP_AUDIT_EVENT_NAMES).toContain("unknown_cp_case_created");
    expect(UNKNOWN_CP_AUDIT_EVENT_NAMES).toContain("unknown_cp_case_reopened");
    expect(UNKNOWN_CP_AUDIT_EVENT_NAMES).toContain("unknown_cp_outcome_recorded");
  });

  describe("getAllowedActions block matrix", () => {
    const cases: Array<[UnknownCpStatus, Partial<ReturnType<typeof getAllowedActions>>]> = [
      ["poi_created",                       { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["facilitation_case_opened",          { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["details_under_review",              { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["more_information_required",         { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["additional_information_received",   { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["outreach_started",                  { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["awaiting_counterparty_response",    { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["counterparty_invited",              { addMoreInformation: true,  cancelRequest: true,  progressToWaD: false }],
      ["counterparty_onboarding_in_progress", { progressToWaD: false }],
      ["converted_to_known_counterparty",   { addMoreInformation: false, cancelRequest: false, progressToWaD: true }],
      ["counterparty_declined",             { progressToWaD: false }],
      ["no_response",                       { progressToWaD: false }],
      ["unreachable",                       { progressToWaD: false }],
      ["invalid_counterparty_details",      { progressToWaD: false }],
      ["cancelled_by_requester",            { addMoreInformation: false, cancelRequest: false, progressToWaD: false }],
      ["closed_by_izenzo",                  { addMoreInformation: false, cancelRequest: false, progressToWaD: false }],
    ];
    it.each(cases)("status %s permits expected actions", (status, expected) => {
      const a = getAllowedActions(status);
      for (const [k, v] of Object.entries(expected)) {
        expect((a as unknown as Record<string, unknown>)[k]).toBe(v);
      }
      expect(a.contactSupport).toBe(true); // always allowed
      expect(a.disabledMessage.length).toBeGreaterThan(0);
    });
  });

  it("progression is only allowed when converted_to_known_counterparty", () => {
    const allowingProgress = UNKNOWN_CP_STATUS_ORDER.filter((s) => getAllowedActions(s).progressToWaD);
    expect(allowingProgress).toEqual(["converted_to_known_counterparty"]);
  });
});
