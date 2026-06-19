/**
 * Public API V1 · Sand/Prod Batch 6 — Rate limits, usage ledger, token /
 * credit burn and overage rules.
 *
 * Static source-contract tests (no Deno imports, no live DB roundtrip) —
 * matches the established Batch 2-5 pattern. Verifies:
 *
 *  • Environment-specific defaults (sandbox 30 rpm, production 60 rpm,
 *    sandbox 1,000/month, production 5,000/month, sandbox 10 concurrent,
 *    production 3 concurrent).
 *  • Override rules and trace columns are honoured.
 *  • rate_limit_decision enum covers allowed / minute_block / monthly_block
 *    / concurrency_block / overage_billable / not_evaluated.
 *  • Burn idempotency is enforced at the api_request_logs layer
 *    (single source of truth for derived V1 billing).
 *  • Sandbox calls never burn; blocked calls never burn; non-billable
 *    surfaces (health/docs) never burn.
 *  • Threshold notification rows are deduped per (client, env, month, t).
 *  • Production-protection invariants from earlier batches still hold.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const USAGE = read("supabase/functions/_shared/public-api-v1-usage.ts");
const GATEWAY_SHARED = read("supabase/functions/_shared/public-api-v1.ts");
const GATEWAY = read("supabase/functions/public-api/index.ts");
const RATE_LIMIT = read("supabase/functions/_shared/rate-limit.ts");
const BILLING = read("supabase/functions/_shared/public-api-v1-billing.ts");
const COUNTERPARTY = read("supabase/functions/_shared/public-api-v1-counterparty.ts");

// ─── 1. Environment-specific default limits ──────────────────────────────

describe("Public API V1 · Sand/Prod Batch 6 · env-specific defaults", () => {
  it("sandbox default minute limit is 30 rpm", () => {
    expect(USAGE).toMatch(/V1_DEFAULT_RPM_SANDBOX\s*=\s*30\b/);
  });

  it("production default minute limit is 60 rpm", () => {
    expect(USAGE).toMatch(/V1_DEFAULT_RPM_PRODUCTION\s*=\s*60\b/);
  });

  it("sandbox monthly allowance default is 1,000", () => {
    expect(USAGE).toMatch(/V1_DEFAULT_MONTHLY_SANDBOX\s*=\s*1[,_]?000\b/);
  });

  it("production monthly hard default is 5,000 when no plan exists", () => {
    expect(USAGE).toMatch(/V1_DEFAULT_MONTHLY_PROD\s*=\s*5[,_]?000\b/);
    // planMonthlyAllowance falls back to V1_DEFAULT_MONTHLY_PROD when no
    // active plan resolves.
    expect(BILLING).toMatch(/planMonthlyAllowance/);
    expect(BILLING).toMatch(/return\s+V1_DEFAULT_MONTHLY_PROD/);
  });

  it("sandbox concurrency default is 10", () => {
    expect(USAGE).toMatch(/V1_DEFAULT_CONCURRENCY_SANDBOX\s*=\s*10\b/);
  });

  it("production concurrency default is 3", () => {
    expect(USAGE).toMatch(/V1_DEFAULT_CONCURRENCY_PRODUCTION\s*=\s*3\b/);
  });

  it("defaultRpm / defaultConcurrency helpers exist and are env-keyed", () => {
    expect(USAGE).toMatch(/export function defaultRpm\(env: "sandbox" \| "production"\)/);
    expect(USAGE).toMatch(/export function defaultConcurrency\(env: "sandbox" \| "production"\)/);
  });
});

// ─── 2. Rate-limit decision trace labels ─────────────────────────────────

describe("Public API V1 · Sand/Prod Batch 6 · rate_limit_decision labels", () => {
  it("ctx.rateLimitDecision enum covers all required Batch 6 labels", () => {
    const ctxBlock = GATEWAY_SHARED.match(/rateLimitDecision:[\s\S]*?\|\s*null;/)!;
    expect(ctxBlock).not.toBeNull();
    for (const lbl of [
      "allowed",
      "minute_block",
      "monthly_block",
      "concurrency_block",
      "overage_billable",
      "not_evaluated",
    ]) {
      expect(ctxBlock![0]).toContain(`"${lbl}"`);
    }
  });

  it("minute-limit block sets rateLimitDecision='minute_block' and returns 429", () => {
    expect(GATEWAY_SHARED).toMatch(/ctx\.rateLimitDecision\s*=\s*"minute_block"[\s\S]*throw new V1Error\("rate_limit_exceeded"/);
  });

  it("concurrency block sets rateLimitDecision='concurrency_block'", () => {
    expect(GATEWAY_SHARED).toMatch(/ctx\.rateLimitDecision\s*=\s*"concurrency_block"/);
  });

  it("monthly block sets rateLimitDecision='monthly_block'", () => {
    expect(GATEWAY_SHARED).toMatch(/ctx\.rateLimitDecision\s*=\s*"monthly_block"/);
  });

  it("allowed path sets rateLimitDecision='allowed'", () => {
    expect(GATEWAY_SHARED).toMatch(/ctx\.rateLimitDecision\s*=\s*"allowed"/);
  });

  it("internal rate-limit failure falls back to 'not_evaluated'", () => {
    expect(GATEWAY_SHARED).toMatch(/ctx\.rateLimitDecision\s*=\s*"not_evaluated"/);
  });

  it("error envelope for rate_limit_exceeded carries retry_after + 429 status", () => {
    expect(GATEWAY_SHARED).toMatch(/rate_limit_exceeded:\s*429/);
    expect(GATEWAY_SHARED).toMatch(/retry_after|retryAfter/);
  });
});

// ─── 3. Rate-limit wiring (env-specific rpm + concurrency) ───────────────

describe("Public API V1 · Sand/Prod Batch 6 · env-specific wiring", () => {
  it("rate-limit caller passes a limitsOverride built from defaultRpm(env)", () => {
    expect(GATEWAY_SHARED).toMatch(/limitsOverride:\s*\{\s*requestsPerMinute:\s*rpm\s*\}/);
    expect(GATEWAY_SHARED).toMatch(/const rpm\s*=\s*defaultRpm\(envForRpm\)/);
  });

  it("checkRateLimit accepts and applies meta.limitsOverride", () => {
    expect(RATE_LIMIT).toMatch(/limitsOverride\?:\s*RateLimitConfig/);
    expect(RATE_LIMIT).toMatch(/meta\.limitsOverride\s*\?\s*meta\.limitsOverride/);
  });

  it("concurrency guard passes defaultConcurrency(env) cap", () => {
    expect(GATEWAY_SHARED).toMatch(/const concCap\s*=\s*defaultConcurrency\(envForConc\)/);
    expect(GATEWAY_SHARED).toMatch(/beginApiActiveRequest\([\s\S]{0,200}concCap/);
  });

  it("beginApiActiveRequest accepts an explicit concurrencyLimit", () => {
    expect(USAGE).toMatch(/beginApiActiveRequest\([\s\S]*?concurrencyLimit\?:\s*number/);
  });

  it("concurrency audit reports the env-specific cap", () => {
    expect(USAGE).toMatch(/limit:\s*defaultConcurrency\(env\)/);
  });
});

// ─── 4. Monthly allowance + overage behaviour ────────────────────────────

describe("Public API V1 · Sand/Prod Batch 6 · monthly allowance + overage", () => {
  it("only successful, countable rows count toward monthly usage", () => {
    const fn = USAGE.match(/export async function getMonthlyUsage[\s\S]*?\n\}/)!;
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain('.is("error_code", null)');
    expect(fn![0]).toContain('.in("endpoint", Array.from(V1_COUNTABLE_ENDPOINTS))');
    expect(fn![0]).toContain('.eq("environment", env)');
  });

  it("plan with overage_allowed=false enforces hard block at 100%", () => {
    // strictAtAllowance true → block mark = baseLimit (100%).
    expect(USAGE).toMatch(/options\?\.strictAtAllowance/);
    expect(USAGE).toMatch(/strictAtAllowance\s*\?[\s\S]{0,80}baseLimit/);
    // Wired from billing.ts based on overage_allowed.
    expect(GATEWAY_SHARED).toMatch(/strictAtAllowance\s*=\s*!resolved\.plan\.overage_allowed/);
  });

  it("plan with overage_allowed=true permits continued usage past 100%", () => {
    expect(USAGE).toMatch(/defaultBlockMark\s*=\s*options\?\.strictAtAllowance[\s\S]{0,120}Math\.ceil\(\(120\s*\/\s*100\)/);
  });

  it("monthly block path audits and throws monthly_limit_reached", () => {
    expect(GATEWAY_SHARED).toMatch(/auditMonthlyBlock[\s\S]{0,80}throw new V1Error\("monthly_limit_reached"\)/);
  });

  it("monthly block surface returns 429 with the canonical error code", () => {
    expect(GATEWAY_SHARED).toMatch(/monthly_limit_reached:\s*429/);
  });

  it("temporary api_usage_overrides take precedence over the plan limit", () => {
    expect(USAGE).toMatch(/effectiveLimit\s*=\s*override\?\.override_limit\s*\?\?\s*baseLimit/);
    expect(USAGE).toMatch(/effectiveBlockMark\s*=\s*override\s*\?\s*override\.override_limit/);
  });
});

// ─── 5. Threshold notification dedupe ────────────────────────────────────

describe("Public API V1 · Sand/Prod Batch 6 · threshold notifications", () => {
  it("80 / 100 / 120 thresholds are defined", () => {
    expect(USAGE).toMatch(/THRESHOLDS:\s*Threshold\[\]\s*=\s*\[\s*80\s*,\s*100\s*,\s*120\s*\]/);
  });

  it("thresholdsCrossed returns only NEWLY crossed marks", () => {
    expect(USAGE).toMatch(/if\s*\(prev\s*<\s*mark\s*&&\s*current\s*>=\s*mark\)/);
  });

  it("recordThresholdOnce inserts then short-circuits on unique violation", () => {
    expect(USAGE).toMatch(/from\("api_usage_notifications_state"\)\s*\.insert/);
    // The maybeSingle()/insErr branch is the dedupe path — duplicate
    // (client, env, period, threshold) rows are silently skipped.
    expect(USAGE).toMatch(/if\s*\(insErr\s*\|\|\s*!inserted\)\s*return/);
  });

  it("threshold audit action is canonical and per-threshold", () => {
    expect(USAGE).toMatch(/action:\s*`api_usage\.threshold_\$\{threshold\}_reached`/);
  });

  it("120% threshold notification only applies when overage is in play", () => {
    // The Threshold type lists 80 | 100 | 120; 120 is only crossed in the
    // gateway when preState.blocked is false (i.e. plan permits overage),
    // because a blocked call throws before postCurrent is computed.
    expect(GATEWAY_SHARED).toMatch(/if\s*\(preState\.blocked\)\s*\{[\s\S]*?throw new V1Error\("monthly_limit_reached"\)/);
    expect(GATEWAY_SHARED).toMatch(/const postCurrent\s*=\s*preState\.current\s*\+\s*1/);
  });
});

// ─── 6. Burn idempotency + sandbox/non-billable rules ────────────────────

describe("Public API V1 · Sand/Prod Batch 6 · burn rules", () => {
  it("api_request_logs is the single derived-burn source of truth", () => {
    // billing helper counts billable=true rows on api_request_logs only
    expect(BILLING).toMatch(/from\("api_request_logs"\)[\s\S]{0,200}\.eq\("billable",\s*true\)/);
    // No parallel ledger is invented in this batch.
    expect(BILLING).not.toMatch(/token_ledger|credits_ledger/i);
  });

  it("burn is idempotent per request_id via a unique log index", () => {
    const migDir = path.join(ROOT, "supabase/migrations");
    const hasIdx = fs.readdirSync(migDir).some((f) => {
      const body = fs.readFileSync(path.join(migDir, f), "utf-8");
      return /api_request_logs_request_id_unique/i.test(body) &&
             /UNIQUE INDEX[\s\S]{0,200}api_request_logs[\s\S]{0,200}request_id/i.test(body);
    });
    expect(hasIdx).toBe(true);
  });

  it("sandbox calls force billable=false at the gateway", () => {
    expect(GATEWAY).toMatch(/ctx\.environment === "sandbox"[\s\S]{0,400}ctx\.billable\s*=\s*false/);
  });

  it("production health/docs paths keep ctx.billable=false (non-countable)", () => {
    // Health / docs endpoints are NOT in V1_COUNTABLE_ENDPOINTS, so they
    // never enter the monthly allowance gate and never set ctx.billable.
    expect(USAGE).toMatch(/V1_COUNTABLE_ENDPOINTS\s*=\s*new\s+Set<string>\(\[\s*"\/v1\/counterparty\/lookup",\s*"\/v1\/counterparty\/summary"\s*,?\s*\]\)/);
    // Default ctx.billable initialiser is false.
    expect(GATEWAY_SHARED).toMatch(/billable:\s*false,/);
  });

  it("monthly-blocked production calls do not enter the success log path", () => {
    // The block branch THROWS V1Error before the exec() call site; the
    // catch path logs the request with error_code != null and forces
    // billable=false (see Batch 2 log writer).
    expect(GATEWAY_SHARED).toMatch(/billable:\s*errorCode\s*===\s*null\s*\?\s*ctx\.billable\s*:\s*false/);
  });
});

// ─── 7. Request log audit-grade fields (Batch 2 trace) ───────────────────

describe("Public API V1 · Sand/Prod Batch 6 · audit-grade request logs", () => {
  it("logV1Request persists rate_limit_decision, billable_overage and request_payload_hash", () => {
    const logFn = GATEWAY_SHARED.split("export async function logV1Request")[1]?.split("export async function")[0] ?? "";
    expect(logFn).toContain("rate_limit_decision");
    expect(logFn).toContain("billable_overage");
    expect(logFn).toContain("request_payload_hash");
    expect(logFn).toContain("environment");
  });

  it("logV1Request NEVER persists raw api key, scrypt material, or evidence payloads", () => {
    const logFn = GATEWAY_SHARED.split("export async function logV1Request")[1]?.split("export async function")[0] ?? "";
    expect(logFn).not.toMatch(/api_key_secret|raw_key|scrypt|evidence|bank_account|iban/i);
  });
});

// ─── 8. Production protection (carried from Batch 5) ─────────────────────

describe("Public API V1 · Sand/Prod Batch 6 · production protection", () => {
  it("production lookup still does not read api_sandbox_records", () => {
    const productionBranch = GATEWAY.match(/\/\/ Production path[\s\S]*?return\s*\{\s*body\s*\}/)!;
    expect(productionBranch).not.toBeNull();
    expect(productionBranch![0]).not.toContain("api_sandbox_records");
    expect(productionBranch![0]).toContain("buildNoMatchEnvelope(ctx)");
  });

  it("production lookup still returns no real production data source", () => {
    const productionBranch = GATEWAY.match(/\/\/ Production path[\s\S]*?return\s*\{\s*body\s*\}/)!;
    expect(productionBranch![0]).toContain("ctx.billable = false");
  });

  it("Batch 2 schema-separation exception remains live", () => {
    const migDir = path.join(ROOT, "supabase/migrations");
    const hasException = fs.readdirSync(migDir).some((f) => {
      const body = fs.readFileSync(path.join(migDir, f), "utf-8");
      return body.includes("api_v1_exceptions") &&
             body.includes("Sandbox records remain in api_sandbox_records");
    });
    expect(hasException).toBe(true);
  });

  it("counterparty helper has not added a real production data source in Batch 6", () => {
    // (provider_unavailable is a sandbox ERROR SCENARIO marker, not an
    // integration — match real provider client identifiers instead.)
    expect(COUNTERPARTY).not.toMatch(/companies_house|companiesHouseClient|cipcClient|onfidoClient|productionLookupProvider/i);
  });
});

// ─── 9. Hard exclusions (no out-of-scope work shipped) ───────────────────

describe("Public API V1 · Sand/Prod Batch 6 · hard exclusions", () => {
  it("no webhook dispatcher / retry logic added to the gateway in this batch", () => {
    expect(GATEWAY).not.toMatch(/webhook_deliveries\s*\)\.insert|dispatchWebhook\(/i);
  });

  it("no admin / client dashboard mutations added to usage helper", () => {
    expect(USAGE).not.toMatch(/admin_dashboard|usage_dashboard/i);
  });

  it("no OpenAPI / IntegrationDocs surface added in this batch", () => {
    expect(USAGE).not.toMatch(/openapi|integrationdocs/i);
    expect(BILLING).not.toMatch(/openapi|integrationdocs/i);
  });

  it("no write API surface added to the public gateway", () => {
    // Gateway router only dispatches GET / POST; POST is limited to the
    // (read) lookup + sandbox-only error route established in Batch 4.
    expect(GATEWAY).not.toMatch(/req\.method === "(PUT|PATCH|DELETE)"/);
  });
});
