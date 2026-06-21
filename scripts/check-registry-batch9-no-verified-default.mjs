#!/usr/bin/env node
// Batch 9 — block any new code path that defaults an imported record to
// `verified`, `production_ready` or `institutionally_usable`. The only
// allowed default for the import pipeline is `imported_unverified`.
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN = [
  /readiness_state[^"']{0,40}["']verified["']/,
  /readiness_state[^"']{0,40}["']production_ready["']/,
  /readiness_state[^"']{0,40}["']institutionally_usable["']/,
];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === "node_modules" || f.name.startsWith(".")) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|sql|mjs|js)$/.test(f.name)) out.push(p);
  }
  return out;
}

const roots = ["supabase/functions", "supabase/migrations", "src"];
const ignore = [
  /check-registry-batch9-no-verified-default\.mjs$/,
  /registry-import-pipeline\.ts$/,
];
const offenders = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (ignore.some(r => r.test(file))) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(src)) offenders.push({ file, rule: re.source });
    }
  }
}

if (offenders.length > 0) {
  console.error("Forbidden imported-record readiness defaults detected:");
  for (const o of offenders) console.error(`  ${o.file}  (${o.rule})`);
  process.exit(1);
}
console.log("registry-batch9-no-verified-default OK");
