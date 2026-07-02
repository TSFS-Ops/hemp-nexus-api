/**
 * Batch O — IDV/KYB critical lockout local smoke tests.
 *
 * Covers tracker items:
 *   Batch O Part 1 — production lockout for the generic "stub" fallback
 *                    in `idv-verify` (fails closed with
 *                    PROVIDER_MISCONFIGURED + audit + admin_risk_items).
 *   Batch O Part 2 — neutral wording in `EvidencePackView.tsx` (guarded
 *                    in the sibling Vitest suite
 *                    `src/tests/batch-o-idv-kyb-lockout-guard.test.ts`).
 *
 * Strategy (mirrors the token-purchase and Cluster A/B smoke patterns):
 *   - Runtime coverage of the shared `isProductionTier()` env-tier
 *     detector — the exact primitive that gates the lockout branch.
 *   - Source-level guards for the `idv-verify` production-lockout branch,
 *     the P010 named-stub-provider branch, the audited test-mode bypass
 *     path, the demo short-circuit, and the untouched Companies House
 *     live provider path. A runtime call into `idv-verify` itself would
 *     require live SUPABASE_URL / SERVICE_ROLE_KEY / auth context and
 *     mutate `entities` — explicitly out of scope for a smoke test.
 *   - `globalThis.fetch` is replaced with a tripwire that fails any test
 *     that touches the network.
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
// Source-level guards — wiring proof for the Batch O lockout branch.
// A runtime call into idv-verify would need a live Supabase, an auth
// context, and would mutate `entities` — explicitly out of scope. The
// guards below prove the exact hardened contract is present in the
// committed source.
// =====================================================================

const HERE = new URL(".", import.meta.url).pathname;
const PROJECT_ROOT = HERE.replace(/\/supabase\/functions\/idv-verify\/?$/, "");
async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(`${PROJECT_ROOT}/${rel}`);
}

Deno.test("Batch O Part 1 — idv-verify fails closed for generic 'stub' or absent provider in production", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");

  // The gate must import and consult isProductionTier from the shared helper.
  assertStringIncludes(src, `isProductionTier`);
  assert(
    /from\s+"\.\.\/_shared\/test-mode-bypass\.ts"/.test(src),
    "idv-verify must import isProductionTier from _shared/test-mode-bypass.ts",
  );

  // The lockout branch must cover both generic "stub" AND absent provider,
  // and only fire when isProductionTier() is true.
  assert(
    /if\s*\(\s*resolvedProvider\s*===\s*"stub"\s*\|\|\s*!resolvedProvider\s*\)/.test(src),
    "lockout branch must cover generic 'stub' OR absent provider",
  );
  assert(
    /if\s*\(\s*isProductionTier\(\)\s*\)/.test(src),
    "lockout branch must be guarded by isProductionTier()",
  );

  // Canonical audit action name.
  assertStringIncludes(src, `"idv.provider_misconfigured_production_lockout"`);
  // Admin risk item is written.
  assertStringIncludes(src, `admin_risk_items`);
  assertStringIncludes(src, `"idv_provider_misconfigured"`);
  assertStringIncludes(src, `severity: "high"`);
  // Fail-closed response: 503 with stable error code.
  assertStringIncludes(src, `"PROVIDER_MISCONFIGURED"`);
  assert(
    /status:\s*503/.test(
      src.slice(src.indexOf("idv.provider_misconfigured_production_lockout")),
    ),
    "lockout branch must return HTTP 503",
  );

  // The entity MUST NOT be promoted inside the lockout branch. The
  // "entities … update({ status: 'verified' })" happy-path writes must
  // sit AFTER the lockout branch (line-order proof).
  const lockoutIdx = src.indexOf("idv.provider_misconfigured_production_lockout");
  const stubVerifiedIdx = src.indexOf(
    `.from("entities").update({ status: "verified" })`,
  );
  assert(lockoutIdx > 0, "lockout audit marker must be present");
  assert(stubVerifiedIdx > 0, "happy-path entities update must be present");
  assert(
    stubVerifiedIdx > lockoutIdx,
    "entities.update({status:'verified'}) must live AFTER the lockout branch (branch returns early)",
  );

  // The lockout branch itself must NOT contain an entities.update call.
  const lockoutBlock = src.slice(
    lockoutIdx,
    src.indexOf("// Non-production", lockoutIdx),
  );
  assert(lockoutBlock.length > 0, "lockout block delimiter must be present");
  assert(
    !/entities[\s\S]*?\.update\(/.test(lockoutBlock),
    "lockout branch must not touch entities table",
  );
});

Deno.test("Batch O Part 1 — non-production path preserves existing dev/test stub behaviour", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  // The comment marker documenting that non-prod behaviour is unchanged.
  assertStringIncludes(
    src,
    "Non-production: existing dev/test stub behaviour is preserved below.",
  );
  // The generic stub helper still exists and is only reachable outside the
  // production-lockout branch.
  assert(
    /async function verifyWithStub\(/.test(src),
    "generic stub helper must still exist for non-production",
  );
});

Deno.test("Batch O Part 1 — P010 named stub providers (CIPC/Onfido/Dow Jones/Refinitiv) remain blocked with STUB_PROVIDER_NOT_LIVE", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  // The isStubProvider() branch must remain and short-circuit to 503.
  assertStringIncludes(src, "isStubProvider(resolvedProvider)");
  assertStringIncludes(src, "STUB_PROVIDER_AUDIT.NOT_LIVE");
  assertStringIncludes(src, "STUB_PROVIDER_ERROR_CODE");
  assertStringIncludes(src, "STUB_PROVIDER_STATUS.STUB_NOT_LIVE");
  assert(
    /status:\s*503/.test(src.slice(src.indexOf("STUB_PROVIDER_AUDIT.NOT_LIVE"))),
    "named-stub branch must return HTTP 503",
  );
});

Deno.test("Batch O Part 1 — audited test-mode bypass path is preserved and precedes the lockout branch", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  // The three canonical bypass primitives.
  assertStringIncludes(src, "isBypassEnabled(admin,");
  assertStringIncludes(src, "recordBypassUsage(admin,");
  assertStringIncludes(src, "bypassEnvelope(");

  // Bypass must be evaluated BEFORE the production lockout branch —
  // otherwise a production tenant could not use the audited bypass at
  // all (the design says bypass is separately production-locked via
  // isBypassEnabled → isProductionTier, not via this lockout branch).
  const bypassIdx = src.indexOf("isBypassEnabled(admin,");
  const lockoutIdx = src.indexOf("idv.provider_misconfigured_production_lockout");
  assert(bypassIdx > 0 && lockoutIdx > 0, "bypass + lockout markers must both exist");
  assert(
    bypassIdx < lockoutIdx,
    "test-mode bypass must be evaluated before the lockout branch",
  );
});

Deno.test("Batch O Part 1 — demo short-circuit remains distinct and runs first", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  assertStringIncludes(src, "tryDemoShortCircuit");
  const demoIdx = src.indexOf("tryDemoShortCircuit");
  const lockoutIdx = src.indexOf("idv.provider_misconfigured_production_lockout");
  assert(demoIdx > 0 && demoIdx < lockoutIdx, "demo short-circuit must run before lockout branch");
});

Deno.test("Batch O Part 1 — Companies House live provider path is unchanged", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  // The live provider helper and its bounded fetch still exist.
  assertStringIncludes(src, "async function verifyWithCompaniesHouse(");
  assertStringIncludes(src, "https://api.company-information.service.gov.uk/company/");
  assertStringIncludes(src, `fetchWithTimeout(\n      "companies_house"`);
  // The dispatch site still routes companies_house to the live helper.
  assert(
    /resolvedProvider\s*===\s*"companies_house"[\s\S]*?verifyWithCompaniesHouse\(/.test(src),
    "companies_house dispatch must still call verifyWithCompaniesHouse",
  );
});

Deno.test("Batch O Part 1 — lockout branch does not attempt any provider fetch", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  const lockoutIdx = src.indexOf("if (resolvedProvider === \"stub\" || !resolvedProvider)");
  const nonProdComment = src.indexOf("Non-production: existing dev/test stub behaviour is preserved below.");
  assert(lockoutIdx > 0 && nonProdComment > lockoutIdx);
  const block = src.slice(lockoutIdx, nonProdComment);
  assert(!/fetchWithTimeout\(/.test(block), "lockout block must not call fetchWithTimeout");
  assert(!/verifyWith(Onfido|CIPC|CompaniesHouse|Stub)\(/.test(block), "lockout block must not call provider helpers");
});
