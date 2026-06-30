/**
 * C9 F-API-01 — registry-bank-verification-api-status response shaping.
 *
 * Pins that the external public response no longer leaks raw internal
 * `verification_status` vocabulary, while internal audit insert still
 * records the full raw value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fn = readFileSync(
  resolve(__dirname, "../../supabase/functions/registry-bank-verification-api-status/index.ts"),
  "utf8",
);

describe("C9 F-API-01 — public response shape", () => {
  it("does not include verification_status in the public 200 response object", () => {
    // The only remaining occurrence of `verification_status:` must be inside
    // the audit-insert payload, not the json() success body.
    const successBlock = fn.split("return json(req, 200, {")[1] ?? "";
    const beforeClose = successBlock.split("});")[0] ?? "";
    expect(beforeClose).not.toMatch(/verification_status\s*:/);
  });

  it("still returns payment_detail_status and safe_label", () => {
    const successBlock = fn.split("return json(req, 200, {")[1] ?? "";
    const beforeClose = successBlock.split("});")[0] ?? "";
    expect(beforeClose).toMatch(/payment_detail_status\s*:/);
    expect(beforeClose).toMatch(/safe_label\s*:/);
    expect(beforeClose).toMatch(/audit_reference\s*:/);
    expect(beforeClose).toMatch(/request_id\s*:/);
    expect(beforeClose).toMatch(/company_reference/);
  });

  it("error responses (401/403/400/500) do not leak verification_status", () => {
    // Every json(req, <non-200>, …) call body must not mention verification_status.
    const errorCalls = [...fn.matchAll(/json\(req,\s*(?:400|401|403|500)[\s\S]*?\}\);/g)].map(
      (m) => m[0],
    );
    expect(errorCalls.length).toBeGreaterThan(0);
    for (const call of errorCalls) {
      expect(call).not.toMatch(/verification_status/);
    }
  });

  it("internal audit insert still records raw verification_status", () => {
    expect(fn).toMatch(
      /registry_bank_detail_verification_events[\s\S]*verification_status:\s*verificationStatus/,
    );
  });

  it("payment_detail_status flag remains derived from the strict mapper", () => {
    expect(fn).toMatch(/mapVerificationStatusToApiFlag\(verificationStatus\)/);
    // Verified gate stays strict: requires business-decision approval.
    expect(fn).toMatch(/apiFlag\s*=\s*"not_verified"/);
    expect(fn).toMatch(/bdApproved/);
    // Expiry enforcement preserved.
    expect(fn).toMatch(/verificationStatus\s*=\s*"expired"/);
  });

  it("auth + scope checks remain intact", () => {
    expect(fn).toMatch(/apiKey\.startsWith\("rk_"\)/);
    expect(fn).toMatch(/hashApiKey\(apiKey\)/);
    expect(fn).toMatch(/auth\.scopes\.includes\(scope\)/);
    expect(fn).toMatch(/payment_detail_status:\s*"not_verified"/); // safe 401/403 payload
  });

  it("does not introduce any DB write beyond the existing audit insert", () => {
    const inserts = [...fn.matchAll(/\.from\(["'][^"']+["']\)\s*\.insert\(/g)];
    expect(inserts.length).toBe(1);
  });

  it("payment_detail_status values are restricted to the public-safe set", () => {
    // Sourced from RegistryBankApiPaymentFlag in the shared module.
    const shared = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/registry-bank-verification.ts"),
      "utf8",
    );
    expect(shared).toMatch(
      /type\s+RegistryBankApiPaymentFlag\s*=\s*\|\s*"verified"\s*\|\s*"not_verified"\s*\|\s*"expired"\s*\|\s*"disputed"\s*\|\s*"revoked"\s*\|\s*"not_available"/,
    );
  });
});
