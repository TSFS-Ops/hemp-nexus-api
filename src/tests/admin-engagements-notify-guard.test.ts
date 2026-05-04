/**
 * AdminPendingEngagementsPanel — Notify / preview-outreach guard
 *
 * Frontend UX guard verification for the "Could not load email preview"
 * defect. The backend (`poi-engagements/preview-outreach`) is the source of
 * truth and is unchanged; these tests pin the client-side gate that prevents
 * admins from triggering a preview/send on engagements that have no usable
 * counterparty email — which previously surfaced as a generic toast.
 *
 * Rules under test (see component: src/components/admin/AdminPendingEngagementsPanel.tsx):
 *   • Missing / null / empty / whitespace-only email → not usable.
 *   • Reserved `.invalid` TLD (RFC 2606) — including the platform's
 *     `auto-link-tst-…@izenzo-test.invalid` placeholders — → not usable.
 *   • Anything malformed (no '@', dangling '@', double '@') → not usable.
 *   • Plausibly deliverable address → usable (final verdict still server-side).
 */

import { describe, it, expect } from "vitest";
import { isUsableOutreachEmail } from "@/components/admin/AdminPendingEngagementsPanel";

describe("isUsableOutreachEmail", () => {
  it("rejects null/undefined/empty/whitespace", () => {
    expect(isUsableOutreachEmail(null)).toBe(false);
    expect(isUsableOutreachEmail(undefined)).toBe(false);
    expect(isUsableOutreachEmail("")).toBe(false);
    expect(isUsableOutreachEmail("   ")).toBe(false);
  });

  it("rejects reserved .invalid TLD (test placeholders)", () => {
    expect(isUsableOutreachEmail("auto-link-tst-39d79cd5@izenzo-test.invalid")).toBe(false);
    expect(isUsableOutreachEmail("anyone@example.invalid")).toBe(false);
    expect(isUsableOutreachEmail("user@invalid")).toBe(false);
    // Case-insensitive
    expect(isUsableOutreachEmail("USER@FOO.INVALID")).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(isUsableOutreachEmail("no-at-sign")).toBe(false);
    expect(isUsableOutreachEmail("@example.com")).toBe(false);
    expect(isUsableOutreachEmail("user@")).toBe(false);
    expect(isUsableOutreachEmail("a@b@c.com")).toBe(false);
  });

  it("accepts plausibly deliverable addresses", () => {
    expect(isUsableOutreachEmail("verify-test@example.com")).toBe(true);
    expect(isUsableOutreachEmail("buyer@izenzo.co.za")).toBe(true);
    // Whitespace-padded but otherwise valid
    expect(isUsableOutreachEmail("  ops@trade.izenzo.co.za  ")).toBe(true);
  });
});
