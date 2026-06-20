/**
 * Batch 4 — Authority-to-Act, Bank Detail Capture, Verified Status Model.
 * Static / structural proofs only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tsAuth = readFileSync("src/lib/registry-authority.ts", "utf8");
const denoAuth = readFileSync("supabase/functions/_shared/registry-authority.ts", "utf8");
const tsBank = readFileSync("src/lib/registry-bank-details.ts", "utf8");
const denoBank = readFileSync("supabase/functions/_shared/registry-bank-details.ts", "utf8");

const authRequestEdge = readFileSync("supabase/functions/registry-authority-request/index.ts", "utf8");
const authReviewEdge = readFileSync("supabase/functions/registry-authority-review/index.ts", "utf8");
const bankSubmitEdge = readFileSync("supabase/functions/registry-bank-detail-submit/index.ts", "utf8");
const bankStatusEdge = readFileSync("supabase/functions/registry-bank-detail-status-transition/index.ts", "utf8");
const bankAccessEdge = readFileSync("supabase/functions/registry-bank-detail-access/index.ts", "utf8");

const adminAuth = readFileSync("src/pages/admin/registry/Authority.tsx", "utf8");
const adminBank = readFileSync("src/pages/admin/registry/BankDetails.tsx", "utf8");
const userAuth = readFileSync("src/pages/registry/Authority.tsx", "utf8");
const userBank = readFileSync("src/pages/registry/BankDetails.tsx", "utf8");

const AUTH_COPY = "Approving authority confirms only that this person may act for the company within the recorded scope. It does not verify the company profile or any bank details.";
const BANK_COPY = "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry.";

describe("Batch 4 — SSOT parity", () => {
  for (const name of ["REGISTRY_AUTHORITY_STATES", "REGISTRY_AUTHORITY_BASES", "REGISTRY_AUTHORITY_AUDIT_EVENT_NAMES"]) {
    it(`authority ${name} TS ↔ Deno`, () => {
      const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
      expect(tsAuth.match(re)?.[1].replace(/\s+/g, "")).toBe(denoAuth.match(re)?.[1].replace(/\s+/g, ""));
    });
  }
  for (const name of ["REGISTRY_BANK_DETAIL_STATES", "REGISTRY_BANK_DETAIL_CONSENT_SCOPES", "REGISTRY_BANK_DETAIL_AUDIT_EVENT_NAMES"]) {
    it(`bank-detail ${name} TS ↔ Deno`, () => {
      const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
      expect(tsBank.match(re)?.[1].replace(/\s+/g, "")).toBe(denoBank.match(re)?.[1].replace(/\s+/g, ""));
    });
  }
});

describe("Batch 4 — Authority workflow guarantees", () => {
  it("authority request writer supports start / submit / add_evidence / cancel", () => {
    for (const a of ["start", "submit", "add_evidence", "cancel"]) expect(authRequestEdge).toContain(`"${a}"`);
  });
  it("authority review writer is admin/compliance only", () => {
    expect(authReviewEdge).toContain('"platform_admin"');
    expect(authReviewEdge).toContain('"compliance_owner"');
    expect(authReviewEdge).toContain('"forbidden"');
  });
  it("admin authority review requires non-verification acknowledgements", () => {
    expect(authReviewEdge).toMatch(/acknowledged_not_company_verification:\s*z\.literal\(true\)/);
    expect(authReviewEdge).toMatch(/acknowledged_not_bank_verification:\s*z\.literal\(true\)/);
  });
  it("authority approval copy is rendered verbatim on admin surface", () => {
    expect(adminAuth).toContain(AUTH_COPY);
  });
  it("authority cannot auto-approve (only review function reaches approved/conditionally_approved)", () => {
    // The user-facing request edge function must never set status to approved.
    expect(authRequestEdge).not.toMatch(/status:\s*"approved"/);
    expect(authRequestEdge).not.toMatch(/status:\s*"conditionally_approved"/);
  });
});

describe("Batch 4 — Bank-detail capture gating + verified semantics", () => {
  it("bank capture edge function gates on approved/conditionally_approved authority", () => {
    expect(bankSubmitEdge).toContain("REGISTRY_AUTHORITY_APPROVED_STATES");
    expect(bankSubmitEdge).toContain("authority_not_approved");
  });
  it("captured submissions land in captured_unverified", () => {
    expect(bankSubmitEdge).toContain('status: "captured_unverified"');
  });
  it("verified transition requires method + expiry", () => {
    expect(bankStatusEdge).toContain("verified_requires_method_and_expiry");
    expect(bankStatusEdge).toContain("verification_method");
    expect(bankStatusEdge).toContain("expiry_at");
  });
  it("verified write sets verified_at, verified_by, method, expiry", () => {
    expect(bankStatusEdge).toMatch(/update\.verified_at\s*=/);
    expect(bankStatusEdge).toMatch(/update\.verified_by\s*=/);
    expect(bankStatusEdge).toMatch(/update\.verification_method\s*=/);
    expect(bankStatusEdge).toMatch(/update\.expiry_at\s*=/);
  });
  it("admin status transition is admin/compliance only", () => {
    expect(bankStatusEdge).toContain('"platform_admin"');
    expect(bankStatusEdge).toContain('"compliance_owner"');
    expect(bankStatusEdge).toContain('"forbidden"');
  });
  it("captured-not-verified copy rendered on user + admin bank surfaces", () => {
    expect(userBank).toContain(BANK_COPY);
    expect(adminBank).toContain(BANK_COPY);
  });
});

describe("Batch 4 — Bank-detail access + masking", () => {
  it("unmasked-access requires reason ≥ 20 chars", () => {
    expect(bankAccessEdge).toMatch(/reason\.length\s*<\s*20/);
  });
  it("unmasked-read is admin/compliance only", () => {
    expect(bankAccessEdge).toMatch(/forbidden/);
    expect(bankAccessEdge).toMatch(/platform_admin|compliance_owner/);
  });
  it("user-facing pages render masked previews only", () => {
    // The user bank-details page exposes the input fields once at capture
    // time and otherwise displays only masked_* columns.
    expect(userBank).toMatch(/masked_account_number|masked_iban/);
  });
  it("admin queue uses masked columns by default", () => {
    expect(adminBank).toMatch(/masked_account_number/);
    expect(adminBank).not.toMatch(/select\([^)]*enc_account_number/);
  });
});

describe("Batch 4 — Out of scope (no provider, no API facade)", () => {
  it("no Batch 4 edge function references CIPC/Onfido/etc.", () => {
    const src = [authRequestEdge, authReviewEdge, bankSubmitEdge, bankStatusEdge, bankAccessEdge].join("\n").toLowerCase();
    for (const p of ["cipc", "onfido", "globaldatabase", "b2bhint", "refinitiv", "dowjones", "payfast"]) {
      expect(src).not.toContain(p);
    }
  });
});
