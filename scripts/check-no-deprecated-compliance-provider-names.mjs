#!/usr/bin/env node
/**
 * Deprecated compliance-provider name guard.
 *
 * Fails the build if a deprecated vendor identifier (CIPC, Onfido,
 * Dow Jones, Refinitiv) appears in the client-facing or edge-runtime
 * source tree. A small allowlist covers the SSOT back-compat maps,
 * historical audit-report docs, and existing test fixtures that pin
 * legacy behaviour.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOTS = ["src", "supabase/functions"];

const EXTS = [".ts", ".tsx", ".mjs", ".js", ".md", ".mdx"];

const DEPRECATED = [
  { re: /\bcipc\b/i, name: "CIPC" },
  { re: /\bonfido\b/i, name: "Onfido" },
  { re: /\bdow[\s_-]?jones\b/i, name: "Dow Jones" },
  { re: /\brefinitiv\b/i, name: "Refinitiv" },
];

// Files/paths that MAY still mention the deprecated names:
//  - SSOT back-compat alias maps (browser + edge mirror + evidence-rating)
//  - Existing tests / smoke tests that pin allow-list behaviour
//  - Audit / historical documentation
const ALLOWED_PATH_PARTS = [
  "src/lib/stub-providers.ts",
  "supabase/functions/_shared/stub-providers.ts",
  "src/lib/evidence-rating.ts",
  "supabase/functions/_shared/evidence-rating.ts",
  "src/lib/idv/provider-registry.ts",
  "src/tests/",
  "src/test/",
  "__tests__/",
  "supabase/functions/idv-verify/o_production_lockout_smoke_test.ts",
  "supabase/functions/idv-person-verify/idv_person_verify_smoke_test.ts",
  "scripts/",
  "docs/",
];

function isAllowed(rel) {
  const norm = rel.replaceAll("\\", "/");
  if (norm.includes(".test.")) return true;
  return ALLOWED_PATH_PARTS.some(
    (p) => norm === p || norm.startsWith(p) || norm.includes(`/${p}`),
  );
}

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
}

const files = [];
for (const root of ROOTS) walk(resolve(root), files);

const offences = [];
for (const f of files) {
  const rel = relative(process.cwd(), f).replaceAll("\\", "/");
  if (isAllowed(rel)) continue;
  const src = readFileSync(f, "utf8");
  const hits = DEPRECATED.filter((d) => d.re.test(src)).map((d) => d.name);
  if (hits.length) offences.push({ rel, hits });
}

if (offences.length) {
  console.error("[check-no-deprecated-compliance-provider-names] FAIL");
  for (const o of offences) console.error(` - ${o.rel}: ${o.hits.join(", ")}`);
  console.error(
    "\nRemove references to deprecated compliance providers (CIPC, Onfido, Dow Jones, Refinitiv).\n" +
      "Use provider-neutral language: 'company registry provider', 'identity-document provider',\n" +
      "'sanctions/PEP screening provider'. Back-compat aliases live only in the SSOT files.",
  );
  process.exit(1);
}

console.log(
  `[check-no-deprecated-compliance-provider-names] OK (scanned ${files.length} files)`,
);
