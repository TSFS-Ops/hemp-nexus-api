/**
 * Batch O + Batch O Remainder — IDV/KYB critical lockout smoke tests.
 *
 * Covers:
 *   Batch O Part 1 (production lockout, source-level).
 *   Batch O Remainder (Scope D):
 *     - `idv-verify` strict provider allow-list;
 *     - unknown / mock / demo / stub / empty / null provider strings
 *       are ALL rejected up-front with PROVIDER_MISCONFIGURED (not
 *       only in production);
 *     - non-production behaviour remains available only through the
 *       audited test-mode bypass path;
 *     - the generic `verifyWithStub` helper is deleted so no dispatch
 *       branch can silently fall through to a stub.
 *
 * Strategy (mirrors the token-purchase and Cluster A/B smoke pattern):
 *   - Runtime coverage of the shared `isProductionTier()` env-tier
 *     detector — the exact primitive that gates the production-vs-
 *     non-production audit action name.
 *   - Source-level guards for the allow-list branch, the P010 named-
 *     stub-provider branch, the audited test-mode bypass path, the
 *     demo short-circuit, the untouched Companies House live provider
 *     path, and the deletion of `verifyWithStub`.
 *   - `globalThis.fetch` is replaced with a tripwire that fails any
 *     test that touches the network.
 *
 * Explicit non-goals: no real Onfido / CIPC / Dow Jones / Refinitiv /
 * Companies House / Dilisense call, no real entity mutation, no DB
 * write, no email, no notification, no cron tick, no secrets required.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isProductionTier } from "../_shared/test-mode-bypass.ts";

// ---------------------------------------------------------------------
// Network tripwire — any real fetch during a test is a hard failure.
// ---------------------------------------------------------------------
const REAL_FETCH = globalThis.fetch;
function installFetchTripwire(): string[] {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    calls.push(url);
    throw new Error(
      `[batch-o-smoke] real fetch attempted (${url}); tests must be pure in-memory`,
    );
  }) as typeof fetch;
  return calls;
}
function restoreFetch() {
  globalThis.fetch = REAL_FETCH;
}

// ---------------------------------------------------------------------
// Runtime coverage of the production-tier detector.
// ---------------------------------------------------------------------
const ORIGINAL_TIER = Deno.env.get("ENVIRONMENT_TIER");
function setTier(v: string | undefined) {
  if (v === undefined) Deno.env.delete("ENVIRONMENT_TIER");
  else Deno.env.set("ENVIRONMENT_TIER", v);
}
function restoreTier() {
  if (ORIGINAL_TIER === undefined) Deno.env.delete("ENVIRONMENT_TIER");
  else Deno.env.set("ENVIRONMENT_TIER", ORIGINAL_TIER);
}

Deno.test("Batch O — isProductionTier() returns true for production/live/prod", () => {
  const calls = installFetchTripwire();
  try {
    for (const v of ["production", "live", "prod", "PRODUCTION", "Live"]) {
      setTier(v);
      assertEquals(isProductionTier(), true, `expected true for ${v}`);
    }
    assertEquals(calls.length, 0);
  } finally {
    restoreTier();
    restoreFetch();
  }
});

Deno.test("Batch O — isProductionTier() returns false for sandbox/test/dev/absent", () => {
  const calls = installFetchTripwire();
  try {
    for (const v of ["sandbox", "test", "development", "staging", "", undefined]) {
      setTier(v);
      assertEquals(isProductionTier(), false, `expected false for ${v}`);
    }
    assertEquals(calls.length, 0);
  } finally {
    restoreTier();
    restoreFetch();
  }
});

// =====================================================================
// Source-level guards — wiring proof for the allow-list branch.
// A runtime call into idv-verify would need a live Supabase, an auth
// context, and would mutate `entities` — explicitly out of scope. The
// guards below prove the hardened contract is present in the committed
// source.
// =====================================================================

const HERE = new URL(".", import.meta.url).pathname;
const PROJECT_ROOT = HERE.replace(/\/supabase\/functions\/idv-verify\/?$/, "");
async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(`${PROJECT_ROOT}/${rel}`);
}

Deno.test("Batch O Remainder — idv-verify declares a strict provider allow-list", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");

  // Explicit constants for company + individual providers.
  assert(
    /const\s+COMPANY_ALLOWED_PROVIDERS\s*=\s*\[\s*"companies_house"\s*,\s*"cipc"\s*\]\s*as\s+const/.test(src),
    "COMPANY_ALLOWED_PROVIDERS must be exactly [companies_house, cipc]",
  );
  assert(
    /const\s+INDIVIDUAL_ALLOWED_PROVIDERS\s*=\s*\[\s*"onfido"\s*\]\s*as\s+const/.test(src),
    "INDIVIDUAL_ALLOWED_PROVIDERS must be exactly [onfido]",
  );
});

Deno.test("Batch O Remainder — allow-list rejects unknown / stub / mock / demo / empty providers up-front", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");

  // The guard must consult the allow-list AND treat a null/empty
  // provider as misconfigured.
  assert(
    /if\s*\(\s*!resolvedProvider\s*\|\|\s*!allowedForRequest\.includes\(resolvedProvider\)\s*\)/.test(src),
    "allow-list guard must reject !resolvedProvider OR non-allow-listed",
  );
  // Canonical audit action names.
  assertStringIncludes(src, `"idv.provider_misconfigured_production_lockout"`);
  assertStringIncludes(src, `"idv.provider_misconfigured"`);
  // Fail-closed response.
  assertStringIncludes(src, `"PROVIDER_MISCONFIGURED"`);
  assert(
    /allowed_providers:\s*allowedForRequest/.test(src),
    "the fail-closed response must expose allowed_providers to the client",
  );
  // 503 return code.
  const guardIdx = src.indexOf("provider_not_in_allowlist");
  assert(guardIdx > 0, "provider_not_in_allowlist marker must be present");
  assert(
    /status:\s*503/.test(src.slice(guardIdx)),
    "allow-list guard must return HTTP 503",
  );
});

Deno.test("Batch O Remainder — resolvedProvider default is `null`, not the generic 'stub' string", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assert(
    /providerConfig\.company_provider\s*\|\|\s*null/.test(src),
    "company_provider must default to null (not 'stub')",
  );
  assert(
    /providerConfig\.individual_provider\s*\|\|\s*null/.test(src),
    "individual_provider must default to null (not 'stub')",
  );
});

Deno.test("Batch O Remainder — verifyWithStub helper is deleted and no call site remains", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assert(
    !/async\s+function\s+verifyWithStub\s*\(/.test(src),
    "verifyWithStub helper must be deleted",
  );
  assert(
    !/verifyWithStub\s*\(/.test(src),
    "no remaining call to verifyWithStub allowed",
  );
});

Deno.test("Batch O Remainder — dispatch fails closed for any unknown provider (defence in depth)", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  // Both company and individual dispatch else-branches must throw
  // PROVIDER_MISCONFIGURED rather than fall through to a stub.
  const companyDispatch = src.match(
    /if\s*\(\s*isCompany\s*\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?\}/,
  );
  assert(companyDispatch, "dispatch block must be present");
  const block = companyDispatch![0];
  const throwCount = (block.match(/throw\s+new\s+ApiException\(\s*[\r\n]?\s*"PROVIDER_MISCONFIGURED"/g) ?? []).length;
  assertEquals(
    throwCount,
    2,
    "both company and individual dispatch else-branches must throw PROVIDER_MISCONFIGURED",
  );
});

Deno.test("Batch O Remainder — audit_logs write is unconditional; admin_risk_items only in production", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  const guardStart = src.indexOf("provider_not_in_allowlist");
  const guardEnd = src.indexOf("status: 503", guardStart);
  const block = src.slice(guardStart, guardEnd);
  // audit_logs.insert is not inside an `if (inProduction)` — it runs
  // for BOTH tiers. admin_risk_items.insert IS wrapped in the tier
  // check to keep the risk queue for prod-only.
  assert(
    /if\s*\(\s*inProduction\s*\)\s*\{[\s\S]*?admin_risk_items[\s\S]*?\}/.test(block),
    "admin_risk_items insert must be inside if(inProduction){}",
  );
  // audit_logs insert must precede the admin_risk_items guard so it
  // fires on every misconfigured request, not just prod ones.
  const auditIdx = block.indexOf("audit_logs");
  const prodBranchIdx = block.indexOf("if (inProduction)");
  assert(
    auditIdx > 0 && (prodBranchIdx === -1 || auditIdx < prodBranchIdx),
    "audit_logs insert must fire unconditionally before the prod-only risk-item branch",
  );
});

Deno.test("Batch O — P010 named stub providers (CIPC/Onfido/Dow Jones/Refinitiv) remain blocked with STUB_PROVIDER_NOT_LIVE", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assertStringIncludes(src, "isStubProvider(resolvedProvider)");
  assertStringIncludes(src, "STUB_PROVIDER_AUDIT.NOT_LIVE");
  assertStringIncludes(src, "STUB_PROVIDER_ERROR_CODE");
  assertStringIncludes(src, "STUB_PROVIDER_STATUS.STUB_NOT_LIVE");
  assert(
    /status:\s*503/.test(src.slice(src.indexOf("STUB_PROVIDER_AUDIT.NOT_LIVE"))),
    "named-stub branch must return HTTP 503",
  );
});

Deno.test("Batch O — audited test-mode bypass path is preserved and precedes the allow-list guard", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assertStringIncludes(src, "isBypassEnabled(admin,");
  assertStringIncludes(src, "recordBypassUsage(admin,");
  assertStringIncludes(src, "bypassEnvelope(");

  const bypassIdx = src.indexOf("isBypassEnabled(admin,");
  const allowlistIdx = src.indexOf("provider_not_in_allowlist");
  assert(bypassIdx > 0 && allowlistIdx > 0, "bypass + allow-list markers must both exist");
  assert(
    bypassIdx < allowlistIdx,
    "test-mode bypass must be evaluated before the allow-list guard so audited bypass still works",
  );
});

Deno.test("Batch O — demo short-circuit remains distinct and runs first", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assertStringIncludes(src, "tryDemoShortCircuit");
  const demoIdx = src.indexOf("tryDemoShortCircuit");
  const allowlistIdx = src.indexOf("provider_not_in_allowlist");
  assert(demoIdx > 0 && demoIdx < allowlistIdx, "demo short-circuit must run before allow-list guard");
});

Deno.test("Batch O — Companies House live provider path is unchanged", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assertStringIncludes(src, "async function verifyWithCompaniesHouse(");
  assertStringIncludes(src, "https://api.company-information.service.gov.uk/company/");
  assertStringIncludes(src, `fetchWithTimeout(\n      "companies_house"`);
  assert(
    /resolvedProvider\s*===\s*"companies_house"[\s\S]*?verifyWithCompaniesHouse\(/.test(src),
    "companies_house dispatch must still call verifyWithCompaniesHouse",
  );
});

Deno.test("Batch O Remainder — allow-list guard does not attempt any provider fetch", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  const guardStart = src.indexOf("provider_not_in_allowlist");
  const guardEnd = src.indexOf("status: 503", guardStart);
  assert(guardStart > 0 && guardEnd > guardStart);
  const block = src.slice(guardStart, guardEnd);
  assert(!/fetchWithTimeout\(/.test(block), "allow-list guard must not call fetchWithTimeout");
  assert(
    !/verifyWith(Onfido|CIPC|CompaniesHouse|Stub)\(/.test(block),
    "allow-list guard must not call provider helpers",
  );
});
