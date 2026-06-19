#!/usr/bin/env node
/**
 * scripts/pack-role-negative-evidence.mjs
 *
 * Zips the latest test-evidence/role-negative-e2e/<run_id>/ directory
 * (plus its evidence.jsonl) into /mnt/documents/ for the approver.
 * Mirrors scripts/pack-evidence.mjs for the Smoke A–D pack.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = "test-evidence/role-negative-e2e";
if (!existsSync(ROOT)) {
  console.error(`no evidence directory at ${ROOT} — run the suite first`);
  process.exit(1);
}
const runs = readdirSync(ROOT).filter((f) => statSync(join(ROOT, f)).isDirectory());
if (!runs.length) { console.error("no runs found"); process.exit(1); }
runs.sort((a, b) => statSync(join(ROOT, b)).mtimeMs - statSync(join(ROOT, a)).mtimeMs);
const latest = runs[0];

const ts = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const out = `/mnt/documents/role-negative-e2e-evidence-${ts}.zip`;

try {
  execSync(`zip -r "${out}" "${join(ROOT, latest)}"`, { stdio: "inherit" });
  console.log(`\n✓ wrote ${out} (run ${latest})`);
} catch (e) {
  console.error("zip failed — try: nix run nixpkgs#zip -- ...");
  process.exit(1);
}
