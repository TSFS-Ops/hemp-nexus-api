/**
 * DATA-009 Phase 2 — review workflow contract tests.
 *
 * These tests pin the policy contract (audit names, min reason length,
 * approve/decline warning copy, no-technical-side-effect token set,
 * guard wiring across the 7 chokepoints) without needing a live
 * Supabase project. End-to-end RPC behaviour is covered by the
 * migration's CHECK constraints + the prebuild guards.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DATA_RESIDENCY_REQUIREMENT_DETECTED,
  DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED,
  DATA_RESIDENCY_EXCEPTION_APPROVED,
  DATA_RESIDENCY_EXCEPTION_DECLINED,
  DATA_RESIDENCY_POLICY_PHASE,
  RESIDENCY_ADMIN_REASON_MIN_LENGTH,
  RESIDENCY_DECISION_WARNING_COPY,
} from "@/lib/policy/data-residency-policy";

const CHOKEPOINTS = [
  "supabase/functions/export-prepare/index.ts",
  "supabase/functions/export-download/index.ts",
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
  "supabase/functions/collapse/index.ts",
  "supabase/functions/deal-certificate/index.ts",
  "supabase/functions/evidence-pack/index.ts",
];

const FORBIDDEN_TECHNICAL_TOKENS = [
  "region_migrate", "region-migrate",
  "backup_policy", "backup-policy",
  "sovereign_host", "sovereign-host",
  "residency_migrate", "residency-migrate",
  "storage_relocate", "storage-relocate",
];

describe("DATA-009 Phase 2 — policy SSOT", () => {
  it("phase indicator is 2", () => {
    expect(DATA_RESIDENCY_POLICY_PHASE).toBe(2);
  });
  it("admin reason min length is 20", () => {
    expect(RESIDENCY_ADMIN_REASON_MIN_LENGTH).toBe(20);
  });
  it("declares all 4 canonical audit names", () => {
    expect(DATA_RESIDENCY_REQUIREMENT_DETECTED).toBe("data.residency_requirement_detected");
    expect(DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED).toBe("data.unapproved_residency_claim_blocked");
    expect(DATA_RESIDENCY_EXCEPTION_APPROVED).toBe("data.residency_exception_approved");
    expect(DATA_RESIDENCY_EXCEPTION_DECLINED).toBe("data.residency_exception_declined");
  });
  it("approval warning copy explicitly disclaims technical side effects", () => {
    expect(RESIDENCY_DECISION_WARNING_COPY).toMatch(/policy exception only/i);
    expect(RESIDENCY_DECISION_WARNING_COPY).toMatch(/does NOT create any technical hosting/);
    expect(RESIDENCY_DECISION_WARNING_COPY).toMatch(/region migration/);
    expect(RESIDENCY_DECISION_WARNING_COPY).toMatch(/backup restriction/);
    expect(RESIDENCY_DECISION_WARNING_COPY).toMatch(/export restriction/);
    expect(RESIDENCY_DECISION_WARNING_COPY).toMatch(/deletion behaviour/);
  });
});

describe("DATA-009 Phase 2 — guard coverage on chokepoints", () => {
  for (const f of CHOKEPOINTS) {
    it(`${f} imports the residency guard`, () => {
      const src = readFileSync(f, "utf8");
      const hasImport =
        src.includes("residency-claim-guard") || src.includes("residency-entry");
      expect(hasImport, `expected residency guard import in ${f}`).toBe(true);
    });
  }
});

describe("DATA-009 Phase 2 — no technical side effects in shipped code", () => {
  it("shared guard module does not perform region/storage/backup mutation", () => {
    const guard = readFileSync("supabase/functions/_shared/residency-claim-guard.ts", "utf8");
    for (const t of FORBIDDEN_TECHNICAL_TOKENS) {
      expect(guard.includes(t), `forbidden token ${t} found in residency-claim-guard.ts`).toBe(false);
    }
  });
  it("approve edge function does not call any technical migration token", () => {
    const fn = readFileSync("supabase/functions/admin-residency-review-approve/index.ts", "utf8");
    for (const t of FORBIDDEN_TECHNICAL_TOKENS) {
      expect(fn.includes(t)).toBe(false);
    }
  });
  it("decline edge function does not call any technical migration token", () => {
    const fn = readFileSync("supabase/functions/admin-residency-review-decline/index.ts", "utf8");
    for (const t of FORBIDDEN_TECHNICAL_TOKENS) {
      expect(fn.includes(t)).toBe(false);
    }
  });
});

describe("DATA-009 Phase 2 — edge function error contract", () => {
  const approve = readFileSync("supabase/functions/admin-residency-review-approve/index.ts", "utf8");
  const decline = readFileSync("supabase/functions/admin-residency-review-decline/index.ts", "utf8");
  const request = readFileSync("supabase/functions/residency-review-request/index.ts", "utf8");

  it("approve enforces platform_admin", () => {
    expect(approve).toMatch(/NOT_PLATFORM_ADMIN/);
  });
  it("approve enforces AAL2 via assertAal2", () => {
    expect(approve).toMatch(/assertAal2/);
  });
  it("approve enforces reason >= min length via Zod schema", () => {
    expect(approve).toMatch(/RESIDENCY_ADMIN_REASON_MIN_LENGTH/);
    expect(approve).toMatch(/REASON_REQUIRED/);
  });
  it("approve returns stable REVIEW_NOT_FOUND / REVIEW_ALREADY_DECIDED codes", () => {
    expect(approve).toMatch(/REVIEW_NOT_FOUND/);
    expect(approve).toMatch(/REVIEW_ALREADY_DECIDED/);
  });
  it("decline mirrors the same contract", () => {
    expect(decline).toMatch(/NOT_PLATFORM_ADMIN/);
    expect(decline).toMatch(/assertAal2/);
    expect(decline).toMatch(/RESIDENCY_ADMIN_REASON_MIN_LENGTH/);
    expect(decline).toMatch(/REVIEW_NOT_FOUND/);
    expect(decline).toMatch(/REVIEW_ALREADY_DECIDED/);
  });
  it("request endpoint surfaces RESIDENCY_REVIEW_PENDING", () => {
    expect(request).toMatch(/RESIDENCY_REVIEW_PENDING/);
  });
});

describe("DATA-009 Phase 2 — migration contract", () => {
  it("creates data_residency_reviews with all required Phase 2 columns and unique open-review index", () => {
    // Find the migration file containing the table definition.
    const fs = require("node:fs") as typeof import("node:fs");
    const files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    const hit = files
      .map((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8"))
      .find((s) => s.includes("CREATE TABLE IF NOT EXISTS public.data_residency_reviews"));
    expect(hit, "DATA-009 Phase 2 migration file not found").toBeTruthy();
    const sql = hit as string;
    for (const col of [
      "requirement_source", "requested_region", "requested_country", "legal_basis",
      "status", "decision_reason", "reviewed_by", "reviewed_at", "expires_at", "metadata",
    ]) {
      expect(sql.includes(col), `missing column ${col}`).toBe(true);
    }
    expect(sql).toMatch(/uniq_open_residency_review_per_org/);
    expect(sql).toMatch(/onboarding_hold_reason/);
    expect(sql).toMatch(/onboarding_hold_review_id/);
    // SECDEF RPCs locked to service_role
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.request_residency_review.*TO service_role/s);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.approve_residency_review.*TO service_role/s);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.decline_residency_review.*TO service_role/s);
    // Rewired set_org_data_residency emits unapproved_residency_claim_blocked
    expect(sql).toMatch(/data\.unapproved_residency_claim_blocked/);
  });
});
