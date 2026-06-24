import { describe, expect, it } from "vitest";
import { computeP5B2Expiry, P5B2_EXPIRY_POLICIES, P5B2_REMINDER_DAYS_BEFORE } from "@/lib/p5-batch2/expiry-rules";

const NOW = "2026-06-24T12:00:00.000Z";

describe("p5-batch2 expiry-rules", () => {
  it("applies 90-day window to proof_of_address by default", () => {
    expect(P5B2_EXPIRY_POLICIES.proof_of_address.default_validity_days).toBe(90);
  });

  it("applies 30-day window to bank_confirmation_payment_finality", () => {
    const policy = P5B2_EXPIRY_POLICIES.bank_confirmation_payment_finality;
    expect(policy.default_validity_days).toBe(30);
    expect(policy.admin_extendable).toBe(true);
  });

  it("computes effective expiry from issued_at + cadence for id_or_passport without expiry", () => {
    const r = computeP5B2Expiry({
      category: "id_or_passport",
      document_expiry: null,
      issued_at: "2024-06-24T00:00:00.000Z",
      now: NOW,
    });
    expect(r.effective_expiry).toBeTruthy();
    expect(r.is_expired).toBe(false);
  });

  it("flags expired when effective expiry is in the past", () => {
    const r = computeP5B2Expiry({
      category: "proof_of_address",
      document_expiry: null,
      issued_at: "2025-01-01T00:00:00.000Z",
      now: NOW,
    });
    expect(r.is_expired).toBe(true);
  });

  it("picks earliest of document expiry vs default validity", () => {
    const r = computeP5B2Expiry({
      category: "tax_or_vat",
      document_expiry: "2026-07-01T00:00:00.000Z",
      issued_at: "2026-06-01T00:00:00.000Z", // +180d default would be ~ end Nov
      now: NOW,
    });
    expect(r.effective_expiry).toBe("2026-07-01T00:00:00.000Z");
  });

  it("emits 30 / 14 / 7 day reminders for not-yet-expired evidence", () => {
    const r = computeP5B2Expiry({
      category: "tax_or_vat",
      document_expiry: "2027-01-01T00:00:00.000Z",
      issued_at: null,
      now: NOW,
    });
    expect(r.reminders_due.length).toBe(P5B2_REMINDER_DAYS_BEFORE.length);
  });

  it("admin extension applies only on extendable categories", () => {
    const r = computeP5B2Expiry({
      category: "proof_of_address",
      document_expiry: null,
      issued_at: "2026-06-01T00:00:00.000Z",
      now: NOW,
      admin_extended_expiry: "2030-01-01T00:00:00.000Z",
    });
    // proof_of_address is NOT admin_extendable — extension must be ignored.
    expect(new Date(r.effective_expiry!).getFullYear()).toBeLessThan(2030);
  });
});
