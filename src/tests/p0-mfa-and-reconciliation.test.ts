/**
 * P0 regression guards for SEC-001 (MFA/AAL2) and the burn/POI
 * reconciliation function. Static-source assertions only — no runtime
 * Deno spin-up is needed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const aalHelper = read("../../supabase/functions/_shared/aal.ts");
const adminCreditOrg = read("../../supabase/functions/admin-credit-org/index.ts");
const adminLifecycle = read("../../supabase/functions/admin-run-lifecycle/index.ts");
const reconciliation = read("../../supabase/functions/burn-poi-reconciliation/index.ts");
const sweeper = read("../../supabase/functions/account-deletion-sweeper/index.ts");
const billingPage = read("../pages/Billing.tsx");

describe("SEC-001 — assertAal2 helper", () => {
  it("exports assertAal2 and readAal", () => {
    expect(aalHelper).toMatch(/export\s+function\s+readAal/);
    expect(aalHelper).toMatch(/export\s+async\s+function\s+assertAal2/);
  });
  it("throws ApiException with code MFA_REQUIRED and HTTP 403", () => {
    expect(aalHelper).toMatch(/MFA_REQUIRED/);
    expect(aalHelper).toMatch(/403/);
  });
  it("fails closed on unknown / aal1 sessions", () => {
    // Only 'aal2' is allowed through.
    expect(aalHelper).toMatch(/if\s*\(\s*aal\s*===\s*"aal2"\s*\)\s*return/);
  });
});

describe("SEC-001 — admin-credit-org enforces AAL2", () => {
  it("imports the assertAal2 helper", () => {
    expect(adminCreditOrg).toMatch(/from\s+['"]\.\.\/_shared\/aal\.ts['"]/);
    expect(adminCreditOrg).toMatch(/assertAal2/);
  });
  it("calls assertAal2 after RBAC check and returns 403 MFA_REQUIRED", () => {
    expect(adminCreditOrg).toMatch(/await\s+assertAal2\(/);
    expect(adminCreditOrg).toMatch(/code:\s*['"]MFA_REQUIRED['"]/);
  });
  it("audits the MFA failure", () => {
    expect(adminCreditOrg).toMatch(/stage:\s*['"]mfa_check['"]/);
  });
});

describe("SEC-001 — admin-run-lifecycle enforces AAL2", () => {
  it("calls assertAal2 with the request Authorization header", () => {
    expect(adminLifecycle).toMatch(/from\s+['"]\.\.\/_shared\/aal\.ts['"]/);
    expect(adminLifecycle).toMatch(/assertAal2\(\s*req\.headers\.get\(\s*['"]Authorization['"]/);
  });
});

describe("P0-4 — burn/POI reconciliation function", () => {
  it("requires INTERNAL_CRON_KEY or service_role auth, fails closed", () => {
    expect(reconciliation).toMatch(/INTERNAL_CRON_KEY/);
    expect(reconciliation).toMatch(/UNAUTHORIZED/);
  });
  it("queries token_ledger for declare_intent burns", () => {
    expect(reconciliation).toMatch(/action_type['"]?\s*,\s*['"]declare_intent['"]/);
  });
  it("checks both directions — burns_without_poi AND pois_without_burn", () => {
    expect(reconciliation).toMatch(/burnsWithoutPoi/);
    expect(reconciliation).toMatch(/poisWithoutBurn/);
  });
  it("considers exempt_burn audit rows so founder-exempt POIs are not flagged", () => {
    expect(reconciliation).toMatch(/exempt_burn/);
  });
  it("never mutates balances (no atomic_token_credit / atomic_token_burn calls)", () => {
    expect(reconciliation).not.toMatch(/atomic_token_credit/);
    expect(reconciliation).not.toMatch(/atomic_token_burn/);
  });
  it("writes a reconciliation audit row", () => {
    expect(reconciliation).toMatch(/reconciliation\.burn_poi\.run/);
  });
});

describe("P0-5 — account-deletion-sweeper safety guards remain in place", () => {
  it("defaults to dry-run", () => {
    expect(sweeper).toMatch(/const\s+dryRun\s*=\s*body\.dry_run\s*!==\s*false/);
  });
  it("requires explicit HARD_DELETE confirmation for destructive runs", () => {
    expect(sweeper).toMatch(/confirm.*HARD_DELETE/);
    expect(sweeper).toMatch(/DESTRUCTIVE_CONFIRMATION_REQUIRED/);
  });
  it("skips accounts with active POIs or open disputes", () => {
    expect(sweeper).toMatch(/org_has_active_pois/);
    expect(sweeper).toMatch(/org_has_open_disputes/);
  });
  it("skips platform_admin accounts", () => {
    expect(sweeper).toMatch(/platform_admin_requires_break_glass/);
  });
});

describe("P0-3 — payment callback shows settling state until webhook confirms", () => {
  it("declares paymentSettling state", () => {
    expect(billingPage).toMatch(/setPaymentSettling/);
  });
  it("clears settling on verify success", () => {
    // Both success branches (with and without status=success) clear it.
    const matches = billingPage.match(/setPaymentSettling\(null\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
  it("sets settling when verify is unconfirmed (no terminal Paystack status)", () => {
    const matches = billingPage.match(/setPaymentSettling\(\{\s*reference\s*\}\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
  it("renders a persistent settling banner (not just a toast)", () => {
    expect(billingPage).toMatch(/Payment settling/);
    expect(billingPage).toMatch(/paymentSettling\s*&&/);
  });
});
