/**
 * P-5 Batch 4 — Stage 2 pure-logic tests.
 *
 * Covers all twelve Stage 2 modules with deterministic, DB-free assertions.
 */
import { describe, it, expect } from "vitest";
import {
  P5B4_MILESTONE_KEYS,
  P5B4_OVERDUE_LABELS,
  P5B4_PROCESS_TYPES,
  P5B4_ROLE_KEYS,
} from "@/lib/p5-batch4/constants";
import {
  buildMilestonePath,
  isFinalApprovalReachable,
  P5B4_MILESTONE_NAMES,
} from "@/lib/p5-batch4/milestones";
import {
  isEvidenceReceived,
  isEvidenceReviewComplete,
  summariseGaps,
} from "@/lib/p5-batch4/evidence-rules";
import {
  canOverrideBlocker,
  countOpenHardBlockers,
  countOpenSoftWarnings,
  getBlockerSpec,
  listBlockerSpecs,
} from "@/lib/p5-batch4/blockers";
import { classifyOverdue, workingDaysBetween } from "@/lib/p5-batch4/overdue";
import { rollupReadiness } from "@/lib/p5-batch4/readiness";
import {
  assertRoleMatrixComplete,
  isActionAllowed,
  P5B4_ROLE_ACTIONS,
} from "@/lib/p5-batch4/roles";
import {
  checkCaseMutable,
  checkFinalityAction,
} from "@/lib/p5-batch4/permissions";
import {
  P5B4_PROVIDER_DEPENDENT_SAFE_LABEL,
  scanForbidden,
} from "@/lib/p5-batch4/wording-guard";
import {
  evaluateFinality,
  isFinalityActorAllowed,
} from "@/lib/p5-batch4/finality";
import {
  buildMemorySummary,
  P5B4_MEMORY_FORBIDDEN_FIELDS,
  stripSensitiveFields,
} from "@/lib/p5-batch4/memory-summary";
import {
  assertCaseRefCovers,
  formatCaseReference,
  isCaseReference,
} from "@/lib/p5-batch4/case-reference";
import {
  assertNoForbiddenApiFields,
  buildApiSafeCase,
  P5B4_API_SAFE_FIELDS,
} from "@/lib/p5-batch4/api-fields";

const day = (s: string) => new Date(s + "T00:00:00Z");

describe("milestones", () => {
  it("buildMilestonePath returns all 15 milestones in SSOT order", () => {
    const p = buildMilestonePath("company_onboarding");
    expect(p.map((m) => m.key)).toEqual([...P5B4_MILESTONE_KEYS]);
    expect(p.length).toBe(15);
  });

  it("marks funder_release conditional for company_onboarding", () => {
    const p = buildMilestonePath("company_onboarding");
    expect(p.find((m) => m.key === "funder_release")!.mandatory_type).toBe("conditional");
  });

  it("marks execution_conditions_complete conditional for funder_release process", () => {
    const p = buildMilestonePath("funder_release");
    expect(p.find((m) => m.key === "execution_conditions_complete")!.mandatory_type).toBe(
      "conditional",
    );
  });

  it("names are populated for every milestone", () => {
    for (const k of P5B4_MILESTONE_KEYS) expect(P5B4_MILESTONE_NAMES[k]).toBeTruthy();
  });

  it("overdue labels exist for every milestone", () => {
    for (const k of P5B4_MILESTONE_KEYS) expect(P5B4_OVERDUE_LABELS[k]).toBeTruthy();
  });

  it("isFinalApprovalReachable=false when a mandatory milestone is incomplete", () => {
    const reachable = isFinalApprovalReachable(
      new Set(["case_opened", "scope_confirmed"]),
      new Set(),
      new Set(),
      "transaction_case",
    );
    expect(reachable).toBe(false);
  });

  it("isFinalApprovalReachable=true when all mandatory milestones complete or waived", () => {
    const allMandatory = new Set(
      buildMilestonePath("transaction_case")
        .filter((m) => m.mandatory_type === "mandatory")
        .filter(
          (m) => !["final_approval", "finality_recorded", "closed_archived"].includes(m.key),
        )
        .map((m) => m.key),
    );
    expect(
      isFinalApprovalReachable(allMandatory, new Set(), new Set(), "transaction_case"),
    ).toBe(true);
  });
});

