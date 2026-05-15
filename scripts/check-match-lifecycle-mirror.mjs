#!/usr/bin/env node
/**
 * Batch O Phase 1 — Match lifecycle mirror/parity check.
 *
 * Asserts that the predicate region (between MIRROR-START / MIRROR-END
 * markers) is byte-identical between:
 *   - src/lib/match-lifecycle.ts                       (client)
 *   - supabase/functions/_shared/match-lifecycle.ts    (edge)
 *
 * Wired into `prebuild` so client/edge predicate drift fails CI before deploy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const CLIENT = join(ROOT, "src/lib/match-lifecycle.ts");
const EDGE = join(ROOT, "supabase/functions/_shared/match-lifecycle.ts");

const START = "// MIRROR-START";
const END = "// MIRROR-END";

function extract(path) {
  const src = readFileSync(path, "utf8");
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s === -1 || e === -1 || e < s) {
    console.error(`✗ check:match-lifecycle-mirror — missing MIRROR markers in ${path}`);
    process.exit(1);
  }
  return src.slice(s, e + END.length);
}

const a = extract(CLIENT);
const b = extract(EDGE);
const ha = createHash("sha256").update(a).digest("hex");
const hb = createHash("sha256").update(b).digest("hex");

if (ha !== hb) {
  console.error("\n✗ check:match-lifecycle-mirror — client and edge predicate regions differ.\n");
  console.error(`  client : ${ha}`);
  console.error(`  edge   : ${hb}\n`);
  console.error("Fix: keep the MIRROR-START..MIRROR-END block identical in both files.\n");
  process.exit(1);
}

console.log(
  `✓ check:match-lifecycle-mirror — predicate region in lockstep (sha256 ${ha.slice(0, 12)}…, ${a.length} bytes)`,
);
