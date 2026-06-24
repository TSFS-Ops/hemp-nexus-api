import { describe, expect, it } from "vitest";
import { maskP5B2Field, maskP5B2Object, isP5B2AdminOnlyField } from "@/lib/p5-batch2/masking";

describe("p5-batch2 masking", () => {
  it("masks bank account number to last 4 for non-admin", () => {
    const r = maskP5B2Field("bank_account_number", "1234567890", { viewer: "counterparty" });
    expect(r.endsWith("7890")).toBe(true);
    expect(r).not.toContain("12345");
  });

  it("returns raw bank account number for admin viewer", () => {
    const r = maskP5B2Field("bank_account_number", "1234567890", { viewer: "admin" });
    expect(r).toBe("1234567890");
  });

  it("masks id_or_passport to last 4 for funder", () => {
    const r = maskP5B2Field("id_or_passport_number", "AB123456789", { viewer: "funder" });
    expect(r.endsWith("6789")).toBe(true);
  });

  it("partial-masks tax/VAT number", () => {
    const r = maskP5B2Field("tax_or_vat_number", "ZA1234567890", { viewer: "counterparty" });
    expect(r).toContain("••");
    expect(r).not.toBe("ZA1234567890");
  });

  it("hides admin-only fields entirely from non-admin viewers", () => {
    const fields = ["reviewer_note_internal", "fraud_flag", "provider_raw_response"] as const;
    for (const f of fields) {
      expect(isP5B2AdminOnlyField(f)).toBe(true);
      expect(maskP5B2Field(f, "secret", { viewer: "funder" })).toBe("");
      expect(maskP5B2Field(f, "secret", { viewer: "api_user" })).toBe("");
      expect(maskP5B2Field(f, "secret", { viewer: "organisation_user" })).toBe("");
      expect(maskP5B2Field(f, "secret", { viewer: "counterparty" })).toBe("");
    }
  });

  it("returns admin-only fields for compliance_owner", () => {
    const r = maskP5B2Field("reviewer_note_internal", "internal note", {
      viewer: "organisation_user",
      is_compliance_owner: true,
    });
    expect(r).toBe("internal note");
  });

  it("renders address as country/city summary for funder/api", () => {
    const r = maskP5B2Field("physical_address", "12 Long Rd, Cape Town, ZA", { viewer: "funder" });
    expect(r).toBe("Address on file");
  });

  it("masks personal contact details for funder/api", () => {
    const r = maskP5B2Field("personal_contact_details", "user@example.com", { viewer: "api_user" });
    expect(r).toBe("Contact on file");
  });

  it("maskP5B2Object masks a whole object using a field map", () => {
    const masked = maskP5B2Object(
      { bank: "1234567890", note: "hello", tax: "ZA999888777" },
      { bank: "bank_account_number", tax: "tax_or_vat_number" },
      { viewer: "funder" },
    );
    expect(masked.bank).not.toBe("1234567890");
    expect(masked.tax).not.toBe("ZA999888777");
    expect(masked.note).toBe("hello");
  });
});
