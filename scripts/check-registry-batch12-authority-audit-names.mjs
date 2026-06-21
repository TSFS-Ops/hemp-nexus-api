#!/usr/bin/env node
/**
 * Batch 12 — Authority audit event-name guard.
 * Ensures every Batch 12 audit-event constant remains canonical in TS SSOT and
 * that no edge function emits a non-canonical authority audit-event name.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CANON_FILE = "src/lib/registry-authority-workflow.ts";
const text = readFileSync(CANON_FILE, "utf8");
const m = text.match(
  /REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/,
);
if (!m) {
  console.error("✗ canonical audit-event list missing");
  process.exit(1);
}
const canon = new Set(
  Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]),
);

const ROOTS = ["supabase/functions"];
const offenders = [];
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      const src = readFileSync(p, "utf8");
      for (const mm of src.matchAll(/"(registry_authority_[a-z_]+)"/g)) {
        const name = mm[1];
        if (!canon.has(name) && !/_(request_|status_changed|reviewed|revoked|disputed)/.test(name)) {
          offenders.push({ file: p, name });
        }
      }
    }
  }
}
for (const r of ROOTS) walk(r);
// Allow legacy Batch 4 names alongside new B12 names — both sets are documented as canonical.
const LEGACY_OK = new Set([
  "registry_authority_request_started",
  "registry_authority_request_submitted",
  "registry_authority_status_changed",
  "registry_authority_evidence_added",
  "registry_authority_reviewed",
  "registry_authority_revoked",
  "registry_authority_disputed",
]);
const real = offenders.filter((o) => !LEGACY_OK.has(o.name));
if (real.length) {
  for (const o of real) console.error(`✗ ${o.file}: non-canonical ${o.name}`);
  process.exit(1);
}
console.log(`✓ batch-12 authority audit-event names OK (${canon.size} canonical)`);
