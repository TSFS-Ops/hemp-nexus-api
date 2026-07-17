import { describe, it, expect, beforeEach } from "vitest";
import {
  CASE_STATUS_LABELS,
  CASE_TYPES_DEFERRED,
  CASE_TYPES_LAUNCH,
  COMPLIANCE_SENDER_NAME,
  DECISION_OUTCOMES,
  EVIDENCE_STATES,
  PROVIDER_STATES,
  RISK_BANDS,
  SLA_POLICY,
  complianceMutations,
  getAdapterMode,
  getCaseDetail,
  getFunderSummary,
  getOverviewMetrics,
  isSameActor,
  listCases,
  setAdapterMode,
} from "@/lib/compliance-workbench";
import {
  canApproveDirector,
  canProposeDecision,
  canReleaseHold,
  canViewInternalWorkbench,
} from "@/lib/compliance-workbench/permissions";

describe("compliance-workbench SSOT", () => {
  it("exposes exactly the approved launch case types", () => {
    expect(CASE_TYPES_LAUNCH).toHaveLength(7);
    expect(CASE_TYPES_LAUNCH).toContain("organisation_onboarding");
    expect(CASE_TYPES_LAUNCH).toContain("sanctions");
    expect(CASE_TYPES_LAUNCH).toContain("transaction_compliance");
  });

  it("marks Authority-to-Bind/PEP/Funder/Manual-Override/Hold-Release as deferred", () => {
    expect(CASE_TYPES_DEFERRED).toContain("authority_to_bind");
    expect(CASE_TYPES_DEFERRED).toContain("pep_adverse_media");
    expect(CASE_TYPES_DEFERRED).toContain("funder_required");
    expect(CASE_TYPES_DEFERRED).toContain("manual_override");
    expect(CASE_TYPES_DEFERRED).toContain("hold_release");
  });

  it("has all approved lifecycle labels", () => {
    for (const s of ["draft", "submitted", "in_review", "awaiting_customer", "approved", "conditionally_approved", "rejected", "blocked", "suspended", "closed", "reopened"] as const) {
      expect(CASE_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("keeps 'more_information_required' as a decision-family value, not a final state", () => {
    // In DECISION_OUTCOMES because the proposal composer offers it,
    // but questionnaire policy says it is not a final outcome — it is an
    // active workflow condition. CASE_STATUS_LABELS deliberately does NOT
    // include a 'more_information_required' status.
    expect(DECISION_OUTCOMES).toContain("more_information_required");
    expect(Object.keys(CASE_STATUS_LABELS)).not.toContain("more_information_required");
  });

  it("uses the four approved risk bands", () => {
    expect(RISK_BANDS).toEqual(["low", "medium", "high", "critical"]);
  });

  it("has the approved SLA policy numbers", () => {
    expect(SLA_POLICY.rfi_response_business_days).toBe(10);
    expect(SLA_POLICY.rfi_reminders_at_percent).toEqual([50, 80, 100]);
    expect(SLA_POLICY.rfi_max_standard_cycles).toBe(3);
    expect(SLA_POLICY.rfi_final_notice_business_days).toBe(5);
    expect(SLA_POLICY.conditional_approval_max_days).toBe(90);
    expect(SLA_POLICY.reopen_window_days).toBe(30);
    expect(SLA_POLICY.appeal_window_business_days).toBe(10);
    expect(SLA_POLICY.funder_summary_expiry_days).toBe(30);
  });

  it("uses 'Izenzo Compliance' as the customer-facing sender", () => {
    expect(COMPLIANCE_SENDER_NAME).toBe("Izenzo Compliance");
  });

  it("declares all approved evidence and provider states", () => {
    for (const s of ["required","missing","uploaded","under_review","accepted","rejected","replacement_requested","expired","waived","superseded"] as const) {
      expect(EVIDENCE_STATES).toContain(s);
    }
    for (const s of ["not_required","required","pending","clear","possible_match","confirmed_match","mismatch","review_required","provider_error","expired","refresh_required","manually_resolved"] as const) {
      expect(PROVIDER_STATES).toContain(s);
    }
  });
});

describe("compliance-workbench permissions", () => {
  it("gates internal workbench to internal roles only", () => {
    expect(canViewInternalWorkbench(["compliance_analyst"])).toBe(true);
    expect(canViewInternalWorkbench(["platform_admin"])).toBe(true);
    expect(canViewInternalWorkbench(["auditor"])).toBe(true);
    expect(canViewInternalWorkbench(["customer_user"])).toBe(false);
    expect(canViewInternalWorkbench(["funder_viewer"])).toBe(false);
    expect(canViewInternalWorkbench([])).toBe(false);
  });

  it("only compliance_analyst/ops_lead may propose decisions", () => {
    expect(canProposeDecision(["compliance_analyst"])).toBe(true);
    expect(canProposeDecision(["compliance_operations_lead"])).toBe(true);
    expect(canProposeDecision(["senior_compliance_approver"])).toBe(false);
    expect(canProposeDecision(["customer_user"])).toBe(false);
  });

  it("director-only actions require director role", () => {
    expect(canApproveDirector(["director"])).toBe(true);
    expect(canApproveDirector(["senior_compliance_approver"])).toBe(false);
  });

  it("hold release requires senior approver or director", () => {
    expect(canReleaseHold(["senior_compliance_approver"])).toBe(true);
    expect(canReleaseHold(["director"])).toBe(true);
    expect(canReleaseHold(["compliance_analyst"])).toBe(false);
  });

  it("distinct-person guard treats identical display names as same actor", () => {
    expect(isSameActor("N. Dlamini", "N. Dlamini")).toBe(true);
    expect(isSameActor(" N. Dlamini ", "n. dlamini")).toBe(true);
    expect(isSameActor("N. Dlamini", "K. Patel")).toBe(false);
    expect(isSameActor(null, "N. Dlamini")).toBe(false);
  });
});

describe("compliance-workbench adapter — fixture mode", () => {
  beforeEach(() => setAdapterMode("fixture"));

  it("defaults to fixture mode and returns cases", async () => {
    expect(getAdapterMode()).toBe("fixture");
    const cases = await listCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      // Never expose UUIDs as the visible identifier — reference is human.
      expect(c.reference).toMatch(/^IZ-CMP-/);
    }
  });

  it("returns overview metrics", async () => {
    const m = await getOverviewMetrics();
    expect(m.openCases).toBeGreaterThan(0);
    expect(m.riskDistribution.critical).toBeGreaterThanOrEqual(0);
  });

  it("returns a case detail with a coherent case file", async () => {
    const d = await getCaseDetail("IZ-CMP-2026-000123");
    expect(d.summary.reference).toBe("IZ-CMP-2026-000123");
    expect(d.evidence.length).toBeGreaterThan(0);
    expect(d.timeline.length).toBeGreaterThan(0);
    expect(d.exports.map((e) => e.audience).sort()).toEqual(["customer", "funder", "internal"]);
  });

  it("filters unassigned/overdue/hold/provider-dependent", async () => {
    const un = await listCases({ unassigned: true });
    expect(un.every((c) => !c.assignment.analystDisplayName)).toBe(true);
    const overdue = await listCases({ overdue: true });
    expect(overdue.every((c) => c.sla.breached)).toBe(true);
    const hold = await listCases({ hasHold: true });
    expect(hold.every((c) => c.hasActiveHold)).toBe(true);
    const provDep = await listCases({ providerDependent: true });
    expect(provDep.every((c) => c.providerDependent)).toBe(true);
  });

  it("funder summary hides internal fields", async () => {
    const s = await getFunderSummary();
    // Only approved subset of fields — reject any accidental leakage.
    const keys = Object.keys(s);
    for (const forbidden of ["providerNames", "internalNotes", "approvalDeliberations", "rawProviderPayload", "unapprovedEvidence"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(s.evidencePackVersion).toBeTruthy();
    expect(s.accessExpiresAt).toBeTruthy();
  });

  it("mutations succeed in fixture mode", async () => {
    const r = await complianceMutations.uploadEvidence("IZ-CMP-2026-000123", "proof_of_address");
    expect(r.ok).toBe(true);
  });
});

describe("compliance-workbench adapter — live mode", () => {
  beforeEach(() => setAdapterMode("live"));

  it("reads throw NotImplementedError in live mode until backend is wired", async () => {
    await expect(listCases()).rejects.toThrow(/not yet wired/);
    await expect(getOverviewMetrics()).rejects.toThrow(/not yet wired/);
    await expect(getCaseDetail("x")).rejects.toThrow(/not yet wired/);
    await expect(getFunderSummary()).rejects.toThrow(/not yet wired/);
  });

  it("mutations return explicit not_implemented — they never silently succeed", async () => {
    const r = await complianceMutations.assignCase("IZ-CMP-2026-000123", "somebody");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("not_implemented");
    const rr = await complianceMutations.uploadEvidence("IZ-CMP-2026-000123", "reg");
    expect(rr.ok).toBe(false);
    expect(rr.code).toBe("not_implemented");
    const h = await complianceMutations.approveHoldRelease("hold-1");
    expect(h.ok).toBe(false);
    expect(h.code).toBe("not_implemented");
  });
});
