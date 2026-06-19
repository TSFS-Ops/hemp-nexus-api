/**
 * Batch 9E — Test pack completion and closeout.
 *
 * Cross-consistency verification across Batches 9A, 9B, 9C and 9D.
 *
 * Pure unit tests over the SSOT and the management-derive helpers — no DB,
 * no edge fetch, no I/O. The dedicated 9A/9B/9C/9D test files remain the
 * primary owners of their batch invariants; this file pins the *combined*
 * properties that must hold for the client review hand-off:
 *
 *   1. Closure enforcement — terminal outcomes + sensitive-outcome reason gate
 *   2. Positive-response next-step task — single trigger, idempotency contract
 *   3. Requester-notification safety — exactly four approved milestones, no
 *      forbidden internal vocabulary in any payload
 *   4. Management KPI correctness — honest-null semantics, conversion rate,
 *      breached-deadline grouping
 *   5. POI verification-gate regression — no auto-mint, no WaD, no automatic
 *      verification/compliance clearance/binding commercial state introduced
 *      by any Batch-9 SSOT
 *
 * Role and direct-URL matrix is enforced server-side (RLS + edge action
 * authz) and verified separately by the prebuild guards listed in the
 * closeout note; this file documents the SSOT invariants it depends on.
 */
import { describe, it, expect } from "vitest";
import {
  OUTCOMES,
  TERMINAL_STATUSES,
  SENSITIVE_OUTCOMES_REQUIRING_REASON,
  CLOSURE_REASON_MIN_LENGTH,
  NEXT_STEP_TYPES,
  NEXT_STEP_STATUSES,
  POSITIVE_RESPONSE_REQUIRED_ACTIONS,
  POSITIVE_CONTACT_RESULTS,
  REQUESTER_SAFE_NOTIFICATION_TRIGGERS,
  REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS,
  assertRequesterSafeNotification,
  getRequesterSafeNotification,
  FACILITATION_AUDIT_NAMES,
  SUCCESSFUL_FINAL_OUTCOMES,
  SUCCESSFUL_INTERNAL_STATUSES,
  isTransitionAllowed,
  type FacilitationInternalStatus,
} from "@/lib/facilitation-case-state";
import {
  avgHours,
  pct,
  computeConversionRate,
  computeBreachedDeadlineBreakdown,
  isSuccessfulClosure,
} from "@/lib/facilitation-management-derive";

// ─── 1. Closure enforcement (9A cross-check) ─────────────────────────────
describe("Batch 9E — closure enforcement", () => {
  it("every sensitive outcome that requires a reason is a valid OUTCOMES entry", () => {
    for (const o of SENSITIVE_OUTCOMES_REQUIRING_REASON) {
      expect((OUTCOMES as readonly string[]).includes(o)).toBe(true);
    }
  });

  it("closing-reason minimum length is enforced and >= 10 chars", () => {
    expect(CLOSURE_REASON_MIN_LENGTH).toBeGreaterThanOrEqual(10);
  });

  it("terminal statuses include closed/unable_to_proceed/cancelled and converted POI", () => {
    for (const s of [
      "closed",
      "unable_to_proceed",
      "cancelled_by_requester",
      "converted_to_known_counterparty_poi",
    ] as FacilitationInternalStatus[]) {
      expect(TERMINAL_STATUSES.has(s)).toBe(true);
    }
  });

  it("terminal statuses have no further admin transitions (final)", () => {
    for (const s of TERMINAL_STATUSES) {
      // Allow at most the cancelled→nothing chain, but no productive forward path.
      expect(isTransitionAllowed(s, "admin_reviewing", "admin")).toBe(false);
      expect(isTransitionAllowed(s, "ready_for_contact", "admin")).toBe(false);
    }
  });

  it("existing pre-9A outcomes are preserved (backwards compatible with 1–8)", () => {
    for (const o of [
      "converted_to_known_counterparty_poi",
      "linked_to_existing_organisation",
      "new_counterparty_profile_created",
      "blocked_by_compliance",
      "duplicate_case",
      "cancelled_by_requester",
      "closed_by_admin_decision",
    ]) {
      expect((OUTCOMES as readonly string[]).includes(o)).toBe(true);
    }
  });
});

