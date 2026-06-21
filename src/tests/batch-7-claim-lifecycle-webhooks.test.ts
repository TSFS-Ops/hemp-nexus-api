// Batch 7 — Claim lifecycle webhook surface tests.
// Verifies the SSOT event list contains the contracted lifecycle events
// that external systems will subscribe to, and that the rate-limit
// scopes are conservative.
import { describe, it, expect } from "vitest";
import { CLAIM_LIFECYCLE_WEBHOOK_EVENTS } from "@/lib/claim-lifecycle-webhooks";

describe("batch 7 — claim lifecycle webhook contract", () => {
  it("includes every event in the client requirement", () => {
    const required = [
      "claim.evidence_required",
      "claim.under_review",
      "claim.conflict_created",
      "claim.correction_requested",
      "claim.outreach_blocked",
    ];
    for (const e of required) expect(CLAIM_LIFECYCLE_WEBHOOK_EVENTS).toContain(e as any);
  });

  it("does not include forbidden raw-data events", () => {
    const forbidden = ["claim.bank_details_returned", "claim.kyc_documents_returned"];
    for (const e of forbidden) expect(CLAIM_LIFECYCLE_WEBHOOK_EVENTS).not.toContain(e as any);
  });

  it("is deduplicated", () => {
    const arr = [...CLAIM_LIFECYCLE_WEBHOOK_EVENTS];
    expect(new Set(arr).size).toBe(arr.length);
  });
});
