/**
 * Public API V1 — Batch 7 contract guards.
 *
 * Static source-contract tests for commercial plans, plan assignments,
 * plan-aware monthly allowance, billing visibility derived from
 * api_request_logs, audit lifecycle, RLS scoping, and the Batch 7 hard
 * exclusions (no payment rails, no invoices, no /v1/usage/current, no
 * client/internal monitoring dashboards, no docs/OpenAPI, no support
 * intake, no webhook changes, no write API, no POI/WaD/compliance/
 * verification/payment decisions).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const BILLING = "supabase/functions/_shared/public-api-v1-billing.ts";
const USAGE = "supabase/functions/_shared/public-api-v1-usage.ts";
const GATEWAY = "supabase/functions/_shared/public-api-v1.ts";
const ENTRY = "supabase/functions/public-api/index.ts";
const PANEL = "src/components/admin/AdminApiClientsPanel.tsx";

function findBatch7Migration(): string {
  const migDir = path.join(ROOT, "supabase/migrations");
  for (const f of fs.readdirSync(migDir)) {
    const body = fs.readFileSync(path.join(migDir, f), "utf-8");
    if (/api_commercial_plans/.test(body) && /api_client_plan_assignments/.test(body)) {
      return body;
    }
  }
  return "";
}

describe("Public API V1 · Batch 7 · commercial plans + billing visibility", () => {
  it("api_commercial_plans table exists with required fields and non-negative constraints", () => {
    const body = findBatch7Migration();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/create table[^;]*api_commercial_plans/i);
    for (const f of [
      "plan_name", "description", "currency", "monthly_fee",
      "included_lookup_allowance", "overage_price_per_successful_lookup",
      "manual_review_fee", "billing_cycle", "overage_allowed", "active",
    ]) {
      expect(body).toMatch(new RegExp(f));
    }
    // Currency constrained to 3 uppercase letters.
    expect(body).toMatch(/check\s*\(\s*currency\s*~\s*'\^\[A-Z\]\{3\}\$'\s*\)/);
    // Non-negative numeric checks.
    expect(body).toMatch(/monthly_fee\s+numeric[\s\S]*check\s*\(\s*monthly_fee\s*>=\s*0\s*\)/i);
    expect(body).toMatch(/included_lookup_allowance[\s\S]*check\s*\(\s*included_lookup_allowance\s*>=\s*0\s*\)/i);
    expect(body).toMatch(/overage_price_per_successful_lookup[\s\S]*check\s*\(\s*overage_price_per_successful_lookup\s*>=\s*0\s*\)/i);
    expect(body).toMatch(/manual_review_fee[\s\S]*check\s*\(\s*manual_review_fee\s*>=\s*0\s*\)/i);
    // Billing cycle at least supports monthly.
    expect(body).toMatch(/billing_cycle\s+text[\s\S]*'monthly'/i);
    // Plan name unique.
    expect(body).toMatch(/unique index[^;]*api_commercial_plans/i);
  });

  it("api_client_plan_assignments table exists with one-active-per-client enforcement", () => {
    const body = findBatch7Migration();
    expect(body).toMatch(/create table[^;]*api_client_plan_assignments/i);
    for (const f of ["api_client_id", "api_commercial_plan_id", "starts_at", "ends_at", "active", "assigned_by", "assigned_at", "reason"]) {
      expect(body).toMatch(new RegExp(f));
    }
    // Only one ACTIVE assignment per api_client (partial unique index).
    expect(body).toMatch(/unique index[^;]*api_client_plan_assignments[\s\S]*\(\s*api_client_id\s*\)\s*where\s+active/i);
  });

  it("RLS: platform_admin manages plans + assignments; api_admin/auditor read-only; ordinary users no access", () => {
    const body = findBatch7Migration();
    // platform_admin manages (FOR ALL)
    expect(body).toMatch(/platform_admin manages commercial plans[\s\S]*for all[\s\S]*platform_admin/i);
    expect(body).toMatch(/platform_admin manages plan assignments[\s\S]*for all[\s\S]*platform_admin/i);
    // api_admin + auditor read-only (FOR SELECT)
    expect(body).toMatch(/api_admin auditor read commercial plans[\s\S]*for select[\s\S]*api_admin[\s\S]*auditor/i);
    expect(body).toMatch(/api_admin auditor read plan assignments[\s\S]*for select[\s\S]*api_admin[\s\S]*auditor/i);
    // No FOR ALL policies granted to api_admin/auditor on these tables
    expect(body).not.toMatch(/api_admin[^"]*manages/i);
    expect(body).not.toMatch(/auditor[^"]*manages/i);
    // No public/anon grants
    expect(body).not.toMatch(/grant[^;]*api_commercial_plans[^;]*to\s+anon/i);
    expect(body).not.toMatch(/grant[^;]*api_client_plan_assignments[^;]*to\s+anon/i);
  });

  it("billing visibility helper exists and derives from api_request_logs", () => {
    expect(exists(BILLING)).toBe(true);
    const src = read(BILLING);
    expect(src).toMatch(/computeBillingVisibility/);
    expect(src).toMatch(/from\("api_request_logs"\)/);
    // Production only, billable=true, error_code IS NULL, countable endpoints
    expect(src).toMatch(/\.eq\("environment",\s*"production"\)/);
    expect(src).toMatch(/\.eq\("billable",\s*true\)/);
    expect(src).toMatch(/\.is\("error_code",\s*null\)/);
    expect(src).toMatch(/V1_COUNTABLE_ENDPOINTS/);
    // Overage floored at zero
    expect(src).toMatch(/Math\.max\(0,\s*billable\s*-\s*allowance\)/);
    // Estimated total = monthly_fee + estimated overage
    expect(src).toMatch(/monthlyFee\s*\+\s*estimatedOverageAmount/);
  });

  it("billing visibility exposes the required fields and no forbidden fields", () => {
    const src = read(BILLING);
    for (const f of [
      "api_client_id", "plan_id", "plan_name", "currency", "monthly_fee",
      "included_lookup_allowance", "successful_billable_lookups", "included_used",
      "overage_lookups", "overage_price_per_successful_lookup",
      "estimated_overage_amount", "estimated_total_amount",
      "billing_period_start", "billing_period_end", "overage_allowed", "generated_at",
    ]) {
      expect(src).toMatch(new RegExp(f));
    }
    // No invoice/payment/tax fields surfaced in the visibility shape
    expect(src).not.toMatch(/invoice_number/i);
    expect(src).not.toMatch(/tax_amount/i);
    expect(src).not.toMatch(/payment_status/i);
    expect(src).not.toMatch(/card_/i);
    expect(src).not.toMatch(/bank_account/i);
    expect(src).not.toMatch(/payment_method/i);
  });

  it("plan-aware monthly allowance is wired into the gateway (production uses plan when assigned)", () => {
    const usage = read(USAGE);
    expect(usage).toMatch(/options\?:\s*\{\s*baseOverride\?: number;\s*strictAtAllowance\?: boolean\s*\}/);
    // strict mode → block at allowance; default → block at 120%
    expect(usage).toMatch(/options\?\.strictAtAllowance/);
    expect(usage).toMatch(/baseOverride/);
    const gw = read(GATEWAY);
    expect(gw).toMatch(/getActivePlanForClient/);
    expect(gw).toMatch(/strictAtAllowance\s*=\s*!resolved\.plan\.overage_allowed/);
    expect(gw).toMatch(/baseOverride\s*=\s*resolved\.plan\.included_lookup_allowance/);
    // Temporary override still takes precedence — evaluateMonthlyAllowance
    // continues to consult api_usage_overrides and prefers override_limit.
    expect(usage).toMatch(/from\("api_usage_overrides"\)/);
    expect(usage).toMatch(/override\?\.override_limit\s*\?\?\s*baseLimit/);
  });

  it("default production allowance falls back to 5,000 when no plan assigned", () => {
    const billing = read(BILLING);
    expect(billing).toMatch(/V1_DEFAULT_MONTHLY_PROD/);
    const usage = read(USAGE);
    expect(usage).toMatch(/V1_DEFAULT_MONTHLY_PROD\s*=\s*5[_]?000/);
  });

  it("admin panel exposes plan assignment, billing visibility and plan catalogue surfaces", () => {
    const src = read(PANEL);
    expect(src).toMatch(/CommercialPlanSection/);
    expect(src).toMatch(/BillingVisibilitySection/);
    expect(src).toMatch(/CommercialPlanCataloguePanel/);
    // Audit events
    expect(src).toMatch(/api_commercial_plan\.assigned/);
    expect(src).toMatch(/api_commercial_plan\.changed/);
    expect(src).toMatch(/api_commercial_plan\.assignment_ended/);
    expect(src).toMatch(/api_commercial_plan\.created/);
    expect(src).toMatch(/api_commercial_plan\.deactivated/);
    // No payment buttons / no invoice panels / no client dashboard
    expect(src).not.toMatch(/ClientUsageDashboard/);
    expect(src).not.toMatch(/InvoicesPanel/);
    expect(src).not.toMatch(/PayWith(PayFast|Paystack|Stripe)/i);
    expect(src).not.toMatch(/InvoicePdf/i);
  });

  it("hard exclusions — no payment rails, no invoices, no /v1/usage, no docs, no support intake", () => {
    // No new edge functions for these surfaces
    expect(exists("supabase/functions/public-api-usage-current")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);
    expect(exists("supabase/functions/public-api-support-intake")).toBe(false);
    expect(exists("supabase/functions/public-api-invoices")).toBe(false);

    // No /v1/usage path in the public-api entry.
    // (/v1/docs and /v1/docs/openapi.json became in-scope in Batch 10.)
    const entry = codeOnly(read(ENTRY));
    expect(entry).not.toMatch(/\/v1\/usage/);

    // No invoice / payment-method tables in any migration
    const migDir = path.join(ROOT, "supabase/migrations");
    for (const f of fs.readdirSync(migDir)) {
      const body = fs.readFileSync(path.join(migDir, f), "utf-8");
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_invoices/i);
      // api_support_tickets is introduced in Batch 11 — no Batch-7 fence here.
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_payment_methods/i);
    }

    // Batch 7 migration does not introduce PayFast/Paystack/Stripe wiring
    const b7 = findBatch7Migration();
    expect(b7).not.toMatch(/payfast/i);
    expect(b7).not.toMatch(/paystack/i);
    expect(b7).not.toMatch(/stripe/i);
    // No tax invoice / card / bank columns
    expect(b7).not.toMatch(/tax_invoice/i);
    expect(b7).not.toMatch(/card_number/i);
    expect(b7).not.toMatch(/bank_account/i);
  });

  it("billing visibility excludes sandbox, health/status, errored and non-billable rows", () => {
    const src = read(BILLING);
    // Production filter rules out sandbox calls.
    expect(src).toMatch(/\.eq\("environment",\s*"production"\)/);
    // Countable endpoint filter rules out health/status (which aren't in the set).
    expect(src).toMatch(/V1_COUNTABLE_ENDPOINTS/);
    // error_code IS NULL rules out auth/scope/validation/rate-limit/monthly/internal errors.
    expect(src).toMatch(/\.is\("error_code",\s*null\)/);
    // billable=true rules out validation-failure / sandbox-marker rows.
    expect(src).toMatch(/\.eq\("billable",\s*true\)/);
  });

  it("Batch 6 logger contract is unchanged — errored requests remain billable=false", () => {
    const gw = read(GATEWAY);
    expect(gw).toMatch(/billable:\s*errorCode === null \? ctx\.billable : false/);
  });
});
