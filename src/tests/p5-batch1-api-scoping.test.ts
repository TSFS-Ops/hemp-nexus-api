/**
 * P-5 Batch 1 — Stage 3 API scoping test.
 *
 * Validates the response shaping rules for the
 * `p5-governance-readiness-summary` edge function WITHOUT requiring a live
 * backend. We import the wording lists and re-implement the response builder
 * exactly as the edge function does so we can assert:
 *
 *  - customer / funder / public API responses omit internal-only fields
 *  - raw provider payloads are absent
 *  - internal reviewer notes are absent
 *  - risk scores and legal comments are absent
 *  - forbidden wording is absent in unsafe contexts
 *  - provider-dependent does not imply verified / cleared / compliant
 *  - admin-scoped response is richer but still does not expose secrets
 */
import { describe, expect, it } from "vitest";
import {
  assertCustomerSafeWording,
  isCustomerSafeWording,
} from "@/lib/p5-governance/wording-guard";
import { P5_FORBIDDEN_WORDS } from "@/lib/p5-governance/constants";

// Mirror of the edge function next_action mapping. Kept in sync with
// supabase/functions/p5-governance-readiness-summary/index.ts.
function nextActionFor(status: string, providerStatus: string | null): string {
  if (status === "blocked") return "Resolve blocker before proceeding";
  if (status === "on_hold") return "Hold must be released by authorised role";
  if (status === "escalated") return "Escalation owner action required";
  if (status === "more_information_required") return "More information required";
  if (status === "rejected") return "Rejected — reopen if facts change";
  if (status === "provider_dependent") {
    switch (providerStatus) {
      case "not_live": return "Provider not live";
      case "credentials_pending": return "Provider credentials pending";
      case "timeout": return "Provider timeout — retry pending";
      case "inconclusive": return "Provider result inconclusive — manual review required";
      case "pending": return "External confirmation pending";
      default: return "Provider-Dependent";
    }
  }
  if (status === "conditional_ready") return "Conditional Ready — review remaining warnings";
  if (status === "internally_ready") return "Internally Ready — awaiting human approval";
  if (status === "ready_to_proceed") return "Ready to Proceed";
  if (status === "under_review") return "Under Review";
  return "Under Review";
}

// All fields that must NEVER be in any response, regardless of caller role.
const FORBIDDEN_FIELDS = [
  "raw_provider_payload",
  "provider_response_body",
  "provider_credentials",
  "provider_secret",
  "internal_reviewer_note",
  "reviewer_note",
  "legal_comment",
  "internal_risk_score",
  "ai_reasoning",
  "draft_evidence_pack",
  "unapproved_evidence",
];

interface BuildArgs {
  case: {
    organization_id: string;
    entity_id: string | null;
    match_id: string | null;
    governance_status: string;
    compliance_status: string;
    readiness_status: string;
    evidence_status: string | null;
    reason_codes: string[];
    blocker_count: number;
    warning_count: number;
    provider_dependency: boolean;
    provider_dependency_type: string | null;
    provider_status: string | null;
    provider_last_checked_at: string | null;
    next_owner_type: string | null;
    last_updated_at: string;
    status_changed_at: string;
    audit_reference: string | null;
    decision_reference: string | null;
    evidence_pack_id: string | null;
    evidence_summary_id: string | null;
    last_audit_event_id: string | null;
    is_on_hold: boolean;
  };
  required_items_missing: number;
  isPrivileged: boolean;
}

function buildResponse({ case: c, required_items_missing, isPrivileged }: BuildArgs) {
  const next_action = nextActionFor(c.readiness_status, c.provider_status);
  const body: Record<string, unknown> = {
    request_id: "req-test",
    correlation_id: "corr-test",
    entity_id: c.entity_id,
    project_id: null,
    transaction_id: c.match_id,
    readiness_status: c.readiness_status,
    governance_status: c.governance_status,
    compliance_status: c.compliance_status,
    evidence_status: c.evidence_status,
    reason_codes: c.reason_codes,
    blocker_count: c.blocker_count,
    warning_count: c.warning_count,
    provider_dependency: c.provider_dependency,
    provider_dependency_type: c.provider_dependency_type,
    provider_status: c.provider_status,
    provider_last_checked_at: c.provider_last_checked_at,
    next_action,
    next_owner_type: c.next_owner_type ?? "governance_reviewer",
    required_items_missing,
    last_updated_at: c.last_updated_at,
    status_changed_at: c.status_changed_at,
    audit_reference: c.audit_reference,
    decision_reference: c.decision_reference,
    evidence_pack_id: c.evidence_pack_id,
    evidence_summary_id: c.evidence_summary_id,
    version_hash_chain_reference: c.last_audit_event_id,
  };
  if (isPrivileged) {
    body.organization_id = c.organization_id;
    body.is_on_hold = c.is_on_hold;
  }
  return body;
}

