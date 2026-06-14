#!/usr/bin/env node
/**
 * Phase 2 drift guard.
 *
 * Pins the Phase 2 outreach SSOTs so the client and server files stay
 * in lockstep:
 *
 *   src/lib/facilitation-outreach-constants.ts
 *     ⇄ supabase/functions/_shared/facilitation-outreach-constants.ts
 *
 *   src/lib/facilitation-outreach-gate.ts
 *     ⇄ supabase/functions/_shared/facilitation-outreach-gate.ts
 *
 *   src/lib/facilitation-outreach-schemas.ts
 *     ⇄ supabase/functions/_shared/facilitation-outreach-schemas.ts
 *
 * For the constants file, every `as const` list export is compared
 * element-by-element. For the gate and schema files, an extracted
 * list of exported identifiers must match between client and server.
 *
 * Phase 2 also guarantees no send-path / no UI yet:
 *   - no template/candidate/send/escalation edge function dir exists
 *   - no Phase 2 outreach component file exists under src/components
 *     or src/pages with a "facilitation-outreach" / "facilitation-dnc"
 *     / "facilitation-escalation" name
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PAIRS = [
  [
    "src/lib/facilitation-outreach-constants.ts",
    "supabase/functions/_shared/facilitation-outreach-constants.ts",
  ],
  [
    "src/lib/facilitation-outreach-gate.ts",
    "supabase/functions/_shared/facilitation-outreach-gate.ts",
  ],
  [
    "src/lib/facilitation-outreach-schemas.ts",
    "supabase/functions/_shared/facilitation-outreach-schemas.ts",
  ],
];

const CONST_LISTS = [
  "TEMPLATE_STATUSES",
  "CANDIDATE_STATUSES",
  "SEND_STATUSES",
  "OUTREACH_STATES",
  "DNC_RULE_TYPES",
  "DNC_RULE_STATUSES",
  "DNC_RULE_SEVERITIES",
  "ESCALATION_STATUSES",
  "DUPLICATE_GATE_STATUSES",
  "GATE_RESULTS",
  "GATE_REASON_CODES",
];

const SCHEMA_NAMES_LIST = "FACILITATION_OUTREACH_SCHEMA_NAMES";

const FORBIDDEN_FN_DIRS = [
  "supabase/functions/facilitation-outreach-template-update",
  "supabase/functions/facilitation-outreach-candidate-add",
  "supabase/functions/facilitation-outreach-send",
  "supabase/functions/facilitation-compliance-escalate",
  "supabase/functions/facilitation-compliance-escalation-resolve",
];

function extractList(src, marker) {
  const start = src.indexOf(`export const ${marker} = [`);
  if (start < 0) return null;
  const end = src.indexOf("] as const", start);
  if (end < 0) return null;
  return src.slice(start, end).match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
}

function extractExports(src) {
  const ids = new Set();
  const re = /export\s+(?:const|function|type|interface)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) ids.add(m[1]);
  return [...ids].sort();
}

const errors = [];

for (const [client, server] of PAIRS) {
  for (const p of [client, server]) {
    if (!existsSync(resolve(ROOT, p))) errors.push(`Missing SSOT file: ${p}`);
  }
}
if (errors.length) {
  console.error("[check-facilitation-outreach-drift] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

// 1. Constants byte-equal list comparison.
{
  const [c, s] = PAIRS[0].map((p) => readFileSync(resolve(ROOT, p), "utf8"));
  for (const marker of CONST_LISTS) {
    const a = extractList(c, marker);
    const b = extractList(s, marker);
    if (!a || !b) {
      errors.push(`${marker}: could not extract from one of the SSOTs`);
      continue;
    }
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      errors.push(
        `${marker} drift between client/server constants SSOT\n    client: ${JSON.stringify(a)}\n    server: ${JSON.stringify(b)}`,
      );
    }
  }
}

// 2. Gate file exported identifier parity.
{
  const [c, s] = PAIRS[1].map((p) => readFileSync(resolve(ROOT, p), "utf8"));
  const a = extractExports(c);
  const b = extractExports(s);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    errors.push(`Gate file export drift\n    client: ${JSON.stringify(a)}\n    server: ${JSON.stringify(b)}`);
  }
  // resolveOutreachGate must be present in both.
  if (!a.includes("resolveOutreachGate") || !b.includes("resolveOutreachGate")) {
    errors.push("resolveOutreachGate must be exported by both gate SSOTs");
  }
}

// 3. Schema file: schema names list + exported identifier parity.
{
  const [c, s] = PAIRS[2].map((p) => readFileSync(resolve(ROOT, p), "utf8"));
  const a = extractExports(c);
  const b = extractExports(s);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    errors.push(`Schema file export drift\n    client: ${JSON.stringify(a)}\n    server: ${JSON.stringify(b)}`);
  }
  const an = extractList(c, SCHEMA_NAMES_LIST);
  const bn = extractList(s, SCHEMA_NAMES_LIST);
  if (!an || !bn) errors.push(`${SCHEMA_NAMES_LIST}: could not extract`);
  else if (an.length !== bn.length || an.some((v, i) => v !== bn[i])) {
    errors.push(`${SCHEMA_NAMES_LIST} drift\n    client: ${JSON.stringify(an)}\n    server: ${JSON.stringify(bn)}`);
  }
}

// 4. Forbidden: no Phase 2 send / candidate / escalation edge function dirs yet.
for (const dir of FORBIDDEN_FN_DIRS) {
  if (existsSync(resolve(ROOT, dir))) {
    errors.push(`Phase 2 send-path forbidden in Step 2: edge function dir exists at ${dir}`);
  }
}

// 5. Forbidden: no Phase 2 UI surfaces yet.
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const UI_FORBIDDEN_PATTERNS = [
  /facilitation[-_]?outreach/i,
  /facilitation[-_]?dnc/i,
  /facilitation[-_]?(compliance[-_]?)?escalation/i,
];
for (const root of ["src/components", "src/pages"]) {
  for (const file of walk(resolve(ROOT, root))) {
    const base = file.slice(ROOT.length + 1);
    if (UI_FORBIDDEN_PATTERNS.some((re) => re.test(base))) {
      errors.push(`Phase 2 UI forbidden in Step 2: ${base}`);
    }
  }
}

if (errors.length) {
  console.error("[check-facilitation-outreach-drift] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-facilitation-outreach-drift] OK");
