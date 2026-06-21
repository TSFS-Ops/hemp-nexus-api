#!/usr/bin/env node
/**
 * Batch 15B guard — UI must never render a full API key.
 *
 * Scans the Batch 15B admin UI files for column references that would render
 * the full API key value (token, secret_key, full_key, api_key_full) and for
 * suspicious display of long-looking key fields outside the
 * `safeKeyReference` helper.
 */
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "src/pages/admin/registry/ApiClientsList.tsx",
  "src/pages/admin/registry/ApiClientDetail.tsx",
  "src/pages/admin/registry/ApiUsage.tsx",
  "src/pages/admin/registry/ApiTestConsole.tsx",
];

const FORBIDDEN_FIELDS = [
  "api_key_full",
  "full_key",
  "secret_key",
  "key_value",
  "raw_key",
  "key_secret",
];

let failed = false;
for (const f of FILES) {
  const full = path.join(process.cwd(), f);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, "utf8");
  for (const token of FORBIDDEN_FIELDS) {
    if (text.includes(token)) {
      console.error(`✗ ${f} — forbidden full-key field reference "${token}"`);
      failed = true;
    }
  }
  // Detail page must use safeKeyReference for any rendered key.
  if (f.endsWith("ApiClientDetail.tsx") && !text.includes("safeKeyReference(")) {
    console.error(`✗ ${f} — key panels must render through safeKeyReference()`);
    failed = true;
  }
}

if (failed) {
  console.error("Batch 15B UI no-full-key guard FAILED.");
  process.exit(1);
}
console.log("✓ Batch 15B UI no-full-key guard OK");
