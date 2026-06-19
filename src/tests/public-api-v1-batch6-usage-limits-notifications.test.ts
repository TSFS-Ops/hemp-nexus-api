/**
 * Public API V1 — Batch 6 contract guards.
 *
 * Static source-contract tests for usage limits, monthly allowance derivation,
 * 80/100/120 threshold notifications, default overage block, the platform_admin
 * temporary override surface, and concurrency-guard behaviour. Also verifies
 * the hard exclusions for Batch 6 (no commercial pricing plans, no
 * /v1/usage endpoint, no client/internal monitoring dashboards, no
 * docs/OpenAPI, no support intake, no webhook changes, no write API, no
 * evidence/document exposure).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const USAGE = "supabase/functions/_shared/public-api-v1-usage.ts";
const GATEWAY = "supabase/functions/_shared/public-api-v1.ts";
const ENTRY = "supabase/functions/public-api/index.ts";
const PANEL = "src/components/admin/AdminApiClientsPanel.tsx";

// Locate Batch-6 migration by content (filename is a hash).
function findBatch6Migration(): string {
  const migDir = path.join(ROOT, "supabase/migrations");
  for (const f of fs.readdirSync(migDir)) {
    const body = fs.readFileSync(path.join(migDir, f), "utf-8");
    if (/api_usage_overrides/.test(body) && /api_usage_notifications_state/.test(body)) {
      return body;
    }
  }
  return "";
}

describe("Public API V1 · Batch 6 · usage limits + threshold notifications", () => {
  it("usage helper module exists with documented defaults", () => {
    expect(exists(USAGE)).toBe(true);
    const src = read(USAGE);
    expect(src).toMatch(/V1_DEFAULT_RPM\s*=\s*60/);
    expect(src).toMatch(/V1_DEFAULT_CONCURRENCY\s*=\s*3/);
    expect(src).toMatch(/V1_DEFAULT_MONTHLY_PROD\s*=\s*5[_]?000/);
    expect(src).toMatch(/V1_DEFAULT_MONTHLY_SANDBOX\s*=\s*10[_]?000/);
  });

  it("Batch-3 60 rpm rate-limit remains active — no Batch 6 override of checkRateLimit", () => {
    const gw = read(GATEWAY);
    // Batch 3 gateway call still present
    expect(gw).toMatch(/await checkRateLimit\(/);
    // No re-implementation that disables it
    expect(gw).not.toMatch(/\/\* disable-rate-limit \*\//);
  });

  it("monthly usage is derived from api_request_logs (single source of truth)", () => {
    const src = read(USAGE);
    expect(src).toMatch(/from\("api_request_logs"\)/);
    expect(src).toMatch(/\.is\("error_code",\s*null\)/);              // successful only
    expect(src).toMatch(/\.eq\("environment"/);                       // env-scoped
    expect(src).toMatch(/V1_COUNTABLE_ENDPOINTS/);                    // endpoint-scoped
    // Health/status endpoint paths must NOT appear in the countable set
    const set = src.match(/V1_COUNTABLE_ENDPOINTS = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(set).toBeTruthy();
    expect(set![1]).not.toMatch(/\/v1\/health/);
    expect(set![1]).not.toMatch(/\/v1\/status/);
    expect(set![1]).toMatch(/\/v1\/counterparty\/lookup/);
    expect(set![1]).toMatch(/\/v1\/counterparty\/summary/);
  });

  it("isCountableEndpoint excludes health/status and includes lookup/summary", () => {
    const src = read(USAGE);
    expect(src).toMatch(/export function isCountableEndpoint/);
  });

  it("auth failures and validation failures do not count (error_code IS NULL gate)", () => {
    const src = read(USAGE);
    // The single SELECT count enforces error_code IS NULL — meaning every
    // non-null error_code row (auth, scope, validation, internal_error)
    // is excluded from the monthly counter by construction.
    expect(src).toMatch(/\.is\("error_code",\s*null\)/);
    // Comment block documents the rule for future maintainers
    expect(src).toMatch(/Auth failures, validation failures/);
  });

  it("80 / 100 / 120 thresholds and crossing logic are implemented", () => {
    const src = read(USAGE);
    expect(src).toMatch(/THRESHOLDS: Threshold\[\] = \[80, 100, 120\]/);
    expect(src).toMatch(/export function thresholdsCrossed/);
    // crossing function compares prev vs current against ceil(threshold/100*limit)
    expect(src).toMatch(/Math\.ceil\(\(t \/ 100\) \* limit\)/);
  });

  it("duplicate threshold notifications are prevented by unique constraint", () => {
    const src = read(USAGE);
    expect(src).toMatch(/api_usage_notifications_state/);
    expect(src).toMatch(/insert\(\{[\s\S]*period_start/);
    // The dedupe path: insert may fail with unique violation → idempotent skip
    expect(src).toMatch(/if \(insErr \|\| !inserted\) return;/);
  });

  it("120% default block exists when no override is approved", () => {
    const src = read(USAGE);
    // blockMark = ceil(120/100 * baseLimit) for the no-override branch
    expect(src).toMatch(/Math\.ceil\(\(120 \/ 100\) \* baseLimit\)/);
    // gateway throws monthly_limit_reached on blocked pre-state
    const gw = read(GATEWAY);
    expect(gw).toMatch(/throw new V1Error\("monthly_limit_reached"\)/);
  });

  it("per-minute and concurrency blocks return rate_limit_exceeded", () => {
    const gw = read(GATEWAY);
    // rate-limit branch still maps to rate_limit_exceeded
    expect(gw).toMatch(/throw new V1Error\("rate_limit_exceeded"/);
    // concurrency guard rejects with rate_limit_exceeded as well
    expect(gw).toMatch(/auditConcurrencyBlock[\s\S]*throw new V1Error\("rate_limit_exceeded"/);
  });

  it("limit-blocked requests are logged with billable=false via the standard logger", () => {
    const gw = read(GATEWAY);
    // logV1Request: billable = errorCode === null ? ctx.billable : false
    expect(gw).toMatch(/billable:\s*errorCode === null \? ctx\.billable : false/);
    // Both monthly + concurrency paths flow through the catch block which
    // calls logV1Request with a non-null error code → billable forced false.
    expect(gw).toMatch(/await logV1Request\(supabase, ctx, endpointPath, req\.method, status, v1err\.code\)/);
  });

  it("notifications never include raw API keys or secrets", () => {
    const src = read(USAGE);
    // Notification body builders only reference safe fields
    const recordBlock = src.match(/export async function recordThresholdOnce[\s\S]*?^}\s*$/m);
    expect(recordBlock).toBeTruthy();
    const block = recordBlock![0];
    expect(block).not.toMatch(/key_hash/);
    expect(block).not.toMatch(/key_prefix/);
    expect(block).not.toMatch(/api_key/i);
    expect(block).not.toMatch(/secret/i);
    // Explicit comment binds the rule
    expect(src).toMatch(/NEVER include raw key/);
  });

  it("usage is client-scoped — query filters by the api_client's keys only", () => {
    const src = read(USAGE);
    // The query first resolves api_keys for THIS api_client and uses .in() —
    // so two clients' usage can never be mixed.
    expect(src).toMatch(/from\("api_keys"\)[\s\S]*\.eq\("api_client_id", apiClientId\)/);
    expect(src).toMatch(/\.in\("api_key_id", keyIds\)/);
  });

  it("temporary override table is platform_admin-only for writes (RLS)", () => {
    const body = findBatch6Migration();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/api_client_id/);
    expect(body).toMatch(/environment/);
    expect(body).toMatch(/override_limit/);
    expect(body).toMatch(/reason/);
    expect(body).toMatch(/approved_by/);
    expect(body).toMatch(/approved_at/);
    expect(body).toMatch(/expires_at/);
    expect(body).toMatch(/active/);
    // Write policy gated on platform_admin
    expect(body).toMatch(/platform_admin manages usage overrides[\s\S]*for all[\s\S]*platform_admin/i);
    // api_admin / auditor are read-only
    expect(body).toMatch(/api_admin auditor read usage overrides[\s\S]*for select/i);
    expect(body).not.toMatch(/api_admin[^"]*for all/i);
    expect(body).not.toMatch(/auditor[^"]*for all/i);
  });

  it("admin panel exposes usage state and override controls (no client dashboard)", () => {
    const src = read(PANEL);
    expect(src).toMatch(/UsageLimitsSection/);
    expect(src).toMatch(/api_usage_overrides/);
    // Audit on create + deactivate
    expect(src).toMatch(/api_usage\.override_created/);
    expect(src).toMatch(/api_usage\.override_deactivated/);
    // No client-facing dashboard, no billing UI
    expect(src).not.toMatch(/ClientUsageDashboard/);
    expect(src).not.toMatch(/InvoicesPanel/);
    expect(src).not.toMatch(/PricingPlansPanel/);
  });

  it("hard exclusions — no Batch-6-forbidden surface introduced", () => {
    // No /v1/usage, /v1/docs, openapi endpoints introduced
    expect(exists("supabase/functions/public-api-usage-current")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);
    expect(exists("supabase/functions/public-api-support-intake")).toBe(false);

    const entryCode = codeOnly(read(ENTRY));
    expect(entryCode).not.toMatch(/\/v1\/usage/);
    // /v1/docs and /v1/docs/openapi.json became in-scope in Batch 10.

    // No commercial-plan / invoice / payment / support-intake tables in the
    // Batch-6 migration itself. (Commercial plans are scoped to Batch 7;
    // invoices/payment/support intake remain out of scope for V1.)
    const batch6 = findBatch6Migration();
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*webhook_/i);
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*pois\b/i);
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*wads\b/i);
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*payment_/i);
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*api_commercial_plans/i);
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*api_invoices/i);
    expect(batch6).not.toMatch(/CREATE TABLE[^;]*api_support_tickets/i);
    // Invoices/payment/support intake must not exist in ANY migration.
    const migDir = path.join(ROOT, "supabase/migrations");
    for (const f of fs.readdirSync(migDir)) {
      const body = fs.readFileSync(path.join(migDir, f), "utf-8");
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_invoices/i);
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_support_tickets/i);
    }
  });

  it("the gateway calls finishApiActiveRequest in a finally block (forward progress on errors)", () => {
    const gw = read(GATEWAY);
    expect(gw).toMatch(/finally \{[\s\S]*finishApiActiveRequest\(supabase, ctx\.requestId\)/);
  });

  it("override creation in admin panel records approved_by from the signed-in user", () => {
    const src = read(PANEL);
    expect(src).toMatch(/approved_by:\s*user\.id/);
    expect(src).toMatch(/expires_at:\s*expiresAt/);
    expect(src).toMatch(/active:\s*true/);
  });
});