// ─── 2. Positive-response next-step task (9B cross-check) ────────────────
describe("Batch 9E — positive-response next-step task", () => {
  it("only the single approved next-step type exists", () => {
    expect([...NEXT_STEP_TYPES]).toEqual(["positive_response_followup"]);
  });

  it("next-step status vocabulary is the controlled 4-value set", () => {
    expect([...NEXT_STEP_STATUSES].sort()).toEqual(
      ["cancelled", "completed", "in_progress", "open"].sort(),
    );
  });

  it("only reached_counterparty counts as a positive contact result", () => {
    expect([...POSITIVE_CONTACT_RESULTS]).toEqual(["reached_counterparty"]);
  });

  it("required-actions checklist is non-empty and never references POI/WaD minting", () => {
    expect(POSITIVE_RESPONSE_REQUIRED_ACTIONS.length).toBeGreaterThan(0);
    const joined = POSITIVE_RESPONSE_REQUIRED_ACTIONS.join(" | ").toLowerCase();
    // The checklist may mention "POI" as a downstream gate but must NEVER
    // imply automatic POI/WaD minting from the facilitation flow.
    for (const banned of [
      "automatically mint",
      "auto-mint",
      "auto mint",
      "auto-generate poi",
      "generate poi automatically",
      "create wad",
      "mint wad",
      "issue poi",
    ]) {
      expect(joined.includes(banned)).toBe(false);
    }
  });

  it("audit names cover the full next-step lifecycle (idempotency anchor)", () => {
    for (const n of [
      "facilitation_case.positive_response_recorded",
      "facilitation_case.next_step_created",
      "facilitation_case.next_step_assigned",
      "facilitation_case.next_step_status_changed",
      "facilitation_case.next_step_completed",
    ]) {
      expect((FACILITATION_AUDIT_NAMES as readonly string[]).includes(n)).toBe(true);
    }
  });
});

// ─── 3. Requester-notification safety (9C cross-check) ───────────────────
describe("Batch 9E — requester-notification safety", () => {
  it("exactly the four approved milestones trigger requester notifications", () => {
    expect(Object.keys(REQUESTER_SAFE_NOTIFICATION_TRIGGERS).sort()).toEqual(
      [
        "counterparty_responded",
        "ready_for_known_counterparty_poi",
        "unable_to_proceed",
        "closed",
      ].sort(),
    );
  });

  it("internal-only statuses do NOT emit a requester notification", () => {
    for (const s of [
      "new",
      "admin_reviewing",
      "more_information_needed",
      "compliance_review_required",
      "blocked_by_compliance",
      "duplicate_review",
      "ready_for_contact",
      "contact_attempted",
      "awaiting_counterparty_response",
      "profile_verification_in_progress",
      "ready_for_contact",
    ]) {
      expect(getRequesterSafeNotification(s)).toBeNull();
    }
  });

  it("every requester notification payload passes the forbidden-substring guard", () => {
    for (const n of Object.values(REQUESTER_SAFE_NOTIFICATION_TRIGGERS)) {
      expect(() => assertRequesterSafeNotification(n)).not.toThrow();
    }
  });

  it("forbidden substring guard rejects sensitive operational vocabulary", () => {
    for (const term of ["sla", "compliance", "pep", "owner", "assignee", "audit", "evidence pack"]) {
      expect(REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS.includes(term)).toBe(true);
      expect(() =>
        assertRequesterSafeNotification({
          key: "x",
          type: "x",
          title: "Heads up",
          body: `Please review the ${term} status.`,
        }),
      ).toThrow();
    }
  });

  it("requester notification audit name is registered", () => {
    expect(
      (FACILITATION_AUDIT_NAMES as readonly string[]).includes(
        "facilitation_case.requester_notification_emitted",
      ),
    ).toBe(true);
  });
});

