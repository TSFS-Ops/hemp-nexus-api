#!/usr/bin/env node
/**
 * P010 copy-drift guard.
 *
 * For client-facing source files, fails the build if a stub-provider name
 * (CIPC, Onfido, Dow Jones, Refinitiv — case-insensitive) appears in the
 * same file as a forbidden P010 word or phrase (verified, cleared, passed,
 * approved, screened, complete, provider-confirmed, ..., "verification
 * complete", etc.).
 *
 * The SSOT files, tests, scripts, evidence and admin diagnostic surfaces
 * are exempt — they are allowed to discuss the policy and reference the
 * provider names in admin-only contexts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOTS = ["src/components", "src/pages", "docs"];

const EXEMPT_PATH_PARTS = [
  // SSOT + tests + evidence + scripts
  "src/lib/stub-providers.ts",
  "src/tests/p010-stub-provider-labelling.test.ts",
  // Admin-only diagnostic surfaces (allowed to name providers w/ approved label)
  "src/components/admin/TestModeBypassPanel.tsx",
  "src/components/admin/StubProviderSimulationPanel.tsx",
  // Evidence + governance docs documenting the policy itself
  "docs/p010-stub-provider-labelling",
];

const PROVIDER_NAME_REGEXES = [
  /\bcipc\b/i,
  /\bonfido\b/i,
  /\bdow[\s_-]?jones\b/i,
  /\brefinitiv\b/i,
];

const FORBIDDEN_WORDS = [
  "verified",
  "cleared",
  "passed",
  "approved",
  "screened",
  // "complete" is too common in unrelated copy; phrase-form catches the real risk
  "provider-confirmed",
  "provider_confirmed",
  "provider-approved",
  "provider_approved",
  "provider_matched",
  "live_check_complete",
];

const FORBIDDEN_PHRASES = [
  "verification complete",
  "screening complete",
  "provider check passed",
  "provider match found",
  "external check complete",
];

const EXTS = [".ts", ".tsx", ".md", ".mdx"];

function isExempt(rel) {
  return EXEMPT_PATH_PARTS.some((p) => rel === p || rel.startsWith(`${p}/`) || rel.startsWith(`${p}\\`));
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (EXTS.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
}

function findOffences(file) {
  const rel = relative(process.cwd(), file).replaceAll("\\", "/");
  if (isExempt(rel)) return [];
  const src = readFileSync(file, "utf8");
  const lower = src.toLowerCase();

  // Skip files that don't even mention a stub provider name.
  if (!PROVIDER_NAME_REGEXES.some((re) => re.test(src))) return [];

  const hits = [];
  for (const w of FORBIDDEN_WORDS) {
    // Word-boundary match, case-insensitive
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(src)) hits.push(`word:"${w}"`);
  }
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) hits.push(`phrase:"${phrase}"`);
  }
  return hits.length ? [{ rel, hits }] : [];
}

const files = [];
for (const root of ROOTS) walk(resolve(root), files);

const offences = [];
for (const f of files) offences.push(...findOffences(f));

if (offences.length) {
  console.error("[check-stub-provider-copy-drift] FAIL");
  for (const o of offences) {
    console.error(` - ${o.rel}: ${o.hits.join(", ")}`);
  }
  console.error(
    "\nP010: a stub provider name (CIPC, Onfido, Dow Jones, Refinitiv) appears\n" +
      "alongside forbidden status/result wording on a non-admin-diagnostic surface.\n" +
      "Either remove the provider name or remove the verified/cleared/passed/etc wording.",
  );
  process.exit(1);
}

console.log(
  `[check-stub-provider-copy-drift] OK (scanned ${files.length} files across ${ROOTS.length} roots)`,
);
