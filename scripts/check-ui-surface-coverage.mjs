#!/usr/bin/env node
/**
 * UI surface coverage guard.
 *
 * Asserts that every exported Panel / Dashboard / Viewer component under
 * src/components/admin and src/components/developer is mounted as a JSX
 * tag somewhere else in src/ (i.e. surfaced to a real UI surface).
 *
 * Rationale: backend-facing panels frequently land in the repo before
 * they are wired into HQ.tsx / DeveloperCenter.tsx. This guard catches
 * the drift at build time, the same way check-aal-registry-drift.mjs
 * catches missing AAL registrations.
 *
 * Intentionally internal components (rendered only by parent panels,
 * gated behind an internal cron-key flow, or kept dormant on purpose)
 * must be listed in scripts/ui-surface-coverage-allowlist.json with a
 * short reason. The allowlist is the audit trail.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components/admin", "src/components/developer"];
const SUFFIX_RE = /(Panel|Dashboard|Viewer)$/;

const allowlist = (() => {
  try {
    return JSON.parse(
      readFileSync("scripts/ui-surface-coverage-allowlist.json", "utf8"),
    );
  } catch {
    return {};
  }
})();

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function collectSrcFiles() {
  const out = [];
  walk("src", out);
  return out.filter((f) => !/\.test\.[tj]sx?$/.test(f));
}

const componentFiles = ROOTS.flatMap((r) => walk(r));
const allSrcFiles = collectSrcFiles();

// Pre-load every src file's contents once.
const srcContents = new Map(
  allSrcFiles.map((f) => [f, readFileSync(f, "utf8")]),
);

const orphans = [];
const stale = new Set(Object.keys(allowlist));

for (const file of componentFiles) {
  const name = file.split("/").pop().replace(/\.tsx$/, "");
  if (!SUFFIX_RE.test(name)) continue;

  const tag = new RegExp(`<${name}\\b`);
  let mounted = false;
  for (const [other, body] of srcContents) {
    if (other === file) continue;
    if (tag.test(body)) {
      mounted = true;
      break;
    }
  }

  if (mounted) {
    stale.delete(name);
    continue;
  }
  if (allowlist[name]) {
    stale.delete(name);
    continue;
  }
  orphans.push(name);
}

let failed = false;

if (orphans.length > 0) {
  failed = true;
  console.error("❌ UI surface coverage check FAILED:");
  console.error("");
  console.error(
    "These Panel/Dashboard/Viewer components are exported but never",
  );
  console.error("mounted as a JSX tag anywhere in src/:");
  for (const name of orphans) console.error(`  - ${name}`);
  console.error("");
  console.error(
    "Either mount them in the relevant page (HQ.tsx, DeveloperCenter.tsx,",
  );
  console.error(
    "Desk shell, etc.) OR add them to scripts/ui-surface-coverage-allowlist.json",
  );
  console.error("with a short reason explaining why they are intentionally internal.");
}

if (stale.size > 0) {
  failed = true;
  console.error("");
  console.error("❌ Stale allowlist entries (component is now mounted or removed):");
  for (const name of stale) console.error(`  - ${name}`);
  console.error("");
  console.error(
    "Remove these entries from scripts/ui-surface-coverage-allowlist.json.",
  );
}

if (failed) process.exit(1);

console.log(
  `✅ UI surface coverage OK — ${componentFiles.filter((f) => SUFFIX_RE.test(f.split("/").pop().replace(/\.tsx$/, ""))).length} panels checked, ${Object.keys(allowlist).length} intentionally internal.`,
);