describe("evidence-rules", () => {
  it("isEvidenceReceived true with no mandatory items", () => {
    expect(isEvidenceReceived([{ requirement_type: "optional", status: "missing" }])).toBe(true);
  });

  it("isEvidenceReceived false when mandatory item missing", () => {
    expect(
      isEvidenceReceived([{ requirement_type: "mandatory", status: "missing" }]),
    ).toBe(false);
  });

  it("isEvidenceReceived true when all mandatory items uploaded or waived", () => {
    expect(
      isEvidenceReceived([
        { requirement_type: "mandatory", status: "uploaded" },
        { requirement_type: "mandatory", status: "waived" },
      ]),
    ).toBe(true);
  });

  it("isEvidenceReviewComplete false when an uploaded item lacks terminal status", () => {
    expect(
      isEvidenceReviewComplete([{ requirement_type: "mandatory", status: "uploaded" }]),
    ).toBe(false);
  });

  it("isEvidenceReviewComplete true when every item is terminal/missing/requested", () => {
    expect(
      isEvidenceReviewComplete([
        { requirement_type: "mandatory", status: "accepted" },
        { requirement_type: "optional", status: "waived" },
        { requirement_type: "mandatory", status: "provider_dependent" },
      ]),
    ).toBe(true);
  });

  it("summariseGaps counts correctly", () => {
    const g = summariseGaps([
      { requirement_type: "mandatory", status: "missing" },
      { requirement_type: "mandatory", status: "rejected" },
      { requirement_type: "mandatory", status: "expired" },
      { requirement_type: "optional", status: "missing" },
      { requirement_type: "mandatory", status: "provider_dependent" },
    ]);
    expect(g).toEqual({
      mandatoryMissing: 1,
      mandatoryRejected: 1,
      mandatoryExpired: 1,
      providerDependent: 1,
      optionalMissing: 1,
    });
  });
});

describe("blockers", () => {
  it("listBlockerSpecs returns every key from SSOT", () => {
    expect(listBlockerSpecs().length).toBe(15);
  });

  it("counts open hard blockers, ignores resolved", () => {
    expect(
      countOpenHardBlockers([
        { key: "missing_authority_to_act", type: "hard", status: "open" },
        { key: "ubo_director_unresolved", type: "hard", status: "resolved" },
        { key: "optional_evidence_missing", type: "soft_warning", status: "open" },
      ]),
    ).toBe(1);
  });

  it("counts open soft warnings separately", () => {
    expect(
      countOpenSoftWarnings([
        { key: "optional_evidence_missing", type: "soft_warning", status: "open" },
        { key: "document_approaching_expiry", type: "soft_warning", status: "resolved" },
      ]),
    ).toBe(1);
  });

  it("missing_authority_to_act is hard and not overridable", () => {
    const r = canOverrideBlocker("missing_authority_to_act", "platform_admin", "reason text");
    expect(r.allowed).toBe(false);
    expect(getBlockerSpec("missing_authority_to_act").type).toBe("hard");
  });

  it("compliance hold overridable by platform_admin with reason", () => {
    expect(
      canOverrideBlocker("unresolved_compliance_hold", "platform_admin", "approved waiver").allowed,
    ).toBe(true);
    expect(
      canOverrideBlocker("unresolved_compliance_hold", "operator", "approved waiver").allowed,
    ).toBe(false);
    expect(
      canOverrideBlocker("unresolved_compliance_hold", "platform_admin", "").allowed,
    ).toBe(false);
  });

  it("every external_safe_label is a non-empty string", () => {
    for (const s of listBlockerSpecs()) {
      expect(s.external_safe_label.length).toBeGreaterThan(0);
    }
  });
});

describe("overdue", () => {
  it("workingDaysBetween skips weekends", () => {
    expect(workingDaysBetween(day("2026-06-26"), day("2026-06-29"))).toBe(1); // Fri→Mon
    expect(workingDaysBetween(day("2026-06-22"), day("2026-06-26"))).toBe(4); // Mon→Fri
  });

  it("on_track when far before due", () => {
    expect(
      classifyOverdue({
        milestone_key: "evidence_received",
        is_mandatory: true,
        due_at: day("2026-07-10"),
        now: day("2026-07-01"),
      }),
    ).toBe("on_track");
  });

  it("due_soon when within reminder window", () => {
    expect(
      classifyOverdue({
        milestone_key: "funder_review_complete",
        is_mandatory: false,
        due_at: day("2026-07-02"),
        now: day("2026-07-01"),
      }),
    ).toBe("due_soon");
  });

  it("overdue when past due but under escalation", () => {
    expect(
      classifyOverdue({
        milestone_key: "evidence_review_complete",
        is_mandatory: true,
        due_at: day("2026-07-01"),
        now: day("2026-07-02"),
      }),
    ).toBe("overdue");
  });

  it("escalated past escalation threshold", () => {
    expect(
      classifyOverdue({
        milestone_key: "evidence_review_complete",
        is_mandatory: true,
        due_at: day("2026-07-01"),
        now: day("2026-07-09"),
      }),
    ).toBe("escalated");
  });

  it("evidence_received flips to blocked past critical for mandatory", () => {
    expect(
      classifyOverdue({
        milestone_key: "evidence_received",
        is_mandatory: true,
        due_at: day("2026-07-01"),
        now: day("2026-07-15"),
      }),
    ).toBe("blocked");
  });
});

