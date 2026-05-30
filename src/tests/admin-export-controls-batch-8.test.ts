/**
 * Admin Export Controls — Batch 8 (Redaction Contract).
 *
 * Behaviour tests for the pure redaction helper. NON-GENERATING:
 * these tests never call edge functions, never write to storage,
 * never produce files, never request signed URLs. They prove the
 * contract for every redaction mode against a synthetic Governance
 * Record-shaped fixture that intentionally carries sensitive fields
 * to verify removal / masking.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_FIELDS_BY_MODE,
  ALWAYS_FORBIDDEN_FIELD_SUBSTRINGS,
  DEFAULT_REDACTION_MODE,
  LEGAL_HOLD_SAFE_FIELDS,
  MASK_TOKEN,
  PII_MASK_FIELD_SUBSTRINGS,
  REDACTION_MODES,
  UnsupportedRedactionModeError,
  redactGovernanceRecord,
  type RedactionMode,
} from "../../supabase/functions/_shared/admin-export-redaction.ts";

function makeFixture(): Record<string, unknown> {
  return {
    governance_record_id: "gr_abc",
    export_request_id: "er_123",
    match_id: "m_xyz",
    status: "approved",
    redaction_mode: "redacted_client_safe",
    requested_at: "2026-05-30T00:00:00Z",
    approved_at: "2026-05-30T00:05:00Z",
    updated_at: "2026-05-30T00:05:00Z",
    created_at: "2026-05-30T00:00:00Z",
    is_demo: false,
    is_test: true,
    demo: false,
    test_mode: true,
    decision_summary: "Approved by platform_admin",
    outcome_summary: "POI sealed",
    purpose: "regulator-request",
    reason_summary: "Routine compliance export",
    approval_note_summary: "Cleared by ops",
    counterparty_label: "Counterparty A",
    requester_user_id: "u_req",
    approver_user_id: "u_apr",
    audit_reference_ids: ["a1", "a2"],
    previous_status: "awaiting_approval",
    new_status: "approved",
    evidence_summary: [{ kind: "doc", count: 3 }],
    evidence_counts: { docs: 3, notes: 1 },
    // PII (must be masked except in full_internal)
    email: "user@example.com",
    phone_number: "+27 11 555 0000",
    physical_address: "1 Example Rd",
    // Forbidden — must be removed everywhere
    password: "hunter2",
    password_hash: "abcd",
    auth_token: "tok_x",
    refresh_token: "rt_x",
    api_key: "sk_x",
    webhook_secret: "ws_x",
    signing_secret: "ss_x",
    bearer: "b_x",
    totp: "111111",
    mfa_secret: "ms_x",
    card_number: "4111111111111111",
    pan: "4111111111111111",
    signed_url: "https://example.com/file?sig=x",
    download_url: "https://example.com/dl",
    download_token: "dt_x",
    storage_path: "exports/x.csv",
    storage_object: "object_x",
    file_path: "/tmp/x.csv",
    file_url: "https://example.com/x.csv",
    object_key: "ok_x",
    bucket: "exports",
    sanctions_raw: { ofac: ["..."], un: ["..."] },
    pep_raw: { hits: ["..."] },
    adverse_media_raw: { articles: ["..."] },
    raw_api_response: { body: "..." },
    third_party_confidential: "yes",
    auto_sources_raw: ["..."],
    internal_notes: "internal-only",
    admin_notes: "admin-only",
    privileged_legal_notes: "attorney-client",
    internal_investigation_notes: "investigation",
    legal_hold_reason: "court-order",
    legal_hold_notes: "see file",
    released_reason: "expired",
    released_by: "u_admin",
    applied_by_user: "u_admin",
    // Out-of-allow-list noise (must be dropped per mode)
    arbitrary_extra_field: "drop-me",
    legal_hold: {
      has_legal_hold: true,
      scope: "match",
      hold_count: 2,
      hold_sources: ["match", "dispute"],
      primary_scope: "match",
      detected_at: "2026-05-30T00:00:00Z",
      detection_source: "auto",
      detection_version: "batch-6.v1",
      // These MUST be reduced out:
      reason: "court-order",
      notes: "internal",
      released_reason: "expired",
      released_by: "u_admin",
      applied_by_user: "u_admin",
      metadata: { foo: "bar" },
    },
  };
}

const FORBIDDEN_OUTPUT_KEYS = [
  "password",
  "password_hash",
  "auth_token",
  "refresh_token",
  "api_key",
  "webhook_secret",
  "signing_secret",
  "bearer",
  "totp",
  "mfa_secret",
  "card_number",
  "pan",
  "signed_url",
  "download_url",
  "download_token",
  "storage_path",
  "storage_object",
  "file_path",
  "file_url",
  "object_key",
  "bucket",
  "sanctions_raw",
  "pep_raw",
  "adverse_media_raw",
  "raw_api_response",
  "third_party_confidential",
  "auto_sources_raw",
  "internal_notes",
  "admin_notes",
  "privileged_legal_notes",
  "internal_investigation_notes",
  "legal_hold_reason",
  "legal_hold_notes",
  "released_reason",
  "released_by",
  "applied_by_user",
];

function expectNoForbiddenSurface(out: Record<string, unknown>) {
  for (const k of FORBIDDEN_OUTPUT_KEYS) {
    expect(out).not.toHaveProperty(k);
  }
  const lh = out.legal_hold as Record<string, unknown> | undefined;
  if (lh) {
    for (const k of Object.keys(lh)) {
      expect(LEGAL_HOLD_SAFE_FIELDS).toContain(k);
    }
    expect(lh).not.toHaveProperty("reason");
    expect(lh).not.toHaveProperty("notes");
    expect(lh).not.toHaveProperty("metadata");
    expect(lh).not.toHaveProperty("released_reason");
    expect(lh).not.toHaveProperty("released_by");
    expect(lh).not.toHaveProperty("applied_by_user");
  }
}

describe("Admin Export Controls Batch 8 — redaction contract", () => {
  it("exposes exactly the four canonical modes with a safe default", () => {
    expect([...REDACTION_MODES].sort()).toEqual(
      [
        "evidence_only",
        "full_internal",
        "metadata_only",
        "redacted_client_safe",
      ].sort(),
    );
    expect(DEFAULT_REDACTION_MODE).toBe("redacted_client_safe");
  });

  it("rejects unsupported modes", () => {
    expect(() =>
      redactGovernanceRecord(makeFixture(), "nope" as RedactionMode),
    ).toThrow(UnsupportedRedactionModeError);
  });

  it("defaults to redacted_client_safe when mode is omitted", () => {
    const { manifest } = redactGovernanceRecord(makeFixture());
    expect(manifest.mode).toBe("redacted_client_safe");
  });

  it("defaults to redacted_client_safe when mode is undefined / null", () => {
    expect(
      redactGovernanceRecord(makeFixture(), undefined).manifest.mode,
    ).toBe("redacted_client_safe");
    expect(
      redactGovernanceRecord(
        makeFixture(),
        null as unknown as RedactionMode,
      ).manifest.mode,
    ).toBe("redacted_client_safe");
  });

  it("never mutates the input object", () => {
    const fx = makeFixture();
    const snapshot = JSON.stringify(fx);
    for (const mode of REDACTION_MODES) {
      redactGovernanceRecord(fx, mode);
    }
    expect(JSON.stringify(fx)).toBe(snapshot);
  });

  for (const mode of [
    "redacted_client_safe",
    "evidence_only",
    "metadata_only",
    "full_internal",
  ] as const) {
    describe(`mode = ${mode}`, () => {
      it("output keys are a subset of the per-mode allow-list", () => {
        const { redacted } = redactGovernanceRecord(makeFixture(), mode);
        const allow = new Set(ALLOWED_FIELDS_BY_MODE[mode]);
        for (const k of Object.keys(redacted)) {
          expect(allow.has(k)).toBe(true);
        }
      });

      it("strips every always-forbidden surface (secrets, signed URLs, raw payloads, raw legal-hold reasons)", () => {
        const { redacted } = redactGovernanceRecord(makeFixture(), mode);
        expectNoForbiddenSurface(redacted);
      });

      it("reduces legal_hold to safe summary fields only", () => {
        const { redacted, manifest } = redactGovernanceRecord(
          makeFixture(),
          mode,
        );
        expect(manifest.legal_hold_reduced).toBe(true);
        const lh = redacted.legal_hold as Record<string, unknown>;
        expect(lh).toBeDefined();
        expect(lh.has_legal_hold).toBe(true);
        expect(lh.hold_count).toBe(2);
        expect(lh.scope).toBe("match");
      });

      it("preserves demo/test labels verbatim", () => {
        const { redacted } = redactGovernanceRecord(makeFixture(), mode);
        expect(redacted.is_demo).toBe(false);
        expect(redacted.is_test).toBe(true);
        expect(redacted.demo).toBe(false);
        expect(redacted.test_mode).toBe(true);
      });

      it("manifest records removed / masked / forbidden categories", () => {
        const { manifest } = redactGovernanceRecord(makeFixture(), mode);
        expect(manifest.mode).toBe(mode);
        // Every fixture key that is forbidden by name must appear in
        // forbidden_fields_blocked at the top level.
        for (const k of FORBIDDEN_OUTPUT_KEYS) {
          // Some forbidden keys may live only nested in legal_hold; the
          // top-level fixture defines them too, so all should be blocked.
          expect(
            manifest.forbidden_fields_blocked.some((p) => p === k),
          ).toBe(true);
        }
        // arbitrary_extra_field is not allowed by any mode -> removed.
        expect(manifest.removed_fields).toContain("arbitrary_extra_field");
      });
    });
  }

  it("redacted_client_safe masks PII (email, phone, physical_address)", () => {
    const { redacted, manifest } = redactGovernanceRecord(
      makeFixture(),
      "redacted_client_safe",
    );
    // PII fields are not in the redacted_client_safe allow-list at the
    // top level, so they should be removed (not surface as values),
    // not masked-and-kept.
    expect(redacted).not.toHaveProperty("email");
    expect(redacted).not.toHaveProperty("phone_number");
    expect(redacted).not.toHaveProperty("physical_address");
    // They must show up in the manifest as removed (allow-list reject),
    // proving the redactor saw them and dropped them.
    for (const k of PII_MASK_FIELD_SUBSTRINGS) {
      // Only check the exact names present on the fixture.
      if (["email", "phone_number", "physical_address"].includes(k)) {
        expect(manifest.removed_fields).toContain(k);
      }
    }
  });

  it("metadata_only excludes evidence_summary, decision_summary and counterparty_label", () => {
    const { redacted } = redactGovernanceRecord(
      makeFixture(),
      "metadata_only",
    );
    expect(redacted).not.toHaveProperty("evidence_summary");
    expect(redacted).not.toHaveProperty("decision_summary");
    expect(redacted).not.toHaveProperty("counterparty_label");
    expect(redacted).not.toHaveProperty("reason_summary");
  });

  it("evidence_only includes evidence_summary and counts but not decision_summary", () => {
    const { redacted } = redactGovernanceRecord(
      makeFixture(),
      "evidence_only",
    );
    expect(redacted).toHaveProperty("evidence_summary");
    expect(redacted).toHaveProperty("evidence_counts");
    expect(redacted).not.toHaveProperty("decision_summary");
    expect(redacted).not.toHaveProperty("counterparty_label");
  });

  it("full_internal includes requester/approver ids and audit refs but still blocks every forbidden surface", () => {
    const { redacted, manifest } = redactGovernanceRecord(
      makeFixture(),
      "full_internal",
    );
    expect(redacted).toHaveProperty("requester_user_id", "u_req");
    expect(redacted).toHaveProperty("approver_user_id", "u_apr");
    expect(redacted).toHaveProperty("audit_reference_ids");
    expect(redacted).toHaveProperty("previous_status", "awaiting_approval");
    expect(redacted).toHaveProperty("new_status", "approved");
    expectNoForbiddenSurface(redacted);
    // full_internal documents that it intentionally keeps PII raw.
    expect(manifest.notes.join("\n")).toMatch(/full_internal/);
  });

  it("ALWAYS_FORBIDDEN list covers every dangerous surface category", () => {
    // Sanity floor for the contract — these MUST be present.
    const required = [
      "password",
      "api_key",
      "auth_token",
      "signed_url",
      "download_url",
      "download_token",
      "storage_path",
      "sanctions_raw",
      "pep_raw",
      "adverse_media_raw",
      "internal_notes",
      "admin_notes",
      "legal_hold_reason",
      "legal_hold_notes",
    ];
    for (const r of required) {
      expect(ALWAYS_FORBIDDEN_FIELD_SUBSTRINGS).toContain(r);
    }
  });

  it("MASK_TOKEN is a stable, non-empty placeholder", () => {
    expect(MASK_TOKEN).toBe("[REDACTED]");
  });
});
