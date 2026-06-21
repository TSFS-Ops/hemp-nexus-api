/**
 * Batch 15 — Institutional API Hardening (backend phase 1) tests.
 *
 * Covers: SSOT shape, gate evaluation, payment mapping, response envelope.
 * Does NOT cover live edge function I/O (Phase 2).
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_API_MODES,
  REGISTRY_API_DEFAULT_MODE,
  REGISTRY_API_CLIENT_LIFECYCLE_STATUSES,
  REGISTRY_API_KEY_TYPES,
  REGISTRY_API_HARDENED_SCOPES,
  REGISTRY_API_FORBIDDEN_SCOPES,
  REGISTRY_API_HARDENED_RESULT_STATES,
  REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS,
  REGISTRY_API_NOT_VERIFIED_BANK_STATES,
  REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT,
  isForbiddenApiScope,
  mapVerificationStateToHardenedResult,
  evaluateApiGates,
  gatesToBlockedReason,
  buildResponseEnvelope,
} from "@/lib/registry-api-hardening";

describe("Batch 15 — SSOT shape", () => {
  it("default mode is disabled", () => {
    expect(REGISTRY_API_DEFAULT_MODE).toBe("disabled");
    expect(REGISTRY_API_MODES).toContain("disabled");
    expect(REGISTRY_API_MODES).toContain("production");
  });
  it("client lifecycle statuses include all 10 required states", () => {
    for (const s of ["draft","pending_approval","sandbox_active","demo_active","production_pending","production_active","suspended","revoked","expired","disabled"]) {
      expect(REGISTRY_API_CLIENT_LIFECYCLE_STATUSES).toContain(s);
    }
  });
  it("key types are exactly sandbox and production", () => {
    expect([...REGISTRY_API_KEY_TYPES].sort()).toEqual(["production","sandbox"]);
  });
  it("hardened scopes include the canonical 10", () => {
    for (const s of [
      "registry.search","registry.profile.status.read","registry.profile.summary.read",
      "registry.claim.status.read","registry.authority.status.read","registry.bank.status.read",
      "registry.payment_status.read","registry.coverage.read","registry.readiness.read","registry.usage.read",
    ]) expect(REGISTRY_API_HARDENED_SCOPES).toContain(s);
  });
  it("forbidden scopes block raw bank/personal/evidence access", () => {
    expect(isForbiddenApiScope("registry.bank.raw.read")).toBe(true);
    expect(isForbiddenApiScope("registry.bank.unmasked.read")).toBe(true);
    expect(isForbiddenApiScope("registry.personal_contact.raw.read")).toBe(true);
    expect(isForbiddenApiScope("registry.evidence.raw.read")).toBe(true);
    expect(isForbiddenApiScope("registry.profile.status.read")).toBe(false);
  });
  it("result states include the full B15 vocabulary", () => {
    for (const s of [
      "usable","not_usable","imported_unverified","bank_details_captured_unverified",
      "bank_verification_pending","bank_verification_expired","bank_verification_revoked",
      "bank_verification_disputed","scope_not_allowed","rate_limited","client_suspended",
    ]) expect(REGISTRY_API_HARDENED_RESULT_STATES).toContain(s);
  });
  it("forbidden response fields cover raw bank, masked bank and personal contact", () => {
    for (const f of [
      "account_number","iban","swift_bic","branch_code","bank_code",
      "account_number_masked","iban_masked",
      "personal_email","personal_phone","personal_mobile","personal_address",
    ]) expect(REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS).toContain(f);
  });
  it("production acknowledgement text is locked", () => {
    expect(REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT).toMatch(/production API access/i);
    expect(REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT).toMatch(/raw bank-detail access/i);
  });
});

describe("Batch 15 — payment-status verification mapping", () => {
  for (const s of REGISTRY_API_NOT_VERIFIED_BANK_STATES) {
    it(`${s} → never usable`, () => {
      const r = mapVerificationStateToHardenedResult(s, null);
      expect(r).not.toBe("usable");
    });
  }
  it("verified + unexpired → usable", () => {
    const r = mapVerificationStateToHardenedResult("verified", new Date(Date.now() + 86_400_000).toISOString());
    expect(r).toBe("usable");
  });
  it("verified + past expiry → bank_verification_expired", () => {
    const r = mapVerificationStateToHardenedResult("verified", new Date(Date.now() - 1000).toISOString());
    expect(r).toBe("bank_verification_expired");
  });
  it("missing status → bank_details_not_submitted", () => {
    expect(mapVerificationStateToHardenedResult(null, null)).toBe("bank_details_not_submitted");
  });
});

describe("Batch 15 — gate evaluation", () => {
  const baseInput = {
    client_lifecycle_status: "production_active" as const,
    client_mode: "production" as const,
    requested_mode: "production" as const,
    key_type: "production" as const,
    key_status: "active" as const,
    granted_scopes: ["registry.payment_status.read"],
    requested_scope: "registry.payment_status.read",
    allowed_countries: ["ZA"],
    requested_country: "ZA",
    allowed_use_cases: ["payments"],
    requested_use_case: "payments",
    rate_limited: false,
  };

  it("happy-path passes all gates", () => {
    const ds = evaluateApiGates(baseInput);
    expect(ds.every((d) => d.passed)).toBe(true);
    expect(gatesToBlockedReason(ds)).toBeNull();
  });

  it("suspended client is blocked → client_suspended", () => {
    const ds = evaluateApiGates({ ...baseInput, client_lifecycle_status: "suspended" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("client_suspended");
  });
  it("revoked key is blocked → api_client_not_allowed", () => {
    const ds = evaluateApiGates({ ...baseInput, key_status: "revoked" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("api_client_not_allowed");
  });
  it("sandbox key with production mode is blocked", () => {
    const ds = evaluateApiGates({ ...baseInput, key_type: "sandbox" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("api_client_not_allowed");
  });
  it("sandbox client cannot use production mode (no production_active lifecycle)", () => {
    const ds = evaluateApiGates({ ...baseInput, client_lifecycle_status: "sandbox_active", key_type: "sandbox" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("api_client_not_allowed");
  });
  it("forbidden scope is blocked → scope_not_allowed", () => {
    const ds = evaluateApiGates({ ...baseInput, requested_scope: "registry.bank.raw.read" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("scope_not_allowed");
  });
  it("scope not granted is blocked → scope_not_allowed", () => {
    const ds = evaluateApiGates({ ...baseInput, granted_scopes: ["registry.search"] });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("scope_not_allowed");
  });
  it("country not allowed → country_not_ready", () => {
    const ds = evaluateApiGates({ ...baseInput, requested_country: "NG" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("country_not_ready");
  });
  it("use case not allowed → api_client_not_allowed", () => {
    const ds = evaluateApiGates({ ...baseInput, requested_use_case: "marketing" });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("api_client_not_allowed");
  });
  it("rate limit hit → rate_limited", () => {
    const ds = evaluateApiGates({ ...baseInput, rate_limited: true });
    expect(gatesToBlockedReason(ds)?.result_state).toBe("rate_limited");
  });
});

describe("Batch 15 — response envelope", () => {
  it("contains request id, audit reference, safe reason, no raw fields", () => {
    const env = buildResponseEnvelope({
      request_id: "req_1", client_id: "c1", mode: "sandbox", scope: "registry.search",
      endpoint: "profile-status", result_state: "not_usable",
    });
    expect(env.request_id).toBe("req_1");
    expect(env.audit_reference).toBe("req_1");
    expect(env.safe_reason.length).toBeGreaterThan(0);
    expect(env.usable).toBe(false);
    const json = JSON.stringify(env);
    for (const f of REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS) {
      expect(json.includes(`"${f}"`)).toBe(false);
    }
  });
  it("usable result sets safe_status to usable", () => {
    const env = buildResponseEnvelope({
      request_id: "r2", client_id: "c1", mode: "production", scope: "registry.payment_status.read",
      endpoint: "payment-status", result_state: "usable",
    });
    expect(env.usable).toBe(true);
    expect(env.safe_status).toBe("usable");
  });
});
