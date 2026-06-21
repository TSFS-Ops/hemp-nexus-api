#!/usr/bin/env node
/**
 * Batch 15B guard — forbidden scopes must be visible but non-selectable.
 *
 * Verifies that the scope rendering helper exposes forbidden scopes AND
 * marks them non-selectable, and that the admin detail page surfaces the
 * forbidden-scope explanation copy from the UI SSOT.
 */
import fs from "node:fs";
import path from "node:path";

const SSOT = "src/lib/registry-api-hardening-ui.ts";
const DETAIL = "src/pages/admin/registry/ApiClientDetail.tsx";

let failed = false;

function read(p) {
  return fs.readFileSync(path.join(process.cwd(), p), "utf8");
}

const ssot = read(SSOT);
if (!/buildScopeOptions/.test(ssot)) {
  console.error(`✗ ${SSOT} missing buildScopeOptions`);
  failed = true;
}
if (!/forbidden: true/.test(ssot) || !/selectable: false/.test(ssot)) {
  console.error(`✗ ${SSOT} must mark forbidden scopes as non-selectable`);
  failed = true;
}
if (!/forbiddenScopesExplanation/.test(ssot)) {
  console.error(`✗ ${SSOT} missing forbiddenScopesExplanation copy`);
  failed = true;
}

const detail = read(DETAIL);
if (!/buildScopeOptions\(\)/.test(detail)) {
  console.error(`✗ ${DETAIL} must render scopes through buildScopeOptions`);
  failed = true;
}
if (!/forbiddenScopesExplanation/.test(detail)) {
  console.error(`✗ ${DETAIL} must display forbiddenScopesExplanation`);
  failed = true;
}
if (!/disabled=\{!opt\.selectable\}/.test(detail)) {
  console.error(`✗ ${DETAIL} must disable non-selectable scope checkboxes`);
  failed = true;
}

if (failed) {
  console.error("Batch 15B UI forbidden-scopes guard FAILED.");
  process.exit(1);
}
console.log("✓ Batch 15B UI forbidden-scopes guard OK");
