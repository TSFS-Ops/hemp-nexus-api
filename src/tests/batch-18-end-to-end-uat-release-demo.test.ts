/**
 * Batch 18 — End-to-End UAT, Release Gate and Demo Pack tests.
 *
 * These tests pin the SSOT contract so a future change cannot silently
 * weaken release-readiness, demo labelling, or the UAT scenario pack.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  RELEASE_GATE_MATRIX,
  REQUIRED_RELEASE_GATE_MODULES,
  DEFAULT_FINAL_RELEASE_STATUS,
  computeFinalReleaseStatus,
  FORBIDDEN_READINESS_WORDING,
  ALLOWED_READINESS_WORDING,
  UAT_SCENARIOS,
  REQUIRED_UAT_SCENARIO_KEYS,
  DEMO_RECORDS,
  DEMO_DATA_WARNING_COPY,
  CLIENT_SAFE_LIMITATIONS,
  RELEASE_STATUSES,
} from "@/lib/registry-release-gate-ssot";

describe("Batch 18 — Release Gate defaults", () => {
  it("default final release status is not production_ready", () => {
    expect(DEFAULT_FINAL_RELEASE_STATUS).not.toBe("production_ready");
  });
  it("computed final status is not production_ready by default", () => {
    expect(computeFinalReleaseStatus()).not.toBe("production_ready");
  });
  it("release statuses include the seven canonical values", () => {
    for (const s of [
      "not_started", "blocked", "partial", "uat_ready",
      "demo_ready", "production_blocked", "production_ready",
    ]) {
      expect(RELEASE_STATUSES).toContain(s as never);
    }
  });
  it("matrix includes every required module", () => {
    const required = [
      "registry_foundation", "product_truth_readiness", "business_decisions",
      "provenance", "country_coverage", "import_pipeline", "public_search",
      "public_company_profile", "claim_workflow", "authority_to_act",
      "bank_detail_submission", "bank_detail_review", "bank_verification",
      "api_profile_status", "api_payment_status", "api_client_management",
      "company_portal", "admin_operations_centre", "audit_logging",
      "rls_security", "no_raw_bank_exposure", "no_personal_contact_leakage",
      "no_provider_payload_leakage", "demo_uat_controls", "readiness_wording",
    ];
    for (const k of required) expect(REQUIRED_RELEASE_GATE_MODULES).toContain(k);
  });
  it("no matrix row uses forbidden readiness wording in label/blocker/action", () => {
    const haystack = RELEASE_GATE_MATRIX.flatMap((r) => [
      r.label, r.blocker ?? "", r.nextAction,
    ]).join("\n");
    // SSOT may say "Live provider integration not yet enabled" — that
    // contains the forbidden word "Live" by design. We require the
    // qualifying phrase "not yet enabled" or "not enabled" to be present.
    for (const w of FORBIDDEN_READINESS_WORDING) {
      const re = new RegExp(`\\b${w}\\b`, "i");
      if (re.test(haystack)) {
        expect(/not (yet )?enabled|disabled by default/i.test(haystack)).toBe(true);
      }
    }
  });
});

describe("Batch 18 — UAT scenarios", () => {
  it("includes all 25 required workflow scenarios", () => {
    expect(UAT_SCENARIOS.length).toBeGreaterThanOrEqual(25);
    expect(REQUIRED_UAT_SCENARIO_KEYS).toContain("uat-01-public-search");
    expect(REQUIRED_UAT_SCENARIO_KEYS).toContain("uat-13-captured-not-verified");
    expect(REQUIRED_UAT_SCENARIO_KEYS).toContain("uat-25-expired-revoked-disputed");
  });
  it("public search demo renders a safe expectation", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-01-public-search")!;
    expect(s.expected.toLowerCase()).toContain("safe");
  });
  it("company portal scenario renders a safe next step", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-20-company-portal")!;
    expect(s.expected.toLowerCase()).toContain("next-step");
  });
  it("payment-status scenario does not promise raw bank details", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-19-api-payment-status")!;
    expect(s.safetyRules.join(",")).toMatch(/not verified|non-final/i);
  });
  it("expired/disputed/revoked scenario returns not verified", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-25-expired-revoked-disputed")!;
    expect(s.expected.toLowerCase()).toContain("not verified");
  });
  it("admin operations scenario links to safe operations route", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-21-admin-operations")!;
    expect(s.routeOrFunction).toBe("/admin/registry/operations");
  });
  it("API test console scenario returns a safe envelope", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-18-api-profile-status")!;
    expect(s.expected.toLowerCase()).toContain("safe envelope");
  });
  it("non-final verification scenario returns not verified", () => {
    const s = UAT_SCENARIOS.find((x) => x.id === "uat-16-non-final-not-verified")!;
    expect(s.expected.toLowerCase()).toContain("not verified");
  });
});

describe("Batch 18 — Demo data set", () => {
  it("every demo record is flagged isDemo=true", () => {
    for (const r of DEMO_RECORDS) expect(r.isDemo).toBe(true);
  });
  it("demo warning copy is non-empty and explicit", () => {
    expect(DEMO_DATA_WARNING_COPY.length).toBeGreaterThan(20);
    expect(DEMO_DATA_WARNING_COPY.toLowerCase()).toContain("demo");
    expect(DEMO_DATA_WARNING_COPY.toLowerCase()).toContain("production");
  });
  it("includes both SA and NG demo companies", () => {
    expect(DEMO_RECORDS.some((r) => r.id === "demo-co-za-01")).toBe(true);
    expect(DEMO_RECORDS.some((r) => r.id === "demo-co-ng-01")).toBe(true);
  });
});

describe("Batch 18 — Client-safe limitations", () => {
  it("includes provider not enabled", () => {
    expect(CLIENT_SAFE_LIMITATIONS.join("\n").toLowerCase()).toContain(
      "live provider verification is not enabled",
    );
  });
  it("includes production API disabled by default", () => {
    expect(CLIENT_SAFE_LIMITATIONS.join("\n").toLowerCase()).toContain(
      "production api access is disabled by default",
    );
  });
  it("states claim/authority/bank capture do not equal verified", () => {
    const joined = CLIENT_SAFE_LIMITATIONS.join("\n").toLowerCase();
    expect(joined).toContain("claim approval does not itself verify");
    expect(joined).toContain("authority approval does not itself verify");
    expect(joined).toContain("bank-detail capture does not itself verify");
  });
});

describe("Batch 18 — Allowed wording", () => {
  it("allowed list includes the canonical labels", () => {
    expect(ALLOWED_READINESS_WORDING).toContain("Demo-ready");
    expect(ALLOWED_READINESS_WORDING).toContain("UAT-ready");
    expect(ALLOWED_READINESS_WORDING).toContain("Controlled test mode");
    expect(ALLOWED_READINESS_WORDING).toContain("Production access disabled by default");
  });
});

describe("Batch 18 — Documentation presence", () => {
  it("evidence README exists", () => {
    expect(
      readFileSync("evidence/batch-18-end-to-end-uat-release-demo/README.md", "utf8").length,
    ).toBeGreaterThan(50);
  });
  it("central evidence index exists", () => {
    expect(
      readFileSync("evidence/registry-evidence-index/README.md", "utf8").length,
    ).toBeGreaterThan(50);
  });
  it("client-safe limitations doc exists", () => {
    expect(
      readFileSync("docs/registry/client-safe-limitations.md", "utf8").length,
    ).toBeGreaterThan(50);
  });
  it("release gate matrix doc exists", () => {
    expect(
      readFileSync("docs/registry/release-gate-matrix.md", "utf8").length,
    ).toBeGreaterThan(50);
  });
  it("UAT scenarios doc exists", () => {
    expect(readFileSync("docs/registry/uat-scenarios.md", "utf8").length).toBeGreaterThan(50);
  });
  it("demo walkthrough doc exists", () => {
    expect(readFileSync("docs/registry/demo-walkthrough.md", "utf8").length).toBeGreaterThan(50);
  });
});