describe("readiness", () => {
  const allCompleted = (status: "complete" | "active" = "complete") =>
    P5B4_MILESTONE_KEYS.map((k) => ({ key: k, status, is_mandatory: true }));

  it("blocked when any open hard blocker", () => {
    expect(
      rollupReadiness({
        milestones: allCompleted(),
        blockers: [{ key: "missing_authority_to_act", type: "hard", status: "open" }],
        has_provider_dependent_open_item: false,
        has_governance_decision: true,
        has_compliance_decision: true,
      }),
    ).toBe("blocked");
  });

  it("provider_dependent when no blocker but provider-dep open", () => {
    expect(
      rollupReadiness({
        milestones: allCompleted(),
        blockers: [],
        has_provider_dependent_open_item: true,
        has_governance_decision: true,
        has_compliance_decision: true,
      }),
    ).toBe("provider_dependent");
  });

  it("in_review when a prerequisite milestone still active", () => {
    expect(
      rollupReadiness({
        milestones: allCompleted("active"),
        blockers: [],
        has_provider_dependent_open_item: false,
        has_governance_decision: false,
        has_compliance_decision: false,
      }),
    ).toBe("in_review");
  });

  it("internally_ready when prerequisites complete + decisions present", () => {
    expect(
      rollupReadiness({
        milestones: allCompleted(),
        blockers: [],
        has_provider_dependent_open_item: false,
        has_governance_decision: true,
        has_compliance_decision: true,
      }),
    ).toBe("ready_for_finality");
  });
});

describe("roles", () => {
  it("assertRoleMatrixComplete passes", () => {
    expect(() => assertRoleMatrixComplete()).not.toThrow();
  });

  it("platform_admin can record finality, operator cannot", () => {
    expect(isActionAllowed("platform_admin", "record_finality")).toBe(true);
    expect(isActionAllowed("operator", "record_finality")).toBe(false);
  });

  it("funder_viewer has no write actions", () => {
    expect(P5B4_ROLE_ACTIONS.funder_viewer.size).toBe(0);
  });

  it("funder_approver can mark decisions but cannot record finality", () => {
    expect(isActionAllowed("funder_approver", "mark_funder_approved_internally")).toBe(true);
    expect(isActionAllowed("funder_approver", "record_finality")).toBe(false);
  });

  it("every SSOT role key has a matrix entry", () => {
    for (const r of P5B4_ROLE_KEYS) expect(P5B4_ROLE_ACTIONS[r]).toBeDefined();
  });
});

describe("permissions", () => {
  it("closed cases are read-only for non-reopen actions", () => {
    expect(
      checkCaseMutable("closed", "platform_admin", "complete_non_final_milestone").allowed,
    ).toBe(false);
  });

  it("only platform_admin may reopen", () => {
    expect(checkCaseMutable("closed", "platform_admin", "reopen_case").allowed).toBe(true);
    expect(checkCaseMutable("closed", "operator", "reopen_case").allowed).toBe(false);
  });

  it("checkFinalityAction restricts to platform_admin", () => {
    expect(checkFinalityAction("platform_admin").allowed).toBe(true);
    expect(checkFinalityAction("operator").allowed).toBe(false);
    expect(checkFinalityAction("funder_approver").allowed).toBe(false);
  });
});

describe("wording-guard", () => {
  it("flags forbidden wording", () => {
    const r = scanForbidden("This document is verified and bankable.");
    expect(r.ok).toBe(false);
    expect(r.matches).toEqual(expect.arrayContaining(["verified", "bankable"]));
  });

  it("passes safe wording", () => {
    const r = scanForbidden(P5B4_PROVIDER_DEPENDENT_SAFE_LABEL);
    expect(r.ok).toBe(true);
  });

  it("safe label is exactly Provider-Dependent", () => {
    expect(P5B4_PROVIDER_DEPENDENT_SAFE_LABEL).toBe("Provider-Dependent");
  });
});

