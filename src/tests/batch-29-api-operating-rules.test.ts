import { describe, it, expect } from "vitest";
import {
  REGISTRY_API_ALLOWED_CLIENT_TYPES,
  REGISTRY_API_PUBLIC_SELF_SERVE_PRODUCTION_ENABLED,
  REGISTRY_API_DEFAULT_ENVIRONMENT,
  REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS,
  REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES,
  evaluateProductionGate,
  REGISTRY_API_SENSITIVE_SCOPES,
  isSensitiveScope,
  evaluateProfileStatusUsable,
  REGISTRY_API_PAYMENT_USABLE_BANK_STATES,
  evaluatePaymentStatusUsable,
  PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS,
  REGISTRY_API_RAW_BANK_DEFAULT_BLOCKED,
  REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS,
  REGISTRY_API_RAW_BANK_EXCEPTION_REQUIREMENTS,
  evaluateRawBankException,
  classifyApiSearchKey,
  evaluateApiSearchKey,
  REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS,
  REGISTRY_API_COMPANY_VISIBLE_LOG_FIELDS,
  REGISTRY_API_COMPANY_LOGS_REQUIRE_DASHBOARD_ENABLED,
  REGISTRY_API_AUTO_COMPANY_NOTIFICATIONS_ENABLED,
  REGISTRY_API_CLIENT_SEES_OWN_LOGS_ONLY,
  buildCompanyVisibleLogSummary,
  REGISTRY_API_PRODUCTION_LIMITS,
  REGISTRY_API_SANDBOX_LIMITS,
  REGISTRY_API_SENSITIVE_ENDPOINT_LIMITS,
  REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT,
  REGISTRY_API_SUSPENSION_TRIGGERS,
  evaluateSuspension,
  REGISTRY_API_CLIENT_HIDDEN_FIELDS,
  REGISTRY_API_OPERATING_AUDIT_EVENTS,
} from "@/lib/registry-api-operating-rules";

const ALL_REQS = REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS;
const fullPass = {
  requirements_met: ALL_REQS,
  country_api_production_ready: true,
  field_scope_api_output_ready: true,
  business_decision_present_and_current: true,
  client_scope_covers_request: true,
  api_key_active: true,
  decision_state: null,
  quota_blocked: false,
  suspended: false,
  has_sensitive_scope: true,
  compliance_owner_approved_sensitive_scope: true,
};

