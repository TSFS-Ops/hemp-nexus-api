/**
 * Stage 6 — P-5 SLA rules engine tests.
 *
 * Pure deterministic tests against `evaluateSlaActions`. No I/O.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateSlaActions,
  addWorkingDays,
  buildIdempotencyKey,
  type P5SlaCaseSnapshot,
} from "@/lib/p5-governance/sla-rules";

const T0 = new Date("2026-06-24T12:00:00Z"); // Wednesday

function base(overrides: Partial<P5SlaCaseSnapshot> = {}): P5SlaCaseSnapshot {
  return {
    id: "case-1",
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

const at = (hoursAgo: number) =>
  new Date(T0.getTime() - hoursAgo * 3600_000).toISOString();

describe("P-5 SLA rules engine", () => {
  it("submitted without reviewer >24h → escalate to platform_admin", () => {
    const actions = evaluateSlaActions(base({ status_changed_at: at(25) }), T0);
    const a = actions.find((x) => x.rule_code === "reviewer_unassigned_24h");
    expect(a).toBeDefined();
    expect(a!.severity).toBe("escalation");
    expect(a!.notify_roles).toContain("platform_admin");
  });

  it("submitted within 24h → no reviewer escalation", () => {
    const actions = evaluateSlaActions(base({ status_changed_at: at(10) }), T0);
    expect(actions.find((x) => x.rule_code === "reviewer_unassigned_24h")).toBeUndefined();
  });

  it("under_review >48h → escalate to platform_admin", () => {
    const a = evaluateSlaActions(
      base({ readiness_status: "under_review", status_changed_at: at(49) }),
      T0,
    ).find((x) => x.rule_code === "under_review_overdue_48h");
    expect(a).toBeDefined();
    expect(a!.notify_roles).toContain("platform_admin");
  });

  it("more_information_required >3 working days → reminder", () => {
    // 5 calendar days ago covers 3 working days even across a weekend.
    const a = evaluateSlaActions(
      base({
        readiness_status: "more_information_required",
        more_info_requested_at: at(24 * 6),
      }),
      T0,
    ).find((x) => x.rule_code === "more_info_reminder_3wd");
    expect(a).toBeDefined();
    expect(a!.severity).toBe("reminder");
    expect(a!.notify_roles).toContain("customer_entity_owner");
  });

  it("more_information_required >7 working days → escalation", () => {
    const a = evaluateSlaActions(
      base({
        readiness_status: "more_information_required",
        more_info_requested_at: at(24 * 12),
      }),
      T0,
    ).find((x) => x.rule_code === "more_info_escalate_7wd");
    expect(a).toBeDefined();
    expect(a!.notify_roles).toContain("platform_admin");
  });

  it("more_information_required >14 calendar days → stale_block (unless admin extension)", () => {
    const ev = evaluateSlaActions(
      base({
        readiness_status: "more_information_required",
        more_info_requested_at: at(24 * 15),
      }),
      T0,
    );
    const a = ev.find((x) => x.rule_code === "more_info_stale_14d");
    expect(a).toBeDefined();
    expect(a!.status_change).toBe("blocked");

    const ext = evaluateSlaActions(
      base({
        readiness_status: "more_information_required",
        more_info_requested_at: at(24 * 15),
        admin_extension_active: true,
      }),
      T0,
    );
    expect(ext.find((x) => x.rule_code === "more_info_stale_14d")).toBeUndefined();
  });

  it("hard blocker >2 working days → escalation", () => {
    const a = evaluateSlaActions(
      base({
        readiness_status: "blocked",
        hard_blocker_open_since: at(24 * 5),
      }),
      T0,
    ).find((x) => x.rule_code === "hard_blocker_unresolved_2wd");
    expect(a).toBeDefined();
    expect(a!.notify_roles).toContain("platform_admin");
  });

  it("compliance hold >5 working days → critical escalation to executive_approver", () => {
    const a = evaluateSlaActions(
      base({
        is_on_hold: true,
        hold_type: "compliance",
        hold_applied_at: at(24 * 10),
      }),
      T0,
    ).find((x) => x.rule_code === "compliance_hold_unresolved_5wd");
    expect(a).toBeDefined();
    expect(a!.severity).toBe("critical_escalation");
    expect(a!.notify_roles).toEqual(expect.arrayContaining(["executive_approver", "compliance_admin"]));
  });

  it("provider pending >24h → notifies technical owner & operator", () => {
    const a = evaluateSlaActions(
      base({
        provider_dependency: true,
        provider_status: "pending",
        provider_last_checked_at: at(25),
      }),
      T0,
    ).find((x) => x.rule_code === "provider_pending_24h");
    expect(a).toBeDefined();
    expect(a!.notify_roles).toEqual(expect.arrayContaining(["developer_technical_admin", "operator_case_manager"]));
  });

  it("provider pending/not_live/credentials_pending >72h on live → escalates to platform_admin", () => {
    for (const status of ["pending", "not_live", "credentials_pending"] as const) {
      const a = evaluateSlaActions(
        base({
          provider_dependency: true,
          provider_status: status,
          provider_last_checked_at: at(73),
          affects_live_or_funder: true,
        }),
        T0,
      ).find((x) => x.rule_code === "provider_pending_72h_live");
      expect(a, `status=${status}`).toBeDefined();
      expect(a!.notify_roles).toContain("platform_admin");
    }
  });

  it("provider 72h escalation NOT raised when not affecting live/funder item", () => {
    const a = evaluateSlaActions(
      base({
        provider_dependency: true,
        provider_status: "pending",
        provider_last_checked_at: at(80),
        affects_live_or_funder: false,
      }),
      T0,
    ).find((x) => x.rule_code === "provider_pending_72h_live");
    expect(a).toBeUndefined();
  });

  it("immediate escalation: provider_failed / conflict / sanctions / bank / payment / duplicate / amount / audit", () => {
    const reasons = [
      ["provider_failed", "immediate_provider_failed"],
      ["provider_result_conflict", "immediate_provider_conflict"],
      ["sanctions_pep_adverse_result_review", "immediate_sanctions_pep"],
      ["bank_detail_verification_issue", "immediate_bank_issue"],
      ["payment_confirmation_issue", "immediate_payment_anomaly"],
      ["duplicate_notification", "immediate_duplicate_notification"],
      ["amount_currency_mismatch", "immediate_amount_mismatch"],
      ["audit_trail_issue", "immediate_audit_tamper"],
      ["tamper_evidence_issue", "immediate_audit_tamper"],
    ] as const;
    for (const [reason, rule] of reasons) {
      const a = evaluateSlaActions(base({ reason_codes: [reason] }), T0).find(
        (x) => x.rule_code === rule,
      );
      expect(a, reason).toBeDefined();
      expect(a!.severity).toBe("critical_escalation");
      expect(a!.notify_roles).toEqual(expect.arrayContaining(["platform_admin", "compliance_admin"]));
    }
  });

  it("dispute / waiver / override → platform_admin + executive_approver", () => {
    for (const [field, rule] of [
      ["dispute_open", "dispute_rejection"],
      ["waiver_requested", "waiver_request"],
      ["override_requested", "override_request"],
    ] as const) {
      const a = evaluateSlaActions(base({ [field]: true } as Partial<P5SlaCaseSnapshot>), T0).find(
        (x) => x.rule_code === rule,
      );
      expect(a, field).toBeDefined();
      expect(a!.notify_roles).toEqual(expect.arrayContaining(["platform_admin", "executive_approver"]));
    }
  });

  it("idempotency keys are date-bucketed for daily rules", () => {
    const action = evaluateSlaActions(base({ status_changed_at: at(25) }), T0)[0];
    const k1 = buildIdempotencyKey("case-1", action, T0);
    const k2 = buildIdempotencyKey(
      "case-1",
      action,
      new Date(T0.getTime() + 2 * 3600_000),
    );
    expect(k1).toBe(k2); // same date bucket
    const k3 = buildIdempotencyKey(
      "case-1",
      action,
      new Date(T0.getTime() + 26 * 3600_000),
    );
    expect(k1).not.toBe(k3); // next day → new bucket
  });

  it("stale_block uses once bucket", () => {
    const a = evaluateSlaActions(
      base({
        readiness_status: "more_information_required",
        more_info_requested_at: at(24 * 15),
      }),
      T0,
    ).find((x) => x.rule_code === "more_info_stale_14d");
    const k = buildIdempotencyKey("case-1", a!, T0);
    expect(k.endsWith(":once")).toBe(true);
  });

  it("addWorkingDays skips weekends", () => {
    // 2026-06-24 is Wednesday. +5 working days = Wednesday 2026-07-01.
    const out = addWorkingDays(new Date("2026-06-24T00:00:00Z"), 5);
    expect(out.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("healthy case produces no actions", () => {
    const ev = evaluateSlaActions(
      base({
        readiness_status: "internally_ready",
        status_changed_at: at(2),
        assigned_reviewer_id: "rev-1",
      }),
      T0,
    );
    expect(ev).toEqual([]);
  });
});
