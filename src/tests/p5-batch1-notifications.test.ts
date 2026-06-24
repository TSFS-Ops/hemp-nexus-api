/**
 * Stage 6 — P-5 notification builder tests.
 *
 * Confirms every message returned by the SLA rules engine passes the
 * Stage 2 wording guard on customer + funder + public_api surfaces.
 * Also asserts idempotency key shape for daily / once / per_event.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateSlaActions,
  buildIdempotencyKey,
  type P5SlaCaseSnapshot,
} from "@/lib/p5-governance/sla-rules";
import { assertCustomerSafeWording } from "@/lib/p5-governance/wording-guard";

const T0 = new Date("2026-06-24T12:00:00Z");
const at = (h: number) => new Date(T0.getTime() - h * 3600_000).toISOString();

function trigger(overrides: Partial<P5SlaCaseSnapshot>): P5SlaCaseSnapshot {
  return {
    id: "case-x",
    readiness_status: "submitted",
    governance_status: "submitted",
    compliance_status: "submitted",
    status_changed_at: T0.toISOString(),
    assigned_reviewer_id: null,
    owner_user_id: null,
    is_on_hold: false,
    hold_type: null,
    is_escalated: false,
    provider_dependency: false,
    provider_status: null,
    provider_last_checked_at: null,
    affects_live_or_funder: false,
    reason_codes: [],
    ...overrides,
  };
}

describe("P-5 SLA notification safety + idempotency", () => {
  it("every SLA action message is safe on customer / funder / public_api surfaces", () => {
    // Build a snapshot that triggers as many rules as possible at once.
    const snap = trigger({
      readiness_status: "more_information_required",
      more_info_requested_at: at(24 * 20),
      hard_blocker_open_since: at(24 * 5),
      is_on_hold: true,
      hold_type: "compliance",
      hold_applied_at: at(24 * 10),
      provider_dependency: true,
      provider_status: "pending",
      provider_last_checked_at: at(80),
      affects_live_or_funder: true,
      reason_codes: [
        "provider_failed",
        "sanctions_pep_adverse_result_review",
        "bank_detail_verification_issue",
        "payment_confirmation_issue",
        "amount_currency_mismatch",
        "audit_trail_issue",
      ],
      dispute_open: true,
      waiver_requested: true,
      override_requested: true,
    });
    const actions = evaluateSlaActions(snap, T0);
    expect(actions.length).toBeGreaterThan(5);
    for (const a of actions) {
      for (const surface of ["customer", "funder", "public_api"] as const) {
        expect(
          () => assertCustomerSafeWording(a.message, { surface }),
          `rule=${a.rule_code} surface=${surface} msg=${a.message}`,
        ).not.toThrow();
      }
    }
  });

  it("daily rule shares key within day, differs next day", () => {
    const action = evaluateSlaActions(
      trigger({ status_changed_at: at(25) }),
      T0,
    )[0];
    expect(action.bucket).toBe("daily");
    const sameDay = buildIdempotencyKey("c1", action, new Date(T0.getTime() + 3 * 3600_000));
    const nextDay = buildIdempotencyKey("c1", action, new Date(T0.getTime() + 30 * 3600_000));
    expect(buildIdempotencyKey("c1", action, T0)).toBe(sameDay);
    expect(sameDay).not.toBe(nextDay);
  });

  it("per_event rule uses event token, not date", () => {
    const action = evaluateSlaActions(
      trigger({ reason_codes: ["provider_failed"] }),
      T0,
    ).find((x) => x.rule_code === "immediate_provider_failed")!;
    const k1 = buildIdempotencyKey("c1", action, T0);
    const k2 = buildIdempotencyKey("c1", action, new Date(T0.getTime() + 30 * 86400_000));
    expect(k1).toBe(k2);
  });

  it("once-bucket stale_block fires once regardless of clock", () => {
    const a = evaluateSlaActions(
      trigger({
        readiness_status: "more_information_required",
        more_info_requested_at: at(24 * 20),
      }),
      T0,
    ).find((x) => x.rule_code === "more_info_stale_14d")!;
    const k1 = buildIdempotencyKey("c1", a, T0);
    const k2 = buildIdempotencyKey("c1", a, new Date(T0.getTime() + 99 * 86400_000));
    expect(k1).toBe(k2);
    expect(k1.endsWith(":once")).toBe(true);
  });
});
