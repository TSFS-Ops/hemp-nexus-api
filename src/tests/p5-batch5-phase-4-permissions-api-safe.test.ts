/**
 * P-5 Batch 5 — Phase 4 tests
 * Permission matrix + API-safe projection + blocked-state helpers.
 */
import { describe, it, expect } from "vitest";
import {
  P5B5_CAPABILITIES,
  P5B5_ROLES,
  canExportP5B5,
  canPerformFinalityAction,
  canViewFinality,
  canViewMemory,
  getP5B5Capabilities,
  type P5B5Role,
} from "@/lib/p5-batch5/permissions";
import {
  P5B5_API_SAFE_FIELDS,
  buildP5B5BlockedState,
  projectFinalityToApiSafe,
  stripToApiSafe,
  type P5B5ApiSafeProjection,
  type P5B5BlockedState,
} from "@/lib/p5-batch5/api-safe";
import {
  P5B5_OUTCOME_CODE_VERSION,
  P5B5_SCHEMA_VERSION,
} from "@/lib/p5-batch5/version";

function asProjection(
  out: P5B5ApiSafeProjection | P5B5BlockedState,
): P5B5ApiSafeProjection {
  if (out.blocked) throw new Error("expected projection, got blocked: " + out.reason);
  return out as P5B5ApiSafeProjection;
}
function asBlocked(
  out: P5B5ApiSafeProjection | P5B5BlockedState,
): P5B5BlockedState {
  if (!out.blocked) throw new Error("expected blocked state");
  return out as P5B5BlockedState;
}


const SAME_ORG = { acting_organisation_id: "o1", record_organisation_id: "o1" };
const DIFF_ORG = { acting_organisation_id: "o1", record_organisation_id: "o2" };
const ASSIGNED = { case_id: "c1", assigned_case_ids: ["c1"] };

describe("p5-batch5 phase 4 — permission matrix shape", () => {
  it("has 9 roles and 14 capabilities", () => {
    expect(P5B5_ROLES.length).toBe(9);
    expect(P5B5_CAPABILITIES.length).toBe(14);
  });

  it("every role returns a full capability object (no missing keys)", () => {
    for (const r of P5B5_ROLES) {
      const caps = getP5B5Capabilities(r, { has_auditor_mandate: true });
      for (const c of P5B5_CAPABILITIES) {
        expect(typeof caps[c]).toBe("boolean");
      }
    }
  });
});

