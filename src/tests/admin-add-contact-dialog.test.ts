/**
 * AddContactDialog — schema + UX guard verification
 *
 * Confirms the contact-capture dialog's client-side validation matches the
 * intended workflow:
 *   • valid email is accepted → unblocks the existing Notify flow
 *   • `.invalid` placeholder addresses are rejected
 *   • missing/whitespace email is rejected
 *   • phone + notes are optional but length-bounded
 *
 * Backend contract is unchanged — these tests only pin the frontend gate
 * that decides whether the existing PATCH `counterparty_email` call is
 * even attempted.
 */

import { describe, it, expect } from "vitest";
import { addContactSchema } from "@/components/admin/AddContactDialog";

describe("addContactSchema", () => {
  it("accepts a plausibly deliverable email", () => {
    const r = addContactSchema.safeParse({ email: "ops@trade.izenzo.co.za" });
    expect(r.success).toBe(true);
  });

  it("rejects empty email", () => {
    const r = addContactSchema.safeParse({ email: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects malformed email", () => {
    const r = addContactSchema.safeParse({ email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects .invalid TLD test placeholders (mirrors RFC 2606)", () => {
    const cases = [
      "auto-link-tst-39d79cd5@izenzo-test.invalid",
      "anyone@example.invalid",
      "USER@FOO.INVALID",
    ];
    for (const email of cases) {
      const r = addContactSchema.safeParse({ email });
      expect(r.success, `expected ${email} to be rejected`).toBe(false);
    }
  });

  it("accepts optional phone + notes when within bounds", () => {
    const r = addContactSchema.safeParse({
      email: "buyer@acme.com",
      phone: "+27 82 555 0100",
      notes: "Found contact email on company website footer.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects over-long phone (>64) and notes (>2000)", () => {
    const longPhone = "+".padEnd(70, "1");
    const longNotes = "x".repeat(2001);
    expect(
      addContactSchema.safeParse({ email: "a@b.com", phone: longPhone }).success,
    ).toBe(false);
    expect(
      addContactSchema.safeParse({ email: "a@b.com", notes: longNotes }).success,
    ).toBe(false);
  });
});
