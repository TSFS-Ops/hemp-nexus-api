import { describe, it, expect } from "vitest";
import {
  calculateReadiness,
  type ReadinessInput,
} from "@/lib/p5-governance/readiness";

const baseInput = (overrides: Partial<ReadinessInput> = {}): ReadinessInput => ({
  evidence: [],
  providers: [],
  holds: [],
  flags: [],
  approval: { human_approval_recorded: false },
  sla: { overdue: false },
  internal_review_complete: false,
  now: "2026-06-24T12:00:00Z",
  ...overrides,
});

describe("P-5 readiness engine — worst-outstanding-issue", () => {
  it("missing required evidence → incomplete/missing_evidence", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "missing" }],
      }),
    );
    expect(r.status).toBe("incomplete");
    expect(r.reason).toBe("missing_evidence");
  });

  it("approved internal evidence + no providers + reviewed + approval → ready_to_proceed", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
      }),
    );
    expect(r.status).toBe("ready_to_proceed");
  });

  it("approved internal evidence but no human approval → internally_ready", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        internal_review_complete: true,
        approval: { human_approval_recorded: false },
      }),
    );
    expect(r.status).toBe("internally_ready");
  });

  it("provider not_live → provider_dependent/provider_not_live", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "not_live" }],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
      }),
    );
    expect(r.status).toBe("provider_dependent");
    expect(r.reason).toBe("provider_not_live");
  });

  it("provider credentials_pending → provider_dependent", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "credentials_pending" }],
        internal_review_complete: true,
      }),
    );
    expect(r.status).toBe("provider_dependent");
    expect(r.reason).toBe("provider_credentials_pending");
  });

  it("provider timeout → provider_dependent/provider_timeout", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "timeout" }],
        internal_review_complete: true,
      }),
    );
    expect(r.status).toBe("provider_dependent");
    expect(r.reason).toBe("provider_timeout");
  });

  it("provider failed (non-high-risk) → blocked/provider_failed", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "failed" }],
        internal_review_complete: true,
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("provider_failed");
  });

  it("provider failed high-risk → blocked/sanctions_pep", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "failed", high_risk: true }],
        internal_review_complete: true,
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("sanctions_pep_adverse_result_review");
  });

  it("provider result conflict → escalated", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "passed", conflict: true }],
        internal_review_complete: true,
      }),
    );
    expect(r.status).toBe("escalated");
    expect(r.reason).toBe("provider_result_conflict");
  });

  it("compliance hold (unreleased) → on_hold", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        holds: [{ kind: "compliance", released: false }],
      }),
    );
    expect(r.status).toBe("on_hold");
    expect(r.reason).toBe("compliance_hold_applied");
  });

  it("governance hold → on_hold/governance_hold_applied", () => {
    const r = calculateReadiness(
      baseInput({
        holds: [{ kind: "governance", released: false }],
      }),
    );
    expect(r.status).toBe("on_hold");
    expect(r.reason).toBe("governance_hold_applied");
  });

  it("released hold no longer blocks", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        holds: [{ kind: "compliance", released: true }],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
      }),
    );
    expect(r.status).toBe("ready_to_proceed");
  });

  it("waiver present + approval → conditional_ready", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [
          { required: true, state: "approved_internal" },
          { required: false, state: "waived" },
        ],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
      }),
    );
    expect(r.status).toBe("conditional_ready");
  });

  it("override recorded → conditional_ready", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        internal_review_complete: true,
        approval: {
          human_approval_recorded: true,
          override_or_waiver_recorded: true,
        },
      }),
    );
    expect(r.status).toBe("conditional_ready");
  });

  it("hard blocker overrides checklist completion", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
        flags: [{ severity: "hard_blocker", reason: "tamper_evidence_issue" }],
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("tamper_evidence_issue");
    // checklist still reports satisfied counts for visibility
    expect(r.checklist.required_satisfied).toBe(1);
  });

  it("overdue SLA → escalated", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        sla: { overdue: true },
      }),
    );
    expect(r.status).toBe("escalated");
    expect(r.reason).toBe("overdue_sla");
  });

  it("payment/audit anomaly → blocked", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        internal_review_complete: true,
        payment_or_audit_anomaly: true,
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("audit_trail_issue");
  });

  it("reviewer requested more info → more_information_required", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        reviewer_more_info_requested: true,
      }),
    );
    expect(r.status).toBe("more_information_required");
  });

  it("expired required evidence → incomplete/expired_evidence", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [
          {
            required: true,
            state: "approved_internal",
            expires_at: "2026-01-01T00:00:00Z",
          },
        ],
        internal_review_complete: true,
      }),
    );
    expect(r.status).toBe("incomplete");
    expect(r.reason).toBe("expired_evidence");
  });

  it("rejected required evidence → blocked/rejected_by_reviewer", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "rejected" }],
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("rejected_by_reviewer");
  });

  it("provider_dependent does not imply provider verified (passed)", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [{ required: true, state: "approved_internal" }],
        providers: [{ required: true, status: "not_live" }],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
      }),
    );
    // Even with full internal approval, provider gap keeps us off ready.
    expect(r.status).toBe("provider_dependent");
    expect(["provider_not_live"]).toContain(r.reason);
  });

  it("checklist counts are visibility-only and do not override status", () => {
    const r = calculateReadiness(
      baseInput({
        evidence: [
          { required: true, state: "approved_internal" },
          { required: true, state: "approved_internal" },
        ],
        internal_review_complete: true,
        approval: { human_approval_recorded: true },
        flags: [{ severity: "hard_blocker", reason: "data_mismatch" }],
      }),
    );
    expect(r.checklist.required_total).toBe(2);
    expect(r.checklist.required_satisfied).toBe(2);
    expect(r.status).toBe("blocked");
  });
});
