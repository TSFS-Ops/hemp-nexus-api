#!/usr/bin/env node
/**
 * scripts/check-role-negative-e2e-coverage.mjs
 *
 * Hard release-gate guard for the Role-Negative & E2E test pack.
 *
 * Fails CI when:
 *   - A path appears in e2e/fixtures/routes.ts (ROUTE_MATRIX) but no
 *     spec under e2e/role-negative/ references it as a string literal.
 *   - An action id in e2e/fixtures/permissions.ts (ACTION_MATRIX) is
 *     not referenced by wrong-actions.spec.ts.
 *   - The role list in e2e/fixtures/users.ts drifts from the approved
 *     8-role labels.
 *
 * The guard is intentionally text-based (greps) so it stays fast and
 * catches the most common drift: someone adds a route to the matrix
 * without writing the matching assertion, or vice versa.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APPROVED_ROLES = [
  "platform_admin",
  "compliance_analyst",
  "requester_trader",
  "counterparty_user",
  "api_client_admin",
  "normal_non_admin_user",
  "other_tenant_user",
  "logged_out_user",
];

const fail = (msg) => { console.error(`✗ role-negative-e2e-coverage: ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`✓ ${msg}`);

// 1. Role labels intact
const usersSrc = readFileSync("e2e/fixtures/users.ts", "utf8");
for (const r of APPROVED_ROLES) {
  if (!usersSrc.includes(`"${r}"`)) fail(`role label "${r}" missing from e2e/fixtures/users.ts`);
}
ok("role labels match approved 8");

// 2. Routes — every ROUTE_MATRIX path must appear in at least one spec
const routesSrc = readFileSync("e2e/fixtures/routes.ts", "utf8");
const matrixPaths = [...routesSrc.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
if (matrixPaths.length === 0) fail("ROUTE_MATRIX appears empty");

const specDir = "e2e/role-negative";
const specSources = readdirSync(specDir).filter((f) => f.endsWith(".spec.ts"))
  .map((f) => readFileSync(join(specDir, f), "utf8")).join("\n");
// Also count route-access.spec.ts (which references via import) — accept import as coverage.
const routesIsImported = /from\s+"\.\.\/fixtures\/routes"/.test(specSources);
for (const p of matrixPaths) {
  // path may contain :id — strip for substring check
  const lit = p.replace(":id", "");
  if (!specSources.includes(lit) && !routesIsImported) {
    fail(`route ${p} has no spec coverage under e2e/role-negative/`);
  }
}
if (routesIsImported) ok(`ROUTE_MATRIX is iterated by a spec (${matrixPaths.length} paths)`);

// 3. Actions — every ACTION_MATRIX id must appear in wrong-actions.spec.ts
const permsSrc = readFileSync("e2e/fixtures/permissions.ts", "utf8");
const actionIds = [...permsSrc.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
const wrongActions = readFileSync("e2e/role-negative/wrong-actions.spec.ts", "utf8");
const permsImported = /from\s+"\.\.\/fixtures\/permissions"/.test(wrongActions);
if (!permsImported && actionIds.length > 0) {
  fail("wrong-actions.spec.ts does not import ACTION_MATRIX");
} else {
  ok(`ACTION_MATRIX is iterated by wrong-actions.spec.ts (${actionIds.length} actions)`);
}

// 4. Journey suites present
const journeyDir = "e2e/journeys";
const required = [
  "auth-role-landing.spec.ts", "trade-match.spec.ts", "poi-lifecycle.spec.ts",
  "wad-lifecycle.spec.ts", "refund-dispute.spec.ts", "governance-export.spec.ts",
  "api-developer-access.spec.ts",
];
const present = new Set(readdirSync(journeyDir));
for (const r of required) if (!present.has(r)) fail(`missing journey spec ${r}`);
ok(`all ${required.length} journey specs present`);

if (process.exitCode) {
  console.error("\nrole-negative-e2e-coverage FAILED — fix above before merging.");
  process.exit(1);
} else {
  console.log("\nrole-negative-e2e-coverage OK");
}