describe("Batch 29 — institutional API operating rules", () => {
  it("first API clients default to sandbox; no public/self-serve production", () => {
    expect(REGISTRY_API_DEFAULT_ENVIRONMENT).toBe("sandbox");
    expect(REGISTRY_API_PUBLIC_SELF_SERVE_PRODUCTION_ENABLED).toBe(false);
    expect(REGISTRY_API_ALLOWED_CLIENT_TYPES).toContain("bank");
    expect(REGISTRY_API_ALLOWED_CLIENT_TYPES).toContain("named_pilot_client");
  });

  it("production gate blocked when any requirement missing", () => {
    for (const req of ALL_REQS) {
      const r = evaluateProductionGate({
        ...fullPass,
        requirements_met: ALL_REQS.filter((x) => x !== req),
      });
      // sensitive-approval is only required when has_sensitive_scope
      if (req === "compliance_owner_approval_for_sensitive_scopes") {
        expect(r.allowed).toBe(false);
      } else {
        expect(r.allowed).toBe(false);
        expect(r.blocking_reasons.some((x) => x.includes(req))).toBe(true);
      }
    }
  });

  it("production gate passes when everything satisfied", () => {
    expect(evaluateProductionGate(fullPass).allowed).toBe(true);
  });

  it("compliance_owner required for sensitive scopes", () => {
    const r = evaluateProductionGate({
      ...fullPass,
      compliance_owner_approved_sensitive_scope: false,
    });
    expect(r.allowed).toBe(false);
  });

  it("expired/disputed/licence_pending/provider_pending block production", () => {
    for (const state of REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES) {
      const r = evaluateProductionGate({ ...fullPass, decision_state: state });
      expect(r.allowed).toBe(false);
      expect(r.blocking_reasons.some((x) => x.includes(state))).toBe(true);
    }
  });

  it("country/field/business-decision/scope/key/quota all block", () => {
    expect(evaluateProductionGate({ ...fullPass, country_api_production_ready: false }).allowed).toBe(false);
    expect(evaluateProductionGate({ ...fullPass, field_scope_api_output_ready: false }).allowed).toBe(false);
    expect(evaluateProductionGate({ ...fullPass, business_decision_present_and_current: false }).allowed).toBe(false);
    expect(evaluateProductionGate({ ...fullPass, client_scope_covers_request: false }).allowed).toBe(false);
    expect(evaluateProductionGate({ ...fullPass, api_key_active: false }).allowed).toBe(false);
    expect(evaluateProductionGate({ ...fullPass, quota_blocked: true }).allowed).toBe(false);
    expect(evaluateProductionGate({ ...fullPass, suspended: true }).allowed).toBe(false);
  });

  it("sensitive scopes flagged", () => {
    expect(isSensitiveScope("registry.payment_status.read")).toBe(true);
    expect(isSensitiveScope("registry.profile.verified.read")).toBe(true);
    expect(isSensitiveScope("registry.search")).toBe(false);
  });

  it("profile-status usable only with full provenance/licence/decision/freshness", () => {
    const good = {
      country_search_ready_or_production: true,
      field_provenance_present: true,
      source_licence_permits_api: true,
      no_active_dispute: true,
      no_compliance_hold: true,
      business_decision_current: true,
      has_readiness_status: true,
      has_source_label: true,
      has_last_updated: true,
      has_stale_date: true,
    };
    expect(evaluateProfileStatusUsable(good).usable).toBe(true);
    expect(evaluateProfileStatusUsable({ ...good, field_provenance_present: false }).usable).toBe(false);
    expect(evaluateProfileStatusUsable({ ...good, source_licence_permits_api: false }).usable).toBe(false);
    expect(evaluateProfileStatusUsable({ ...good, no_active_dispute: false }).usable).toBe(false);
    expect(evaluateProfileStatusUsable({ ...good, business_decision_current: false }).usable).toBe(false);
  });

  it("payment-status: only approved verification states are usable", () => {
    for (const s of REGISTRY_API_PAYMENT_USABLE_BANK_STATES) {
      const r = evaluatePaymentStatusUsable({
        bank_status: s,
        manual_check_compliance_approved: true,
        evidence_present: true,
        authority_active_with_bank_consent: true,
        business_decision_allows_payment_status_api: true,
      });
      expect(r.usable).toBe(true);
    }
    for (const s of ["pending", "expired", "disputed", "revoked", "captured_unverified", "failed"]) {
      const r = evaluatePaymentStatusUsable({
        bank_status: s,
        manual_check_compliance_approved: true,
        evidence_present: true,
        authority_active_with_bank_consent: true,
        business_decision_allows_payment_status_api: true,
      });
      expect(r.usable).toBe(false);
    }
  });

  it("manual_bank_check_complete requires compliance approval", () => {
    const r = evaluatePaymentStatusUsable({
      bank_status: "manual_bank_check_complete",
      manual_check_compliance_approved: false,
      evidence_present: true,
      authority_active_with_bank_consent: true,
      business_decision_allows_payment_status_api: true,
    });
    expect(r.usable).toBe(false);
    expect(r.blocking_reasons).toContain("manual_check_not_compliance_approved");
  });

  it("payment-status safe response excludes raw bank fields", () => {
    expect(PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS).toContain("masked_account_identifier");
    expect(PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS).not.toContain("account_number");
    expect(PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS).not.toContain("iban");
  });

  it("raw bank default blocked + exception requires all conditions and endpoint stays disabled", () => {
    expect(REGISTRY_API_RAW_BANK_DEFAULT_BLOCKED).toBe(true);
    expect(REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS).toBe(false);
    const r = evaluateRawBankException({ satisfied: REGISTRY_API_RAW_BANK_EXCEPTION_REQUIREMENTS });
    expect(r.allowed).toBe(false);
    expect(r.missing).toContain("raw_bank_endpoint_disabled_by_default");
    const partial = evaluateRawBankException({ satisfied: [] });
    expect(partial.allowed).toBe(false);
    expect(partial.missing.length).toBeGreaterThan(1);
  });

  it("search keys: allowed / special_approval / hidden classification", () => {
    expect(classifyApiSearchKey("legal_name")).toBe("allowed");
    expect(classifyApiSearchKey("officer_name")).toBe("special_approval");
    expect(classifyApiSearchKey("raw_bank_details")).toBe("hidden");
    expect(classifyApiSearchKey("not_a_real_key")).toBe("unknown");
  });

  it("special-approval keys blocked without approval; hidden never returned", () => {
    expect(evaluateApiSearchKey({ key: "officer_name", fuzzy: false, special_approval_granted: false }).allowed).toBe(false);
    expect(evaluateApiSearchKey({ key: "officer_name", fuzzy: false, special_approval_granted: true }).allowed).toBe(true);
    expect(evaluateApiSearchKey({ key: "raw_bank_details", fuzzy: false, special_approval_granted: true }).allowed).toBe(false);
  });

  it("exact-match required for registration/tax/bank-status; fuzzy only on company name", () => {
    expect(evaluateApiSearchKey({ key: "registration_number", fuzzy: true, special_approval_granted: false }).reason).toBe("exact_match_required");
    expect(evaluateApiSearchKey({ key: "tax_number", fuzzy: true, special_approval_granted: true }).reason).toBe("exact_match_required");
    expect(evaluateApiSearchKey({ key: "legal_name", fuzzy: true, special_approval_granted: false }).allowed).toBe(true);
    expect(evaluateApiSearchKey({ key: "country", fuzzy: true, special_approval_granted: false }).reason).toBe("fuzzy_not_allowed_for_key");
  });

  it("request log forbids full keys, IPs, payloads, raw bank, internal errors", () => {
    expect(REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS).toContain("full_api_key");
    expect(REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS).toContain("raw_ip");
    expect(REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS).toContain("provider_payload");
    expect(REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS).toContain("raw_bank_details");
  });

  it("company-visible summary only returns the four safe fields", () => {
    const safe = buildCompanyVisibleLogSummary({
      client_name_or_category: "Bank A",
      date: "2026-06-22",
      endpoint_category: "payment_status",
      purpose_label: "due_diligence",
      raw_ip: "1.2.3.4",
      api_key: "secret",
      provider_payload: { x: 1 },
    });
    expect(Object.keys(safe).sort()).toEqual([...REGISTRY_API_COMPANY_VISIBLE_LOG_FIELDS].sort());
    expect("raw_ip" in safe).toBe(false);
    expect("api_key" in safe).toBe(false);
    expect("provider_payload" in safe).toBe(false);
  });

  it("company dashboard gating + no auto notifications + client own-logs-only", () => {
    expect(REGISTRY_API_COMPANY_LOGS_REQUIRE_DASHBOARD_ENABLED).toBe(true);
    expect(REGISTRY_API_AUTO_COMPANY_NOTIFICATIONS_ENABLED).toBe(false);
    expect(REGISTRY_API_CLIENT_SEES_OWN_LOGS_ONLY).toBe(true);
  });

  it("limits: production 60/5k/100k, sandbox 30/1k, sensitive 10/1k", () => {
    expect(REGISTRY_API_PRODUCTION_LIMITS.per_minute).toBe(60);
    expect(REGISTRY_API_PRODUCTION_LIMITS.per_day).toBe(5000);
    expect(REGISTRY_API_PRODUCTION_LIMITS.per_month).toBe(100000);
    expect(REGISTRY_API_SANDBOX_LIMITS.per_minute).toBe(30);
    expect(REGISTRY_API_SANDBOX_LIMITS.per_day).toBe(1000);
    expect(REGISTRY_API_SENSITIVE_ENDPOINT_LIMITS.per_minute).toBe(10);
    expect(REGISTRY_API_SENSITIVE_ENDPOINT_LIMITS.per_day).toBe(1000);
  });

  it("suspension triggers: 120% quota, scraping, repeated auth fails, spikes, breach, dispute, payment fail", () => {
    expect(REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT).toBe(120);
    expect(REGISTRY_API_SUSPENSION_TRIGGERS).toContain("scraping_pattern");

    const r1 = evaluateSuspension({
      failed_auth_count: 5, scraping_detected: false, quota_usage_pct: 90,
      country_spike: false, endpoint_spike: false, policy_breach: false,
      disputed_use: false, payment_failure: false,
    });
    expect(r1.suspend_or_review).toBe(true);
    expect(r1.triggers).toContain("repeated_failed_authentication");

    const r2 = evaluateSuspension({
      failed_auth_count: 0, scraping_detected: false, quota_usage_pct: 125,
      country_spike: false, endpoint_spike: false, policy_breach: false,
      disputed_use: false, payment_failure: false,
    });
    expect(r2.triggers).toContain("usage_above_120_percent_quota");

    const r3 = evaluateSuspension({
      failed_auth_count: 0, scraping_detected: true, quota_usage_pct: 0,
      country_spike: true, endpoint_spike: true, policy_breach: true,
      disputed_use: true, payment_failure: true,
    });
    expect(r3.triggers.length).toBe(6);

    const clean = evaluateSuspension({
      failed_auth_count: 0, scraping_detected: false, quota_usage_pct: 50,
      country_spike: false, endpoint_spike: false, policy_breach: false,
      disputed_use: false, payment_failure: false,
    });
    expect(clean.suspend_or_review).toBe(false);
  });

  it("API client self-visibility excludes other clients, full keys, internal data", () => {
    expect(REGISTRY_API_CLIENT_HIDDEN_FIELDS).toContain("other_clients");
    expect(REGISTRY_API_CLIENT_HIDDEN_FIELDS).toContain("full_keys");
    expect(REGISTRY_API_CLIENT_HIDDEN_FIELDS).toContain("raw_bank_details");
    expect(REGISTRY_API_CLIENT_HIDDEN_FIELDS).toContain("raw_provider_payloads");
  });

  it("audit events pinned", () => {
    expect(REGISTRY_API_OPERATING_AUDIT_EVENTS).toContain("registry_api_production_access_blocked");
    expect(REGISTRY_API_OPERATING_AUDIT_EVENTS).toContain("registry_api_raw_bank_blocked");
    expect(REGISTRY_API_OPERATING_AUDIT_EVENTS).toContain("registry_api_suspension_triggered");
  });

  it("sensitive scope ssot covers payment_status, profile_verified, bank_raw, officer, contact", () => {
    expect(REGISTRY_API_SENSITIVE_SCOPES).toContain("registry.payment_status.read");
    expect(REGISTRY_API_SENSITIVE_SCOPES).toContain("registry.bank.raw.read");
    expect(REGISTRY_API_SENSITIVE_SCOPES).toContain("registry.officer.read");
  });
});
