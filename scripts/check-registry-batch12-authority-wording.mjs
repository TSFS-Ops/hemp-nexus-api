#!/usr/bin/env node
/**
 * Batch 12 — Authority wording guard.
 *  - Public surfaces must not use "verified", "verifies", or "institutionally
 *    usable" affirmatively in the context of authority approval.
 *  - Mandatory acknowledgement copy must appear on admin authority approval UI.
 *  - Mandatory public approval notice must appear on user authority status UI.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ACK =
  "I understand that approving authority only grants the selected scope(s). It does not verify the company profile, confirm bank details, or make the company institutionally usable.";
const PUBLIC_NOTICE =
  "Authority approved for selected scopes only. This does not verify the company profile, confirm bank details, or make the company institutionally usable.";

const adminPath = "src/pages/admin/registry/AuthorityReview.tsx";
const userPath = "src/pages/registry/AuthorityStatus.tsx";
let failed = false;
const adminSrc = existsSync(adminPath) ? readFileSync(adminPath, "utf8") : "";
const userSrc = existsSync(userPath) ? readFileSync(userPath, "utf8") : "";
if (
  !(adminSrc.includes(ACK) || adminSrc.includes("REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT"))
) {
  console.error(`✗ admin authority review missing acknowledgement copy`);
  failed = true;
}
if (
  !(userSrc.includes(PUBLIC_NOTICE) || userSrc.includes("REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE"))
) {
  console.error(`✗ user authority status missing public approval notice`);
  failed = true;
}

// Forbidden affirmative wording on user-facing pages.
const BAD = [
  /authority\s+verifies\s+(the\s+)?company/i,
  /institutionally\s+verified/i,
  /bank\s+details?\s+verified\s+by\s+authority/i,
];
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) {
      const src = readFileSync(p, "utf8");
      for (const re of BAD) {
        if (re.test(src)) {
          console.error(`✗ forbidden wording in ${p}: ${re}`);
          failed = true;
        }
      }
    }
  }
}
walk("src/pages/registry");
walk("src/pages/admin/registry");

if (failed) process.exit(1);
console.log("✓ batch-12 authority wording OK");
