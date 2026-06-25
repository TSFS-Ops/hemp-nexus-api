/**
 * P-5 Batch 4 Stage 7 — closeout contract tests.
 *
 * Pure-logic / static contract checks for:
 *   - notification router (internal vs external)
 *   - report builders (audience field allowlists)
 *   - finality bridge (opt-in, admin-recorded only)
 *   - readiness/Memory bridge (sensitive-field strip)
 *   - SLA monitor edge function (internal-key gated, idempotency probe)
 *   - presence of Stage 7 / final consistency guards
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  buildMilestoneNotification,
  buildBlockerNotification,
  buildFunderNotification,
  assertExternalPayloadSafe,
  defaultAudiencesFor,
  isInternalAudience,
} from "@/lib/p5-batch4/notifications";
import {
  buildReport,
  assertReportSafe,
  projectReportRow,
  buildPdfStub,
  P5B4_REPORT_FIELDS,
} from "@/lib/p5-batch4/reports";
import { evaluateFinalityBridge } from "@/lib/p5-batch4/finality-bridge";
import { evaluateMemoryBridge } from "@/lib/p5-batch4/memory-bridge";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Stage 7 — notifications router", () => {
  it("distinguishes internal vs external audiences", () => {
    expect(isInternalAudience("internal_admin")).toBe(true);
    expect(isInternalAudience("external_funder")).toBe(false);
  });

  it("never leaks internal_detail to external audience", () => {
    const p = buildMilestoneNotification({
      audience: "external_org_user",
      case_reference: "CASE-1",
      milestone_key: "evidence_received",
      kind: "milestone_overdue",
      internal_detail: "internal_note: provider failed",
    });
    expect(p.body).not.toMatch(/internal_note/);
    expect(p.body).not.toMatch(/provider failed/);
    assertExternalPayloadSafe(p, "test");
  });

  it("substitutes forbidden provider wording with safe label", () => {
    const p = buildBlockerNotification({
      audience: "external_funder",
      case_reference: "CASE-2",
      blocker_key: "provider_failed_result",
      kind: "blocker_opened",
      internal_detail: "verified by upstream",
    });
    expect(p.title.toLowerCase()).not.toContain("verified");
    assertExternalPayloadSafe(p, "test");
  });

  it("funder release routes to funder + admin only", () => {
    const aud = defaultAudiencesFor("funder_release", "platform_admin");
    expect(aud).toContain("external_funder");
    expect(aud).toContain("internal_admin");
    expect(aud).not.toContain("external_counterparty");
  });

  it("funder_decision is internal-only", () => {
    const aud = defaultAudiencesFor("funder_decision", "platform_admin");
    expect(aud.every(isInternalAudience)).toBe(true);
  });

  it("funder notification does not leak finality wording externally", () => {
    const p = buildFunderNotification({
      audience: "external_funder",
      case_reference: "CASE-3",
      status: "released",
      kind: "funder_release",
    });
    assertExternalPayloadSafe(p, "test");
  });
});

describe("Stage 7 — report builders", () => {
  const row = {
    case_reference: "CASE-X",
    process_type: "transaction_case",
    execution_status: "in_progress" as const,
    readiness_status: "in_review" as const,
    current_milestone: "evidence_received" as const,
    blocker_count: 1,
    warning_count: 0,
    due_at: "2026-07-01T00:00:00Z",
    funder_status: null,
    finality_status: "internal_only_finality_pending",
    provider_dependency_status: "provider_pending",
    owner_user_id: "00000000-0000-0000-0000-000000000001",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    internal_notes: "should never appear",
    raw_evidence: { secret: 1 },
    bank_account_number: "1234",
  };

  it("admin report keeps owner/finality fields but drops forbidden", () => {
    const out = projectReportRow("admin", row);
    expect(out).toHaveProperty("owner_user_id");
    expect(out).toHaveProperty("finality_status");
    expect(out).not.toHaveProperty("internal_notes");
    expect(out).not.toHaveProperty("raw_evidence");
    expect(out).not.toHaveProperty("bank_account_number");
  });

  it("org_user report strips admin/finality fields", () => {
    const out = projectReportRow("org_user", row);
    expect(out).not.toHaveProperty("owner_user_id");
    expect(out).not.toHaveProperty("finality_status");
    expect(out).not.toHaveProperty("provider_dependency_status");
    expect(out).not.toHaveProperty("funder_status");
  });

  it("funder report strips admin/finality but keeps funder_status", () => {
    const out = projectReportRow("funder", row);
    expect(out).not.toHaveProperty("owner_user_id");
    expect(out).not.toHaveProperty("finality_status");
    expect(out).toHaveProperty("funder_status");
  });

  it("api report uses API_SAFE_FIELDS allowlist", () => {
    const out = projectReportRow("api", row);
    for (const k of Object.keys(out)) {
      expect(P5B4_REPORT_FIELDS.api).toContain(k);
    }
  });

  it("assertReportSafe accepts compliant rows", () => {
    const rows = buildReport("funder", [row]);
    expect(() => assertReportSafe("funder", rows, "test")).not.toThrow();
  });

  it("PDF stub is clearly labelled non-PDF", () => {
    const s = buildPdfStub("admin", "CASE-X", 3);
    expect(s.is_stub).toBe(true);
    expect(s.notice.toLowerCase()).toContain("not a pdf");
  });
});

describe("Stage 7 — finality bridge", () => {
  const baseOk = {
    enable_bridge: true,
    has_admin_recorded_finality: true,
    final_outcome: "finality_recorded" as const,
    finality_summary: "Closed under terms agreed.",
    approval_reference: "APR-1",
    audit_reference: "AUD-1",
    actor_role: "platform_admin" as const,
  };

  it("denies mirror when bridge disabled", () => {
    const r = evaluateFinalityBridge({ ...baseOk, enable_bridge: false });
    expect(r.mirror_allowed).toBe(false);
    expect(r.reasons).toContain("bridge_disabled");
  });

  it("denies mirror when finality not admin-recorded", () => {
    const r = evaluateFinalityBridge({ ...baseOk, has_admin_recorded_finality: false });
    expect(r.mirror_allowed).toBe(false);
    expect(r.reasons).toContain("finality_not_recorded_by_admin");
  });

  it("denies mirror when actor is not platform_admin", () => {
    const r = evaluateFinalityBridge({ ...baseOk, actor_role: "operator" });
    expect(r.mirror_allowed).toBe(false);
    expect(r.reasons).toContain("actor_not_platform_admin");
  });

  it("allows mirror when every condition met", () => {
    const r = evaluateFinalityBridge(baseOk);
    expect(r.mirror_allowed).toBe(true);
    expect(r.mirrored_outcome).toBe("finality_recorded");
  });
});

describe("Stage 7 — memory bridge", () => {
  const ok = {
    enable_bridge: true,
    has_admin_recorded_finality: true,
    readiness_status: "ready_for_finality" as const,
    actor_role: "platform_admin" as const,
    memory: {
      case_reference: "CASE-Y",
      process_type: "transaction_case",
      final_outcome: "finality_recorded" as const,
      completed_milestones: [],
      waived_milestones: [],
      resolved_blockers: [],
      funder_outcome_summary: null,
      provider_dependency_notes: null,
      lessons: [],
      raw_facts: {
        bank_account_number: "1234",
        passport_number: "P1",
        deal_size: 100_000,
      },
    },
  };

  it("strips sensitive fields from raw_facts", () => {
    const r = evaluateMemoryBridge(ok);
    expect(r.bridge_allowed).toBe(true);
    expect(r.payload!.safe_facts).not.toHaveProperty("bank_account_number");
    expect(r.payload!.safe_facts).not.toHaveProperty("passport_number");
    expect(r.payload!.safe_facts).toHaveProperty("deal_size");
  });

  it("denies when readiness not bridge-eligible", () => {
    const r = evaluateMemoryBridge({ ...ok, readiness_status: "in_review" });
    expect(r.bridge_allowed).toBe(false);
    expect(r.reasons).toContain("readiness_not_bridge_eligible");
  });

  it("denies when finality not admin-recorded", () => {
    const r = evaluateMemoryBridge({ ...ok, has_admin_recorded_finality: false });
    expect(r.bridge_allowed).toBe(false);
  });
});

describe("Stage 7 — SLA monitor edge function shape", () => {
  const fn = "supabase/functions/p5-batch4-sla-monitor/index.ts";
  it("exists", () => expect(existsSync(join(ROOT, fn))).toBe(true));
  it("is internal-key gated", () => {
    const t = read(fn);
    expect(t).toMatch(/INTERNAL_CRON_KEY/);
    expect(t).toMatch(/x-internal-cron-key/);
    expect(t).toMatch(/403/);
  });
  it("performs idempotency probe via audit events", () => {
    const t = read(fn);
    expect(t).toMatch(/p5_batch4_audit_events/);
    expect(t).toMatch(/p5b4_record_audit_event_v1/);
  });
});

describe("Stage 7 — closeout guards present", () => {
  it("stage 7 isolation guard exists", () => {
    expect(existsSync(join(ROOT, "scripts/check-p5-batch4-stage7-isolation.mjs"))).toBe(true);
  });
  it("final consistency guard exists", () => {
    expect(existsSync(join(ROOT, "scripts/check-p5-batch4-final-consistency.mjs"))).toBe(true);
  });
});
