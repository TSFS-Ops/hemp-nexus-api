/**
 * Batch 7 — Registry search / claim rules hardening.
 * Static / structural proofs only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tsRules = readFileSync("src/lib/registry-claim-rules.ts", "utf8");
const dnRules = readFileSync("supabase/functions/_shared/registry-claim-rules.ts", "utf8");
const ncrEdge = readFileSync("supabase/functions/registry-new-company-request/index.ts", "utf8");
const ccrEdge = readFileSync("supabase/functions/registry-company-correction-request/index.ts", "utf8");
const claimEdge = readFileSync("supabase/functions/registry-company-claim/index.ts", "utf8");
const outreachEdge = readFileSync("supabase/functions/registry-ai-outreach-draft/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260621145828_fa957cef-0d5b-4dc9-a645-146650dd2183.sql", "utf8");

describe("Batch 7 — claim rules SSOT parity", () => {
  const arrays = [
    "REGISTRY_CLAIMANT_ROLE_TYPES",
    "REGISTRY_CLAIM_INTEREST_STATES",
    "REGISTRY_CLAIM_CONFLICT_STATES",
    "REGISTRY_EVIDENCE_CATEGORIES",
    "REGISTRY_SEARCHABILITY_TIERS",
    "REGISTRY_VISIBILITY_TIERS",
    "REGISTRY_IMPORTED_RECORD_READINESS_STATES",
    "REGISTRY_NEW_COMPANY_REQUEST_STATES",
    "REGISTRY_CORRECTION_REQUEST_STATES",
    "REGISTRY_OUTREACH_CHANNEL_PERMISSIONS",
    "REGISTRY_BATCH7_AUDIT_EVENT_NAMES",
  ];
  for (const name of arrays) {
    it(`${name} matches between TS and Deno`, () => {
      const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
      expect(tsRules.match(re)?.[1]?.replace(/\s+/g, "")).toBe(
        dnRules.match(re)?.[1]?.replace(/\s+/g, ""),
      );
    });
  }
});

describe("Batch 7 — claim approval does NOT equal verification", () => {
  it("ssot exposes claim approval safety copy", () => {
    expect(tsRules).toContain("Claim approved. This confirms that the claim record has passed review.");
    expect(dnRules).toContain("Claim approved. This confirms that the claim record has passed review.");
  });
  it("claim edge function still requires acknowledged_not_verification", () => {
    expect(claimEdge).toContain("acknowledged_not_verification: z.literal(true)");
  });
  it("claim edge function does not flip authority/bank/profile state", () => {
    expect(claimEdge).not.toMatch(/authority_records.*update|registry_bank_detail_submissions.*update/);
  });
});

describe("Batch 7 — unregistered / email-unverified guardrails", () => {
  it("new-company request enforces email verification", () => {
    expect(ncrEdge).toContain("email_verification_required");
  });
  it("correction request enforces email verification", () => {
    expect(ccrEdge).toContain("email_verification_required");
  });
});

describe("Batch 7 — professional representative scope copy present", () => {
  it("ssot encodes 90-day default authority period", () => {
    expect(tsRules).toContain("REGISTRY_PROFESSIONAL_REPRESENTATIVE_DEFAULT_AUTHORITY_DAYS = 90");
    expect(dnRules).toContain("REGISTRY_PROFESSIONAL_REPRESENTATIVE_DEFAULT_AUTHORITY_DAYS = 90");
  });
});

describe("Batch 7 — new-company request workflow", () => {
  it("rejects approval from invalid state", () => {
    expect(ncrEdge).toContain("approval_not_allowed_from_state");
  });
  it("requires the eight minimum input fields", () => {
    for (const f of [
      "company_name", "country_code", "claimant_name", "claimant_email", "reason_for_adding",
    ]) expect(ncrEdge).toContain(f);
  });
  it("emits duplicate-check audit event on start", () => {
    expect(ncrEdge).toContain("registry_new_company_duplicate_check_started");
  });
  it("provisional record uses non-public wording", () => {
    expect(ncrEdge).toContain("REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY");
  });
});

describe("Batch 7 — correction request workflow", () => {
  it("flags sensitive fields and gates them to compliance_owner", () => {
    expect(ccrEdge).toContain("sensitive_field_requires_compliance_owner");
  });
  it("creates audit-only apply event (no direct field mutation here)", () => {
    expect(ccrEdge).toContain("registry_company_correction_applied");
    expect(ccrEdge).not.toMatch(/from\(\s*['"]registry_data_sources['"]\s*\)\.update/);
  });
});

describe("Batch 7 — outreach remains blocked without business decision", () => {
  it("outreach drafter still references existing review/DNC gating", () => {
    expect(outreachEdge).toMatch(/registry_outreach_(approvals|do_not_contact|drafts)/);
  });
});

describe("Batch 7 — migration grants and RLS present for new tables", () => {
  const tables = [
    "registry_new_company_requests",
    "registry_new_company_request_events",
    "registry_company_correction_requests",
    "registry_company_correction_events",
    "registry_claim_conflicts",
    "registry_claim_conflict_events",
    "registry_claim_interest_events",
  ];
  for (const t of tables) {
    it(`${t} has CREATE TABLE, GRANT to service_role, and ENABLE RLS`, () => {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
      expect(migration).toContain(`GRANT ALL ON public.${t} TO service_role`);
      expect(migration).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    });
  }
});
