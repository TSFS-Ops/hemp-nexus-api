import { describe, expect, it } from "vitest";
import {
  deriveP5B2Notifications,
  filterExternalP5B2Notifications,
} from "@/lib/p5-batch2/notifications";

const NOW = "2026-06-24T12:00:00.000Z";

describe("p5-batch2 stage 6 notifications", () => {
  it("emits idempotent keys (same input → same key)", () => {
    const a = deriveP5B2Notifications({ trigger: "evidence_uploaded", evidence_item_id: "e1", record_id: "r1", now: NOW });
    const b = deriveP5B2Notifications({ trigger: "evidence_uploaded", evidence_item_id: "e1", record_id: "r1", now: NOW });
    expect(a.map((x) => x.idempotency_key).sort()).toEqual(b.map((x) => x.idempotency_key).sort());
  });

  it("rewrites suspected fraud to safe wording for any audience", () => {
    const out = deriveP5B2Notifications({ trigger: "suspected_fraud_or_tampering", record_id: "r1", now: NOW });
    for (const n of out) {
      expect(n.safe_message).toBe("Manual review required.");
      // suspected-fraud audiences are admin/compliance only — never customer.
      expect(["admin", "compliance_owner"]).toContain(n.audience);
    }
  });

  it("provider-dependent never uses forbidden wording", () => {
    const out = deriveP5B2Notifications({
      trigger: "provider_dependent_evidence",
      evidence_item_id: "e2",
      provider_live: false,
      now: NOW,
    });
    for (const n of out) {
      for (const banned of ["verified", "passed", "cleared", "sanctions clear", "bank verified", "provider approved", "no adverse result"]) {
        expect(n.safe_message.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it("external audiences never receive internal_message text", () => {
    const out = deriveP5B2Notifications({
      trigger: "evidence_rejected",
      rejection_reason: "suspected_fraud_or_tampering",
      internal_note: "DO NOT LEAK — internal forensic note",
      now: NOW,
    });
    const ext = filterExternalP5B2Notifications(out);
    for (const n of ext) {
      expect(n.internal_message).toBe(n.safe_message);
      expect(n.internal_message).not.toContain("DO NOT LEAK");
    }
  });

  it("rejection reason maps to safe customer wording", () => {
    const out = deriveP5B2Notifications({
      trigger: "evidence_rejected",
      rejection_reason: "expired_document",
      now: NOW,
    });
    expect(out[0].safe_message).toContain("expired");
  });

  it("emits audit_action for every output", () => {
    const out = deriveP5B2Notifications({ trigger: "bank_details_changed", record_id: "r1", now: NOW });
    expect(out.every((n) => n.audit_action.startsWith("p5b2.notif."))).toBe(true);
  });

  it("covers all 13 triggers", () => {
    const triggers = [
      "evidence_requested", "evidence_uploaded", "evidence_accepted", "evidence_accepted_with_warning",
      "evidence_rejected", "mandatory_evidence_missing", "evidence_expired", "evidence_expiring",
      "bank_details_changed", "high_risk_ubo_evidence", "provider_dependent_evidence",
      "suspected_fraud_or_tampering", "replacement_uploaded",
    ] as const;
    for (const t of triggers) {
      const out = deriveP5B2Notifications({ trigger: t, days_to_expiry: 7, now: NOW });
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
