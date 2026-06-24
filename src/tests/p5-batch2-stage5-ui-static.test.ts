/**
 * P-5 Batch 2 Stage 5 — static source-level guarantees on non-admin surfaces.
 *
 * Asserts (without rendering) that:
 *  - Stage 5 components never select from or write to p5_batch2_* tables directly.
 *  - All reads route through src/lib/p5-batch2/summary-client.
 *  - Only the approved upload RPC wrapper (p5b2UploadEvidenceVersion) is
 *    used for the strictly-scoped resubmission action — and only on the
 *    surfaces that are permitted to upload (counterparty + subject).
 *  - Funder and API-customer surfaces contain no RPC mutation calls.
 *  - The provider wording guard is applied at render time on every Stage 5
 *    surface (via ProviderSafeLabel or via the explicit funder safe phrase).
 *  - No forbidden provider wording appears as a raw string literal.
 *  - Suspected fraud / tampering never appears in any Stage 5 source.
 *  - Sensitive raw columns are never selected.
 *  - App.tsx exposes the four Stage 5 routes behind RequireAuth.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = {
  counterparty: resolve(__dirname, "../pages/registry/p5-batch2/CounterpartyEvidenceChecklist.tsx"),
  subject: resolve(__dirname, "../pages/registry/p5-batch2/subject/SubjectEvidence.tsx"),
  funder: resolve(__dirname, "../pages/funder/p5-batch2/FunderEvidencePack.tsx"),
  apiCustomer: resolve(__dirname, "../pages/registry/p5-batch2/api-customer/ApiCustomerSummary.tsx"),
  summaryClient: resolve(__dirname, "../lib/p5-batch2/summary-client.ts"),
};

const FORBIDDEN_WORDING = [
  /\bverified\b/i,
  /\bpassed\b/i,
  /\bcleared\b/i,
  /\bsanctions clear\b/i,
  /\bbank verified\b/i,
  /\bprovider approved\b/i,
  /\bno adverse result\b/i,
];

const SENSITIVE_RAW_COLS = [
  "reviewer_note_internal",
  "notes_internal",
  "provider_raw_response",
  "fraud_flag",
  "passport_number",
  "id_number",
  "tax_number",
  "vat_number",
];

const STAGE5_FILES = ["counterparty", "subject", "funder", "apiCustomer"] as const;

function read(p: string): string { return readFileSync(p, "utf8"); }

// Strip imports and comments so wording / column checks only inspect rendered
// or executed source (the negative phrase "not externally verified" is
// permitted on the funder surface).
function stripped(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "")
    // Drop "not externally verified" / "not provider-verified" before sweeping.
    .replace(/not\s+externally\s+verified/gi, "[safe-negation]")
    .replace(/not\s+provider-?verified/gi, "[safe-negation]");
}

describe("p5-batch2 stage 5 — non-admin surface source guarantees", () => {
  it("all Stage 5 components exist and never select or write p5_batch2_* tables", () => {
    for (const key of STAGE5_FILES) {
      const src = read(FILES[key]);
      expect(src.length).toBeGreaterThan(100);
      expect(src, `${key}: must not select from p5_batch2_*`).not.toMatch(/\.from\(["']p5_batch2[\w]*["']\)/);
      expect(src, `${key}: must not call supabase.from(`).not.toMatch(/supabase\s*\.\s*from\(/);
    }
  });

  it("all Stage 5 reads route through summary-client", () => {
    for (const key of STAGE5_FILES) {
      const src = read(FILES[key]);
      expect(src, `${key}: must import fetchP5B2ReadinessSummary`).toMatch(/fetchP5B2ReadinessSummary/);
      expect(src).toMatch(/from\s+["']@\/lib\/p5-batch2\/summary-client["']/);
    }
  });

  it("summary-client invokes the Stage 3 edge function (no direct table access)", () => {
    const src = read(FILES.summaryClient);
    expect(src).toContain("p5-batch2-readiness-summary");
    expect(src).toMatch(/supabase\.functions\.invoke/);
    expect(src).not.toMatch(/supabase\s*\.\s*from\(/);
  });

  it("counterparty + subject surfaces use only the approved upload RPC wrapper", () => {
    for (const key of ["counterparty", "subject"] as const) {
      const src = read(FILES[key]);
      expect(src).toMatch(/p5b2UploadEvidenceVersion/);
      // Forbid every other mutation wrapper on these surfaces.
      for (const banned of [
        "p5b2CreateKycRecord", "p5b2LinkRecords", "p5b2GenerateChecklist",
        "p5b2ReviewEvidence", "p5b2SetProviderState", "p5b2WaiveEvidence",
        "p5b2WithdrawEvidence", "p5b2SuspendRelease", "p5b2SnapshotFinalityPack",
      ]) {
        expect(src, `${key}: must not call ${banned}`).not.toContain(banned);
      }
    }
  });

  it("funder + API-customer surfaces contain no mutation calls at all", () => {
    for (const key of ["funder", "apiCustomer"] as const) {
      const src = read(FILES[key]);
      for (const banned of [
        "p5b2UploadEvidenceVersion",
        "p5b2CreateKycRecord", "p5b2LinkRecords", "p5b2GenerateChecklist",
        "p5b2ReviewEvidence", "p5b2SetProviderState", "p5b2WaiveEvidence",
        "p5b2WithdrawEvidence", "p5b2SuspendRelease", "p5b2SnapshotFinalityPack",
      ]) {
        expect(src, `${key}: must not call ${banned}`).not.toContain(banned);
      }
    }
  });

  it("provider wording guard is applied at render on every Stage 5 surface", () => {
    // counterparty + subject use ProviderSafeLabel.
    for (const key of ["counterparty", "subject"] as const) {
      const src = read(FILES[key]);
      expect(src, `${key}: must use ProviderSafeLabel`).toMatch(/ProviderSafeLabel/);
    }
    // funder explicitly renders the safe phrase mandated by the spec.
    const funder = read(FILES.funder);
    expect(funder).toContain("Provider-dependent — not externally verified");
    // API-customer mirrors safe API JSON keys.
    const api = read(FILES.apiCustomer);
    expect(api).toMatch(/provider_dependency/);
    expect(api).toMatch(/provider_live/);
    expect(api).toMatch(/verified_by_live_provider/);
  });

  it("no forbidden provider wording appears as rendered string literal", () => {
    for (const key of STAGE5_FILES) {
      const src = stripped(read(FILES[key]));
      for (const re of FORBIDDEN_WORDING) {
        expect(src, `${key}: must not render ${re}`).not.toMatch(re);
      }
    }
  });

  it("suspected fraud / tampering never appears in any Stage 5 rendered source", () => {
    for (const key of STAGE5_FILES) {
      const src = stripped(read(FILES[key])).toLowerCase();
      expect(src, `${key}: fraud detail must not leak`).not.toContain("fraud");
      expect(src, `${key}: tampering must not leak`).not.toContain("tamper");
    }
  });

  it("no admin-only reviewer notes / sensitive raw columns are referenced", () => {
    for (const key of STAGE5_FILES) {
      const src = read(FILES[key]).toLowerCase();
      for (const col of SENSITIVE_RAW_COLS) {
        expect(src, `${key}: must not reference ${col}`).not.toContain(col.toLowerCase());
      }
    }
  });

  it("masking helper is applied on the funder surface for bank + address", () => {
    const src = read(FILES.funder);
    expect(src).toMatch(/maskP5B2Field/);
    expect(src).toMatch(/bank_account_number/);
    expect(src).toMatch(/physical_address/);
  });

  it("API-customer surface mirrors the safe API JSON shape (metadata only)", () => {
    const src = read(FILES.apiCustomer);
    // No raw file fields.
    expect(src).not.toMatch(/file_storage_path/);
    expect(src).not.toMatch(/file_hash/);
    // Shape keys present.
    for (const k of [
      "evidence_status", "evidence_rating", "readiness_impact",
      "provider_dependency", "provider_live", "verified_by_live_provider",
      "next_action", "audit_reference",
    ]) {
      expect(src, `api-customer JSON missing key: ${k}`).toContain(k);
    }
  });

  it("App.tsx exposes the four Stage 5 routes behind RequireAuth", () => {
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    for (const path of [
      "/registry/p5-batch2/checklist",
      "/registry/p5-batch2/subject",
      "/registry/p5-batch2/api-customer",
      "/funder/p5-batch2/evidence-pack",
    ]) {
      expect(app, `route missing: ${path}`).toContain(path);
    }
    // Each route is wrapped in RequireAuth.
    const matches = app.match(/\/(?:registry|funder)\/p5-batch2[\s\S]{0,300}?<\/RequireAuth>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