describe("p5-batch5 phase 4 — per-role capability checks", () => {
  it("platform super admin has full powers including supersede", () => {
    const c = getP5B5Capabilities("platform_super_admin");
    for (const k of P5B5_CAPABILITIES) expect(c[k]).toBe(true);
  });

  it("platform compliance admin has every power except supersede", () => {
    const c = getP5B5Capabilities("platform_compliance_admin");
    expect(c.can_supersede_finality).toBe(false);
    expect(c.can_view_full_memory).toBe(true);
    expect(c.can_export_audit_pack).toBe(true);
  });

  it("organisation owner sees org memory only on their own organisation", () => {
    expect(getP5B5Capabilities("organisation_owner_admin", DIFF_ORG)).toEqual(
      getP5B5Capabilities("organisation_owner_admin", {}),
    );
    expect(getP5B5Capabilities("organisation_owner_admin", DIFF_ORG).can_view_org_memory).toBe(false);
    expect(getP5B5Capabilities("organisation_owner_admin", SAME_ORG).can_view_org_memory).toBe(true);
    // No correction / supersede / audit pack power
    const own = getP5B5Capabilities("organisation_owner_admin", SAME_ORG);
    expect(own.can_add_correction).toBe(false);
    expect(own.can_supersede_finality).toBe(false);
    expect(own.can_export_audit_pack).toBe(false);
  });

  it("organisation user requires both org match and case assignment", () => {
    const ctx = { ...SAME_ORG, ...ASSIGNED };
    expect(getP5B5Capabilities("organisation_user_contributor", ctx).can_view_case_finality).toBe(true);
    expect(getP5B5Capabilities("organisation_user_contributor", SAME_ORG).can_view_case_finality).toBe(false);
    expect(getP5B5Capabilities("organisation_user_contributor", { ...DIFF_ORG, ...ASSIGNED }).can_view_case_finality).toBe(false);
  });

  it("organisation user cannot view other organisations' memory", () => {
    const caps = getP5B5Capabilities("organisation_user_contributor", {
      acting_organisation_id: "o1",
      record_organisation_id: "o2",
      case_id: "c1",
      assigned_case_ids: ["c1"],
    });
    expect(caps.can_view_org_memory).toBe(false);
    expect(caps.can_view_full_memory).toBe(false);
  });

  it("counterparty applicant only sees finality + can mark dispute, never exports", () => {
    const c = getP5B5Capabilities("counterparty_applicant", ASSIGNED);
    expect(c.can_view_case_finality).toBe(true);
    expect(c.can_mark_dispute).toBe(true);
    expect(c.can_export_finality_summary).toBe(false);
    expect(c.can_view_org_memory).toBe(false);
    expect(c.can_view_full_memory).toBe(false);
  });

  it("funder sees only their funder lane when access is granted", () => {
    expect(getP5B5Capabilities("funder", {}).can_view_funder_lane).toBe(false);
    const c = getP5B5Capabilities("funder", { has_funder_lane_access: true });
    expect(c.can_view_funder_lane).toBe(true);
    expect(c.can_view_case_finality).toBe(true);
    expect(c.can_view_full_memory).toBe(false);
    expect(c.can_view_org_memory).toBe(false);
    expect(c.can_add_correction).toBe(false);
  });

  it("external API client sees only scoped fields", () => {
    expect(getP5B5Capabilities("external_api_client", {}).can_view_case_finality).toBe(false);
    const base = getP5B5Capabilities("external_api_client", {
      api_scopes: ["finality.read"],
    });
    expect(base.can_view_case_finality).toBe(true);
    expect(base.can_view_raw_provider_summary).toBe(false);
    expect(base.can_view_funder_lane).toBe(false);

    const full = getP5B5Capabilities("external_api_client", {
      api_scopes: ["finality.read", "provider_dependency.read", "funder_lane.read"],
    });
    expect(full.can_view_raw_provider_summary).toBe(true);
    expect(full.can_view_funder_lane).toBe(true);
    // never has memory / correction / dispute powers
    expect(full.can_view_full_memory).toBe(false);
    expect(full.can_view_org_memory).toBe(false);
    expect(full.can_add_correction).toBe(false);
    expect(full.can_resolve_dispute).toBe(false);
  });

  it("auditor requires a mandate; no create / correction / dispute powers", () => {
    expect(getP5B5Capabilities("auditor_regulator_legal", {}).can_view_full_memory).toBe(false);
    const c = getP5B5Capabilities("auditor_regulator_legal", { has_auditor_mandate: true });
    expect(c.can_view_full_memory).toBe(true);
    expect(c.can_export_audit_pack).toBe(true);
    expect(c.can_create_finality).toBe(false);
    expect(c.can_add_correction).toBe(false);
    expect(c.can_supersede_finality).toBe(false);
  });

  it("support user only during escalation; never exports / corrections / disputes", () => {
    expect(getP5B5Capabilities("support_user", {}).can_view_case_finality).toBe(false);
    const c = getP5B5Capabilities("support_user", { support_escalation_active: true });
    expect(c.can_view_case_finality).toBe(true);
    expect(c.can_export_finality_summary).toBe(false);
    expect(c.can_export_audit_pack).toBe(false);
    expect(c.can_add_correction).toBe(false);
    expect(c.can_mark_dispute).toBe(false);
    expect(c.can_resolve_dispute).toBe(false);
    expect(c.can_supersede_finality).toBe(false);
  });
});