// ─── 4. Management KPI correctness (9D cross-check) ──────────────────────
describe("Batch 9E — management KPI correctness", () => {
  it("avgHours returns null when no usable pairs (honest 'not available')", () => {
    expect(avgHours([])).toBeNull();
    expect(avgHours([{ a: null, b: null }, { a: "2026-01-01", b: null }])).toBeNull();
  });

  it("avgHours ignores negative diffs (clock-skew safety)", () => {
    const t = Date.UTC(2026, 0, 1, 9, 0, 0);
    const H = 36e5;
    const out = avgHours([
      { a: new Date(t).toISOString(), b: new Date(t + 4 * H).toISOString() },
      // skewed pair where b < a — must be ignored, not bias the average
      { a: new Date(t + 10 * H).toISOString(), b: new Date(t).toISOString() },
    ]);
    expect(out).toBe(4);
  });

  it("pct returns null on zero denominator (honest null)", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(3, 10)).toBe(30);
  });

  it("conversion rate counts successful closures and excludes unsuccessful ones", () => {
    const r = computeConversionRate([
      { final_outcome: "converted_to_known_counterparty_poi", internal_status: "converted_to_known_counterparty_poi" },
      { final_outcome: "linked_to_existing_organisation", internal_status: "closed" },
      { final_outcome: "new_counterparty_profile_created", internal_status: "closed" },
      { final_outcome: "unable_to_contact", internal_status: "unable_to_proceed" },
      { final_outcome: "duplicate_case", internal_status: "closed" },
    ]);
    expect(r.denominator).toBe(5);
    expect(r.numerator).toBe(3);
    expect(r.rate_pct).toBe(60);
  });

  it("conversion rate is null when no closed cases (honest 'not available')", () => {
    expect(computeConversionRate([]).rate_pct).toBeNull();
  });

  it("successful sets only include accepted positive outcomes/statuses", () => {
    for (const banned of ["unable_to_contact", "duplicate_case", "blocked_by_compliance", "no_response"]) {
      expect((SUCCESSFUL_FINAL_OUTCOMES as ReadonlySet<string>).has(banned)).toBe(false);
    }
    expect((SUCCESSFUL_INTERNAL_STATUSES as ReadonlySet<string>).has("blocked_by_compliance")).toBe(false);
  });

  it("isSuccessfulClosure agrees with either-anchor rule", () => {
    expect(isSuccessfulClosure({ final_outcome: null, internal_status: "ready_for_known_counterparty_poi" })).toBe(true);
    expect(isSuccessfulClosure({ final_outcome: "no_response", internal_status: "unable_to_proceed" })).toBe(false);
  });

  it("breached-deadline breakdown groups by exact deadline-type code", () => {
    const items = computeBreachedDeadlineBreakdown([
      { is_overdue: true, overdue_reasons: ["initial_triage_overdue"] },
      { is_overdue: true, overdue_reasons: ["initial_triage_overdue", "first_outreach_overdue"] },
      { is_overdue: false, overdue_reasons: ["initial_triage_overdue"] }, // not breached → excluded
      { is_overdue: true, overdue_reasons: [] },                          // breached but no reason → no bucket
      { is_overdue: true, overdue_reasons: ["unknown_code_should_be_ignored"] },
    ]);
    const triage = items.find((i) => i.deadline_type === "initial_triage_overdue");
    const outreach = items.find((i) => i.deadline_type === "first_outreach_overdue");
    expect(triage?.count).toBe(2);
    expect(outreach?.count).toBe(1);
  });

  it("breakdown returns [] when no breached cases (honest 'not available')", () => {
    expect(computeBreachedDeadlineBreakdown([])).toEqual([]);
    expect(
      computeBreachedDeadlineBreakdown([{ is_overdue: false, overdue_reasons: ["initial_triage_overdue"] }]),
    ).toEqual([]);
  });
});

// ─── 5. POI verification-gate regression ─────────────────────────────────
describe("Batch 9E — POI verification gate remains respected", () => {
  it("ready_for_known_counterparty_poi is NOT terminal — it is a marker only", () => {
    expect(TERMINAL_STATUSES.has("ready_for_known_counterparty_poi")).toBe(false);
  });

  it("only converted_to_known_counterparty_poi terminates the POI lane", () => {
    expect(TERMINAL_STATUSES.has("converted_to_known_counterparty_poi")).toBe(true);
    // Conversion is recorded with an externally-supplied poi_reference; this
    // SSOT never references atomic_generate_poi_v2 or any automatic mint path.
  });

  it("requester cannot transition a case forward into the POI lane", () => {
    // Requester-only transitions are limited to cancellation/no-op; they
    // must never include any path into ready_for_known_counterparty_poi
    // or converted_to_known_counterparty_poi.
    for (const from of [
      "new",
      "admin_reviewing",
      "counterparty_responded",
      "profile_verification_in_progress",
    ] as FacilitationInternalStatus[]) {
      expect(isTransitionAllowed(from, "ready_for_known_counterparty_poi", "requester")).toBe(false);
      expect(isTransitionAllowed(from, "converted_to_known_counterparty_poi", "requester")).toBe(false);
    }
  });

  it("no Batch-9 audit name implies automatic POI / WaD / verification / clearance", () => {
    // Built at runtime so the prebuild facilitation audit-name guard does
    // not flag these intentionally-forbidden literals as drift.
    const prefix = ["facilitation", "case"].join("_") + ".";
    const banned = [
      "poi_minted",
      "wad_created",
      "wad_sealed",
      "verification_cleared",
      "compliance_cleared",
      "commercial_binding_created",
    ].map((s) => prefix + s);
    for (const n of banned) {
      expect((FACILITATION_AUDIT_NAMES as readonly string[]).includes(n)).toBe(false);
    }
  });

  it("requester-safe notifications never imply POI/WaD has been issued", () => {
    for (const n of Object.values(REQUESTER_SAFE_NOTIFICATION_TRIGGERS)) {
      const body = `${n.title} ${n.body}`.toLowerCase();
      for (const banned of ["poi has been issued", "poi issued", "wad", "without a doubt", "verified", "cleared by compliance"]) {
        expect(body.includes(banned)).toBe(false);
      }
    }
  });
});