describe("finality", () => {
  const baseInput = {
    process_type: "transaction_case" as const,
    completed_milestone_keys: new Set<typeof P5B4_MILESTONE_KEYS[number]>(
      P5B4_MILESTONE_KEYS.filter(
        (k) => !["final_approval", "finality_recorded", "closed_archived"].includes(k),
      ),
    ),
    waived_milestone_keys: new Set<typeof P5B4_MILESTONE_KEYS[number]>(),
    not_applicable_milestone_keys: new Set<typeof P5B4_MILESTONE_KEYS[number]>(),
    blockers: [] as const,
    has_final_approval: true,
    has_finality_summary: true,
    has_audit_reference: true,
  };

  it("eligible when all prerequisites met", () => {
    const r = evaluateFinality({ ...baseInput, readiness_status: "ready_for_finality" });
    expect(r.can_record_final_approval).toBe(true);
    expect(r.can_record_finality).toBe(true);
  });

  it("blocked by open hard blocker", () => {
    const r = evaluateFinality({
      ...baseInput,
      readiness_status: "blocked",
      blockers: [{ key: "missing_authority_to_act", type: "hard", status: "open" }],
    });
    expect(r.can_record_final_approval).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(["open_hard_blockers"]));
  });

  it("blocked by missing finality summary", () => {
    const r = evaluateFinality({
      ...baseInput,
      readiness_status: "ready_for_finality",
      has_finality_summary: false,
    });
    expect(r.can_record_finality).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(["missing_finality_summary"]));
  });

  it("finality actor restricted to platform_admin", () => {
    expect(isFinalityActorAllowed("platform_admin")).toBe(true);
    expect(isFinalityActorAllowed("operator")).toBe(false);
  });
});

describe("memory-summary", () => {
  it("strips forbidden fields from raw_facts", () => {
    const safe = stripSensitiveFields({
      counterparty_name: "Acme",
      bank_account_number: "12345",
      iban: "GB00X",
      passport_number: "X1",
      lessons: "ok",
    });
    expect(Object.keys(safe).sort()).toEqual(["counterparty_name", "lessons"]);
  });

  it("buildMemorySummary excludes raw evidence", () => {
    const s = buildMemorySummary({
      case_reference: "P5B4-TXN-20260625-00001",
      process_type: "transaction_case",
      final_outcome: "finality_recorded",
      completed_milestones: ["case_opened"],
      waived_milestones: [],
      resolved_blockers: [],
      funder_outcome_summary: null,
      provider_dependency_notes: null,
      lessons: ["onboarding completed"],
      raw_facts: { tax_number: "X", vat_number: "Y", note: "ok" },
    });
    expect(s.safe_facts).toEqual({ note: "ok" });
  });

  it("forbidden field list is non-empty and includes bank+id+tax", () => {
    expect(P5B4_MEMORY_FORBIDDEN_FIELDS).toEqual(
      expect.arrayContaining(["bank_account_number", "id_number", "tax_number"]),
    );
  });
});

describe("case-reference", () => {
  it("formats deterministically", () => {
    expect(
      formatCaseReference({
        process_type: "transaction_case",
        created_at: day("2026-06-25"),
        sequence: 42,
      }),
    ).toBe("P5B4-TXN-20260625-00042");
  });

  it("isCaseReference round-trips", () => {
    const ref = formatCaseReference({
      process_type: "company_onboarding",
      created_at: day("2026-01-01"),
      sequence: 1,
    });
    expect(isCaseReference(ref)).toBe(true);
    expect(isCaseReference("not-a-ref")).toBe(false);
  });

  it("prefix table covers every process type", () => {
    expect(() => assertCaseRefCovers()).not.toThrow();
    for (const t of P5B4_PROCESS_TYPES) {
      const r = formatCaseReference({ process_type: t, created_at: day("2026-06-01"), sequence: 1 });
      expect(isCaseReference(r)).toBe(true);
    }
  });
});

describe("api-fields", () => {
  it("buildApiSafeCase omits internal fields", () => {
    const safe = buildApiSafeCase({
      case_reference: "P5B4-TXN-20260625-00001",
      execution_status: "in_progress",
      current_milestone: "evidence_received",
      readiness_status: "in_review",
      blocker_count: 0,
      warning_count: 0,
      next_action: "Upload evidence",
      due_at: null,
      funder_status: null,
      finality_summary: null,
      internal_notes: "secret",
      raw_evidence: { blob: 1 },
      full_bank_number: "12345",
    });
    expect(Object.keys(safe).sort()).toEqual([...P5B4_API_SAFE_FIELDS].sort());
    expect((safe as unknown as Record<string, unknown>).internal_notes).toBeUndefined();
    expect((safe as unknown as Record<string, unknown>).full_bank_number).toBeUndefined();
  });

  it("assertNoForbiddenApiFields throws on leak", () => {
    expect(() =>
      assertNoForbiddenApiFields({ case_reference: "x", internal_notes: "leak" }, "test"),
    ).toThrow(/internal_notes/);
  });

  it("safe-field list covers exactly the documented fields", () => {
    expect(P5B4_API_SAFE_FIELDS.length).toBe(10);
  });
});