const sampleCase: BuildArgs["case"] = {
  organization_id: "org-1",
  entity_id: "ent-1",
  match_id: "match-1",
  governance_status: "provider_dependent",
  compliance_status: "provider_dependent",
  readiness_status: "provider_dependent",
  evidence_status: null,
  reason_codes: ["provider_not_live"],
  blocker_count: 0,
  warning_count: 0,
  provider_dependency: true,
  provider_dependency_type: "sanctions_screening",
  provider_status: "not_live",
  provider_last_checked_at: "2026-06-24T10:00:00Z",
  next_owner_type: null,
  last_updated_at: "2026-06-24T10:00:00Z",
  status_changed_at: "2026-06-24T10:00:00Z",
  audit_reference: "audit-1",
  decision_reference: null,
  evidence_pack_id: null,
  evidence_summary_id: null,
  last_audit_event_id: "audit-event-1",
  is_on_hold: false,
};

describe("P-5 Batch 1 — Stage 3 API scoping", () => {
  it("customer / funder / public API responses omit internal-only fields", () => {
    const body = buildResponse({
      case: sampleCase,
      required_items_missing: 1,
      isPrivileged: false,
    });
    for (const f of FORBIDDEN_FIELDS) {
      expect(body[f]).toBeUndefined();
    }
    expect(body.organization_id).toBeUndefined();
    expect(body.is_on_hold).toBeUndefined();
  });

  it("admin response is richer but still excludes secrets and raw provider payloads", () => {
    const body = buildResponse({
      case: sampleCase,
      required_items_missing: 1,
      isPrivileged: true,
    });
    expect(body.organization_id).toBe("org-1");
    expect(body.is_on_hold).toBe(false);
    for (const f of FORBIDDEN_FIELDS) {
      expect(body[f]).toBeUndefined();
    }
  });

  it("provider-dependent next_action does not imply verified / cleared / compliant", () => {
    const variants = [
      "not_live",
      "credentials_pending",
      "pending",
      "timeout",
      "inconclusive",
    ] as const;
    for (const status of variants) {
      const action = nextActionFor("provider_dependent", status);
      // No forbidden phrase may appear in the user-facing next_action.
      expect(isCustomerSafeWording(action)).toBe(true);
      for (const word of P5_FORBIDDEN_WORDS) {
        expect(action.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });

  it("every external surface label passes the Stage 2 wording guard", () => {
    const statuses = [
      "blocked", "on_hold", "escalated", "more_information_required",
      "rejected", "provider_dependent", "conditional_ready",
      "internally_ready", "ready_to_proceed", "under_review",
    ];
    for (const s of statuses) {
      const action = nextActionFor(s, null);
      expect(() =>
        assertCustomerSafeWording(action, { surface: "customer" }),
      ).not.toThrow();
      expect(() =>
        assertCustomerSafeWording(action, { surface: "funder" }),
      ).not.toThrow();
      expect(() =>
        assertCustomerSafeWording(action, { surface: "public_api" }),
      ).not.toThrow();
    }
  });

  it("forbidden wording is rejected on unsafe contexts", () => {
    for (const word of ["Verified", "Bankable", "KYC Complete", "Payment confirmed"]) {
      expect(isCustomerSafeWording(`Status: ${word}`)).toBe(false);
    }
  });

  it("response shape includes only the approved fields for non-admin callers", () => {
    const body = buildResponse({
      case: sampleCase,
      required_items_missing: 1,
      isPrivileged: false,
    });
    const expectedKeys = [
      "request_id", "correlation_id", "entity_id", "project_id",
      "transaction_id", "readiness_status", "governance_status",
      "compliance_status", "evidence_status", "reason_codes",
      "blocker_count", "warning_count", "provider_dependency",
      "provider_dependency_type", "provider_status",
      "provider_last_checked_at", "next_action", "next_owner_type",
      "required_items_missing", "last_updated_at", "status_changed_at",
      "audit_reference", "decision_reference", "evidence_pack_id",
      "evidence_summary_id", "version_hash_chain_reference",
    ];
    expect(Object.keys(body).sort()).toEqual(expectedKeys.sort());
  });
});
