/**
 * P-5 Batch 3 — Stage 3 safe summary edge function static checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FN = join(process.cwd(), "supabase/functions/p5-batch3-funder-summary/index.ts");

describe("P5 Batch 3 Stage 3 — funder summary edge fn", () => {
  it("exists", () => {
    expect(existsSync(FN)).toBe(true);
  });

  const src = readFileSync(FN, "utf8");

  it("is not a public /api/v1/funder/* route", () => {
    expect(src).not.toMatch(/\/api\/v1\/funder/);
  });

  it("validates a JWT before serving data", () => {
    expect(src).toMatch(/auth_required/);
    expect(src).toMatch(/Authorization/);
  });

  it("only selects allow-listed columns from Batch 3 tables", () => {
    // The .select() string must NOT mention raw sensitive column names.
    const forbidden = [
      "raw_bank_account_number",
      "raw_iban",
      "raw_id_number",
      "raw_passport_number",
      "raw_ubo_details",
      "admin_internal_notes",
      "fraud_flag",
      "provider_raw_response",
      "provider_test_data",
      "notes_internal",
      "other_funder_status",
    ];
    for (const f of forbidden) expect(src).not.toMatch(new RegExp(f));
  });

  it("denies expired/revoked grants with denied:true response", () => {
    expect(src).toMatch(/grant_expired_or_revoked/);
    expect(src).toMatch(/no_active_grant/);
    expect(src).toMatch(/denied:\s*true/);
  });

  it("applies safe provider label allow-list (no Verified/Investment Grade leakage)", () => {
    expect(src).toMatch(/safeProviderLabel/);
    expect(src).toMatch(/Investment Grade/); // present in UNSAFE_LABELS set
    expect(src).toMatch(/External Provider Result Pending/);
  });

  it("masks bank values by default", () => {
    expect(src).toMatch(/maskBank/);
  });

  it("applies a default field allow-list filter", () => {
    expect(src).toMatch(/ALLOWED_FIELDS/);
    expect(src).toMatch(/applyAllowList/);
  });
});
