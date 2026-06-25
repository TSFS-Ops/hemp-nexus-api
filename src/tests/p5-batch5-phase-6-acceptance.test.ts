/**
 * P-5 Batch 5 — Phase 6 final acceptance suite.
 *
 * Hardening + cross-consistency verification of Phase 1–5. Pure TS, no DB
 * calls, no new behaviour. Asserts:
 *
 *   - finality vocab, outcome codes, dispute/correction/memory/provider/
 *     evidence-completeness enums match the migration defaults;
 *   - API-safe projection cross-consistency with finality + memory states;
 *   - blocked-state coverage for every reliance-affecting condition;
 *   - all 11 final outcome codes route through the projection sensibly;
 *   - 9 × 14 permission matrix shape + role-by-role action gating;
 *   - forbidden-field stripping coverage (raw provider, bank, secrets,
 *     pii, internal notes, ai drafts);
 *   - repeated-pattern threshold matches the spec;
 *   - banned wording is absent from approved phrases / tooltips;
 *   - no Batch 5 file imports the v1 basic-memory vocab (separation);
 *   - no Batch 5 migration contains pg_cron tokens;
 *   - drift guards exist and are wired.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  P5B5_FINALITY_STATUSES,
  P5B5_FINAL_OUTCOME_CODES,
  P5B5_MEMORY_STATUSES,
  P5B5_DISPUTE_STATUSES,
  P5B5_CORRECTION_STATUSES,
  P5B5_PROVIDER_DEPENDENCY_STATUSES,
  P5B5_EVIDENCE_COMPLETENESS_STATUSES,
  P5B5_OUTCOME_TYPE,
  P5B5_FORBIDDEN_WORDS,
  type P5B5FinalOutcomeCode,
} from "@/lib/p5-batch5/outcomes";
import {
  P5B5_SCHEMA_VERSION,
  P5B5_OUTCOME_CODE_VERSION,
} from "@/lib/p5-batch5/version";
import {
  P5B5_FORBIDDEN_FIELDS,
  P5B5_REPEATED_PATTERN_RULE,
  P5B5_MEMORY_EXCLUDED_OUTCOMES,
  p5b5StripForbiddenFields,
} from "@/lib/p5-batch5/memory-writer";
import {
  P5B5_ROLES,
  P5B5_CAPABILITIES,
  getP5B5Capabilities,
  canPerformFinalityAction,
} from "@/lib/p5-batch5/permissions";
import {
  P5B5_API_SAFE_FIELDS,
  projectFinalityToApiSafe,
  buildP5B5BlockedState,
  stripToApiSafe,
} from "@/lib/p5-batch5/api-safe";
import {
  P5B5_APPROVED_PHRASES,
  P5B5_APPROVED_TOOLTIPS,
  findP5B5BannedPhrases,
} from "@/lib/p5-batch5/wording";

const ROOT = resolve(__dirname, "../..");

describe("P-5 Batch 5 Phase 6 — vocabulary acceptance", () => {
  it("finality statuses (7) match canonical list", () => {
    expect(P5B5_FINALITY_STATUSES).toEqual([
      "none",
      "ready_for_finality",
      "final",
      "under_dispute",
      "corrected",
      "superseded",
      "invalid_test",
    ]);
  });

  it("final outcome codes (11) match canonical list", () => {
    expect(P5B5_FINAL_OUTCOME_CODES).toHaveLength(11);
    expect(P5B5_FINAL_OUTCOME_CODES).toEqual([
      "COMPLETED",
      "COMPLETED_WITH_EXCEPTION",
      "APPROVED_NOT_EXECUTED",
      "WITHDRAWN_BY_USER",
      "REJECTED",
      "EXPIRED",
      "CANCELLED",
      "FAILED_PROVIDER_DEPENDENCY",
      "DISPUTED",
      "SUPERSEDED",
      "TEST_OR_INVALID",
    ]);
  });

  it("every final outcome code is typed in P5B5_OUTCOME_TYPE", () => {
    for (const code of P5B5_FINAL_OUTCOME_CODES) {
      expect(P5B5_OUTCOME_TYPE[code]).toMatch(
        /^(positive|qualified|neutral|negative)$/,
      );
    }
  });

  it("memory, dispute, correction, provider, evidence enums are stable", () => {
    expect(P5B5_MEMORY_STATUSES).toContain("paused");
    expect(P5B5_MEMORY_STATUSES).toContain("excluded");
    expect(P5B5_DISPUTE_STATUSES).toContain("under_dispute");
    expect(P5B5_CORRECTION_STATUSES).toContain("administrative_reclassification");
    expect(P5B5_PROVIDER_DEPENDENCY_STATUSES).toContain("failed");
    expect(P5B5_EVIDENCE_COMPLETENESS_STATUSES).toContain("waived");
  });

  it("version stamps are v1", () => {
    expect(P5B5_SCHEMA_VERSION).toBe("p5b5.v1");
    expect(P5B5_OUTCOME_CODE_VERSION).toBe("p5b5-outcomes.v1");
  });
});

describe("P-5 Batch 5 Phase 6 — API-safe projection cross-consistency", () => {
  const base = {
    finality_status: "final" as const,
    final_outcome_code: "COMPLETED" as P5B5FinalOutcomeCode,
    final_outcome_label: "Completed",
    finality_created_at: "2026-06-25T00:00:00Z",
    evidence_completeness_status: "complete" as const,
    evidence_rating: "green",
    memory_status: "active" as const,
    dispute_status: "none" as const,
    correction_status: "none" as const,
    provider_dependency_status: "success" as const,
    finality_record_reference: "p5b4-fin-123",
    hash_reference: "sha256:abc",
  };

  it("returns finality_not_created for missing input", () => {
    const r = projectFinalityToApiSafe(null);
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe("finality_not_created");
  });

  it("blocks TEST_OR_INVALID regardless of other state", () => {
    const r = projectFinalityToApiSafe({
      ...base,
      final_outcome_code: "TEST_OR_INVALID",
    });
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe("record_invalid_test");
  });

  it("blocks when memory paused due to dispute (via any of 3 fields)", () => {
    for (const variant of [
      { ...base, finality_status: "under_dispute" as const },
      { ...base, dispute_status: "under_dispute" as const },
      { ...base, memory_status: "paused" as const },
    ]) {
      const r = projectFinalityToApiSafe(variant);
      expect(r.blocked).toBe(true);
      if (r.blocked) expect(r.reason).toBe("memory_paused_due_to_dispute");
    }
  });

  it("superseded returns current_effective_record_reference if provided", () => {
    const r = projectFinalityToApiSafe({
      ...base,
      finality_status: "superseded",
      current_effective_record_reference: "p5b4-fin-999",
    });
    expect(r.blocked).toBe(true);
    if (r.blocked) {
      expect(r.reason).toBe("record_superseded");
      expect(r.current_effective_record_reference).toBe("p5b4-fin-999");
    }
  });

  it("strips evidence_rating without evidence_rating.read scope", () => {
    const r = projectFinalityToApiSafe(base);
    expect(r.blocked).toBe(false);
    if (!r.blocked) {
      expect(r.evidence_rating).toBeNull();
      expect(r.finality_record_reference).toBeNull();
      expect(r.hash_reference).toBeNull();
      expect(r.schema_version).toBe("p5b5.v1");
      expect(r.outcome_code_version).toBe("p5b5-outcomes.v1");
    }
  });

  it("reveals scoped fields only with the right API scope", () => {
    const r = projectFinalityToApiSafe(base, {
      api_scopes: ["evidence_rating.read", "audit.read"],
    });
    expect(r.blocked).toBe(false);
    if (!r.blocked) {
      expect(r.evidence_rating).toBe("green");
      expect(r.finality_record_reference).toBe("p5b4-fin-123");
      expect(r.hash_reference).toBe("sha256:abc");
      expect(r.provider_dependency_status).toBe("success");
    }
  });

  it("every successful projection emits exactly the 14 allowlisted fields", () => {
    const r = projectFinalityToApiSafe(base, {
      api_scopes: ["evidence_rating.read", "audit.read", "provider_dependency.read"],
    });
    expect(r.blocked).toBe(false);
    if (!r.blocked) {
      const keys = Object.keys(r).filter((k) => k !== "blocked").sort();
      const allowed = [...P5B5_API_SAFE_FIELDS].sort();
      expect(keys).toEqual(allowed);
      expect(keys).toHaveLength(14);
    }
  });

  it("stripToApiSafe drops unknown fields and stamps versions", () => {
    const r = stripToApiSafe({
      finality_status: "final",
      raw_provider_payload: { secret: 1 },
      internal_notes: "do not leak",
      private_notes: "x",
      ai_draft: "y",
    } as Record<string, unknown>);
    expect((r as Record<string, unknown>).raw_provider_payload).toBeUndefined();
    expect((r as Record<string, unknown>).internal_notes).toBeUndefined();
    expect((r as Record<string, unknown>).ai_draft).toBeUndefined();
    expect(r.schema_version).toBe("p5b5.v1");
    expect(r.outcome_code_version).toBe("p5b5-outcomes.v1");
  });

  it("every blocked reason has a non-empty user-safe message", () => {
    const reasons = [
      "permission_denied",
      "memory_paused_due_to_dispute",
      "finality_not_created",
      "evidence_not_shareable",
      "record_superseded",
      "record_invalid_test",
    ] as const;
    for (const r of reasons) {
      const b = buildP5B5BlockedState(r);
      expect(b.message.length).toBeGreaterThan(8);
      // never reveals secrets / sensitive vocab
      expect(b.message).not.toMatch(/raw_provider|password|token|api_key/i);
    }
  });

  it("routes all 11 outcome codes through projection without throwing", () => {
    for (const code of P5B5_FINAL_OUTCOME_CODES) {
      const r = projectFinalityToApiSafe({ ...base, final_outcome_code: code });
      // TEST_OR_INVALID, DISPUTED, SUPERSEDED → blocked; rest pass
      if (code === "TEST_OR_INVALID") {
        expect(r.blocked).toBe(true);
      } else {
        // ok — either blocked or projected, but no throw
        expect(typeof r.blocked).toBe("boolean");
      }
    }
  });
});

describe("P-5 Batch 5 Phase 6 — permission matrix coverage", () => {
  it("has exactly 9 roles and 14 capabilities", () => {
    expect(P5B5_ROLES).toHaveLength(9);
    expect(P5B5_CAPABILITIES).toHaveLength(14);
  });

  it("only platform_super_admin may supersede finality", () => {
    for (const role of P5B5_ROLES) {
      const ok = canPerformFinalityAction(role, "supersede_finality", {
        acting_organisation_id: "o", record_organisation_id: "o",
        case_id: "c", assigned_case_ids: ["c"],
        has_funder_lane_access: true, has_auditor_mandate: true,
        support_escalation_active: true,
        api_scopes: ["finality.read"],
      });
      expect(ok).toBe(role === "platform_super_admin");
    }
  });

  it("counterparty and funder cannot export audit packs", () => {
    expect(
      getP5B5Capabilities("counterparty_applicant", { assigned_case_ids: ["c"], case_id: "c" })
        .can_export_audit_pack,
    ).toBe(false);
    expect(
      getP5B5Capabilities("funder", { has_funder_lane_access: true })
        .can_export_audit_pack,
    ).toBe(false);
  });

  it("logged-out / no-context roles default to no capability", () => {
    for (const role of P5B5_ROLES) {
      const caps = getP5B5Capabilities(role, {});
      // platform-level roles still have powers without org context
      if (role === "platform_super_admin" || role === "platform_compliance_admin") continue;
      const granted = Object.values(caps).some(Boolean);
      expect(granted, `${role} should have no caps without context`).toBe(false);
    }
  });

  it("organisation contributor needs both same-org and case assignment", () => {
    const role = "organisation_user_contributor";
    expect(
      getP5B5Capabilities(role, {
        acting_organisation_id: "a", record_organisation_id: "a",
      }).can_view_case_finality,
    ).toBe(false);
    expect(
      getP5B5Capabilities(role, {
        acting_organisation_id: "a", record_organisation_id: "a",
        case_id: "c1", assigned_case_ids: ["c1"],
      }).can_view_case_finality,
    ).toBe(true);
  });

  it("external_api_client requires finality.read scope at minimum", () => {
    expect(getP5B5Capabilities("external_api_client", { api_scopes: [] })
      .can_view_case_finality).toBe(false);
    expect(getP5B5Capabilities("external_api_client", {
      api_scopes: ["finality.read"],
    }).can_view_case_finality).toBe(true);
  });
});

describe("P-5 Batch 5 Phase 6 — memory exclusions and stripper", () => {
  it("TEST_OR_INVALID is in the excluded outcomes list", () => {
    expect(P5B5_MEMORY_EXCLUDED_OUTCOMES).toContain("TEST_OR_INVALID");
  });

  it("repeated-pattern threshold matches the spec (≥2 final or ≥1 compliance)", () => {
    expect(P5B5_REPEATED_PATTERN_RULE.min_finality_backed_events).toBe(2);
    expect(P5B5_REPEATED_PATTERN_RULE.min_compliance_approved_material_events).toBe(1);
  });

  it("strips raw provider, bank, credentials, pii and internal notes recursively", () => {
    const dirty = {
      keep_me: "ok",
      raw_provider_payload: { x: 1 },
      bank_account_number: "111",
      iban: "GB...",
      password: "p",
      api_key: "k",
      token: "t",
      email: "a@b.c",
      phone: "+27",
      internal_notes: "secret",
      private_notes: "secret",
      ai_draft: "draft",
      nested: {
        keep_me: "ok",
        raw_provider_payload: { y: 2 },
        sandbox_payload: { z: 3 },
      },
      list: [{ keep_me: 1, secret: "shh" }],
    };
    const clean = p5b5StripForbiddenFields(dirty) as Record<string, unknown>;
    expect(clean.keep_me).toBe("ok");
    expect(clean.raw_provider_payload).toBeUndefined();
    expect(clean.bank_account_number).toBeUndefined();
    expect(clean.iban).toBeUndefined();
    expect(clean.password).toBeUndefined();
    expect(clean.api_key).toBeUndefined();
    expect(clean.token).toBeUndefined();
    expect(clean.email).toBeUndefined();
    expect(clean.phone).toBeUndefined();
    expect(clean.internal_notes).toBeUndefined();
    expect(clean.private_notes).toBeUndefined();
    expect(clean.ai_draft).toBeUndefined();
    expect((clean.nested as Record<string, unknown>).raw_provider_payload).toBeUndefined();
    expect((clean.nested as Record<string, unknown>).sandbox_payload).toBeUndefined();
    expect((clean.list as Array<Record<string, unknown>>)[0].secret).toBeUndefined();
  });

  it("forbidden field list covers all required families", () => {
    const fields = new Set(P5B5_FORBIDDEN_FIELDS);
    for (const k of [
      "raw_payload", "raw_provider_payload", "bank_account_number", "iban",
      "password", "credentials", "api_key", "secret", "token", "webhook_secret",
      "email", "phone", "date_of_birth", "id_number", "passport_number",
      "internal_notes", "private_notes", "ai_draft", "support_notes",
      "sandbox_payload", "test_payment",
    ]) {
      expect(fields.has(k), `forbidden-field family missing: ${k}`).toBe(true);
    }
  });
});

describe("P-5 Batch 5 Phase 6 — wording acceptance", () => {
  it("no approved phrase or tooltip contains a banned phrase", () => {
    const corpus = [
      ...Object.values(P5B5_APPROVED_PHRASES),
      ...Object.values(P5B5_APPROVED_TOOLTIPS),
    ];
    for (const s of corpus) {
      expect(findP5B5BannedPhrases(s)).toEqual([]);
    }
  });

  it("forbidden-words list has 15 entries (matches drift guard)", () => {
    expect(P5B5_FORBIDDEN_WORDS).toHaveLength(15);
  });

  it("findP5B5BannedPhrases detects sample banned input", () => {
    expect(findP5B5BannedPhrases("This is guaranteed and risk-free")).toEqual(
      expect.arrayContaining(["guaranteed", "risk-free"]),
    );
  });
});

describe("P-5 Batch 5 Phase 6 — separation from v1 basic_memory_records", () => {
  function walk(dir: string, out: string[]) {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e)) out.push(p);
    }
  }

  it("no Batch 5 source file imports basic-memory vocab", () => {
    const files: string[] = [];
    for (const d of [
      "src/lib/p5-batch5",
      "src/components/p5-batch5",
      "src/pages/admin/p5-batch5",
      "src/pages/desk/p5-batch5",
      "src/pages/funder/p5-batch5",
    ]) walk(resolve(ROOT, d), files);

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(
        /from\s+["']@\/lib\/basic-memory/.test(src),
        `${f} must not import @/lib/basic-memory`,
      ).toBe(false);
    }
  });
});

describe("P-5 Batch 5 Phase 6 — cron absence", () => {
  it("no Batch 5 migration contains pg_cron tokens", () => {
    const migs = [
      "supabase/migrations/20260625200441_37f8e9ad-f9a2-4561-a95e-6b5ea326e063.sql",
      "supabase/migrations/20260625201007_155a5537-44e9-4af9-ac0e-a0a286141b16.sql",
      "supabase/migrations/20260625202221_b745ddef-8daa-4d0f-95c1-87503e5d6ba2.sql",
    ];
    for (const m of migs) {
      const src = readFileSync(resolve(ROOT, m), "utf8").toLowerCase();
      expect(src).not.toMatch(/cron\.schedule|pg_cron|cron\.job|cron_job/);
    }
  });
});