describe("p5-batch5 phase 4 — typed helpers", () => {
  it("canViewFinality / canViewMemory are consistent with the matrix", () => {
    expect(canViewFinality("platform_super_admin")).toBe(true);
    expect(canViewFinality("external_api_client", { api_scopes: ["finality.read"] })).toBe(true);
    expect(canViewMemory("platform_super_admin")).toBe(true);
    expect(canViewMemory("funder", { has_funder_lane_access: true })).toBe(false);
    expect(canViewMemory("external_api_client", { api_scopes: ["finality.read"] })).toBe(false);
  });

  it("canPerformFinalityAction enforces super-admin only for supersede", () => {
    expect(canPerformFinalityAction("platform_super_admin", "supersede_finality")).toBe(true);
    expect(canPerformFinalityAction("platform_compliance_admin", "supersede_finality")).toBe(false);
    expect(canPerformFinalityAction("counterparty_applicant", "mark_dispute", ASSIGNED)).toBe(true);
    expect(canPerformFinalityAction("support_user", "mark_dispute", { support_escalation_active: true })).toBe(false);
  });

  it("canExportP5B5 reflects export flags", () => {
    expect(canExportP5B5("platform_super_admin", "audit_pack")).toBe(true);
    expect(canExportP5B5("auditor_regulator_legal", "audit_pack", { has_auditor_mandate: true })).toBe(true);
    expect(canExportP5B5("organisation_owner_admin", "audit_pack", SAME_ORG)).toBe(false);
    expect(canExportP5B5("support_user", "finality_summary", { support_escalation_active: true })).toBe(false);
  });

  it("unsupported / synthetic role names get no capabilities", () => {
    const caps = getP5B5Capabilities("not_a_role" as unknown as P5B5Role);
    for (const c of P5B5_CAPABILITIES) expect(caps[c]).toBe(false);
  });
});

// ---------------- API-safe projection ----------------

const BASE_INPUT = {
  finality_status: "final" as const,
  final_outcome_code: "COMPLETED" as const,
  final_outcome_label: "Completed",
  finality_created_at: "2026-06-25T00:00:00Z",
  evidence_completeness_status: "complete" as const,
  evidence_rating: "A",
  memory_status: "active" as const,
  dispute_status: "none" as const,
  correction_status: "none" as const,
  provider_dependency_status: "success" as const,
  finality_record_reference: "fr_123",
  hash_reference: "sha256:abc",
};

describe("p5-batch5 phase 4 — API-safe projection allowlist", () => {
  it("strict allowlist drops unknown fields", () => {
    const out = projectFinalityToApiSafe({
      ...BASE_INPUT,
      raw_payload: { x: 1 },
      private_notes: "do not leak",
      bank_account_number: "1234",
      api_key: "sk_x",
      support_notes: "n",
      scoring_formula: "secret",
      unverified_allegation: "x",
    } as never, { api_scopes: ["finality.read", "evidence_rating.read", "audit.read", "provider_dependency.read"] });
    const p = asProjection(out);
    expect(Object.keys(out).sort()).toEqual([
      "blocked",
      ...P5B5_API_SAFE_FIELDS,
    ].sort());
  });

  it("evidence_rating is hidden without evidence_rating.read scope", () => {
    const out = projectFinalityToApiSafe(BASE_INPUT, {
      api_scopes: ["finality.read"],
    });
    const p = asProjection(out);
    expect(p.evidence_rating).toBeNull();
  });

  it("hash + finality_record_reference are hidden without audit.read scope", () => {
    const out = projectFinalityToApiSafe(BASE_INPUT, {
      api_scopes: ["finality.read"],
    });
    const p = asProjection(out);
    expect(p.hash_reference).toBeNull();
    expect(p.finality_record_reference).toBeNull();
  });

  it("provider_dependency_status is hidden without scope", () => {
    const out = projectFinalityToApiSafe(BASE_INPUT, {
      api_scopes: ["finality.read"],
    });
    const p = asProjection(out);
    expect(p.provider_dependency_status).toBeNull();
  });

  it("audit.read implies provider_dependency visibility", () => {
    const out = projectFinalityToApiSafe(BASE_INPUT, {
      api_scopes: ["finality.read", "audit.read"],
    });
    const p = asProjection(out);
    expect(p.provider_dependency_status).toBe("success");
  });

  it("always stamps schema_version and outcome_code_version", () => {
    const out = projectFinalityToApiSafe(BASE_INPUT, {
      api_scopes: ["finality.read"],
    });
    const p = asProjection(out);
    expect(p.schema_version).toBe(P5B5_SCHEMA_VERSION);
    expect(p.outcome_code_version).toBe(P5B5_OUTCOME_CODE_VERSION);
  });

  it("stripToApiSafe removes unknown keys and stamps versions", () => {
    const out = stripToApiSafe({
      finality_status: "final",
      final_outcome_code: "COMPLETED",
      raw_payload: { x: 1 },
      private_notes: "leak",
      api_key: "sk",
    });
    expect(out).not.toHaveProperty("raw_payload");
    expect(out).not.toHaveProperty("private_notes");
    expect(out).not.toHaveProperty("api_key");
    expect(out.schema_version).toBe(P5B5_SCHEMA_VERSION);
    expect(out.outcome_code_version).toBe(P5B5_OUTCOME_CODE_VERSION);
  });
});

describe("p5-batch5 phase 4 — blocked-state behaviour", () => {
  it("missing finality returns finality_not_created", () => {
    const a = projectFinalityToApiSafe(null);
    const b = projectFinalityToApiSafe({ finality_status: "none" });
    expect(a.blocked && a.reason).toBe("finality_not_created");
    expect(b.blocked && b.reason).toBe("finality_not_created");
  });

  it("TEST_OR_INVALID returns record_invalid_test", () => {
    const out = projectFinalityToApiSafe({
      ...BASE_INPUT,
      final_outcome_code: "TEST_OR_INVALID",
    });
    expect(out.blocked && out.reason).toBe("record_invalid_test");
  });

  it("under_dispute / paused memory return memory_paused_due_to_dispute", () => {
    const a = projectFinalityToApiSafe({
      ...BASE_INPUT,
      finality_status: "under_dispute",
    });
    const b = projectFinalityToApiSafe({
      ...BASE_INPUT,
      dispute_status: "under_dispute",
    });
    const c = projectFinalityToApiSafe({
      ...BASE_INPUT,
      memory_status: "paused",
    });
    expect(a.blocked && a.reason).toBe("memory_paused_due_to_dispute");
    expect(b.blocked && b.reason).toBe("memory_paused_due_to_dispute");
    expect(c.blocked && c.reason).toBe("memory_paused_due_to_dispute");
  });

  it("superseded finality returns record_superseded and includes current effective ref when present", () => {
    const out = projectFinalityToApiSafe({
      ...BASE_INPUT,
      finality_status: "superseded",
      current_effective_record_reference: "fr_999",
    });
    expect(out.blocked && out.reason).toBe("record_superseded");
    const b = asBlocked(out);
    expect(b.current_effective_record_reference).toBe("fr_999");
  });

  it("blocked states never leak evidence, notes or internal fields", () => {
    const out = projectFinalityToApiSafe({
      ...BASE_INPUT,
      finality_status: "under_dispute",
      // these should not leak into the blocked state response
      private_notes: "internal",
      raw_payload: { x: 1 },
      bank_account_number: "1234",
    } as never);
    if (!out.blocked) throw new Error("expected blocked");
    expect(Object.keys(out).sort()).toEqual(
      ["blocked", "reason", "message", "schema_version", "outcome_code_version"].sort(),
    );
  });

  it("buildP5B5BlockedState always stamps versions", () => {
    const out = buildP5B5BlockedState("permission_denied");
    expect(out.schema_version).toBe(P5B5_SCHEMA_VERSION);
    expect(out.outcome_code_version).toBe(P5B5_OUTCOME_CODE_VERSION);
    expect(out.message.length).toBeGreaterThan(0);
  });
});
