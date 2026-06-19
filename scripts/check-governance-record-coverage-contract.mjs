#!/usr/bin/env node
/**
 * Governance Record Batch 1 — Coverage Probe Contract Guard.
 *
 * The probe is ASSESSMENT-ONLY. This guard fails the build if any of the
 * following drift:
 *   - probe file missing
 *   - platform_admin gating missing
 *   - AAL2 / MFA gating missing
 *   - probe contains .from('event_store') (row-level read of event_store)
 *   - probe contains SELECT/UPDATE/DELETE/INSERT/UPSERT/TRUNCATE/ALTER
 *     against event_store
 *   - probe imports any critical-event writer
 *     (writeCriticalGovernanceEvent / writeGovernanceEventBestEffort /
 *      writeCriticalEventWithPosture)
 *   - probe is imported from any src/ file (client-side leak)
 *   - a UI component file is created under
 *     src/components/admin/governance/CoveragePanel*
 *   - a pg_cron entry referencing the probe is committed
 *   - the canonical audit name 'governance.event_store.coverage_probed'
 *     is missing or unpinned
 *   - the probe is missing from supabase/functions/aal-preflight/index.ts
 *     action registry
 *
 * Scope: inspects the probe file, supabase/migrations/, the aal-preflight
 * registry, and the src/ tree only. It does NOT alter or schedule
 * anything.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROBE_PATH =
  "supabase/functions/governance-record-coverage-probe/index.ts";
const AAL_REGISTRY = "supabase/functions/aal-preflight/index.ts";
const CANONICAL_AUDIT = "governance.event_store.coverage_probed";
const AAL_ACTION = "governance.event_store.coverage_probe";

const errors = [];

function read(p) {
  return readFileSync(resolve(ROOT, p), "utf8");
}

if (!existsSync(resolve(ROOT, PROBE_PATH))) {
  console.error(`✗ Governance Record Batch 1 guard: probe missing at ${PROBE_PATH}`);
  process.exit(1);
}

const src = read(PROBE_PATH);

// --- gating ---
if (!/has_role[^)]*_role:\s*"platform_admin"/s.test(src)) {
  errors.push("probe must gate on has_role(_role: 'platform_admin')");
}
if (!/assertAal2\(/.test(src)) {
  errors.push("probe must call assertAal2() — MFA gate required");
}
if (!/MFA_REQUIRED/.test(src)) {
  errors.push("probe must surface ApiException MFA_REQUIRED as 403");
}

// Strip comments and string literals before pattern-matching executable code.
// Doc/recommendation text and evidence citations must NOT trip the checks.
function stripCommentsAndStrings(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}
const code = stripCommentsAndStrings(src);

// --- forbidden: any row-level read or mutation of event_store ---
if (/\.from\(\s*["']event_store["']\s*\)/.test(code)) {
  errors.push(
    "probe must NOT call .from('event_store') — static coverage matrix only, no row reads",
  );
}
const forbiddenSql = [
  /select\b[^;]*\bfrom\s+(public\.)?event_store\b/i,
  /update\s+(public\.)?event_store\b/i,
  /delete\s+from\s+(public\.)?event_store\b/i,
  /insert\s+into\s+(public\.)?event_store\b/i,
  /upsert\s+(public\.)?event_store\b/i,
  /truncate\s+(public\.)?event_store\b/i,
  /alter\s+table\s+(public\.)?event_store\b/i,
];
for (const re of forbiddenSql) {
  if (re.test(code)) {
    errors.push(`probe contains forbidden SQL against event_store: /${re.source}/`);
  }
}

// --- forbidden: critical-event writer imports / calls ---
const forbiddenWriters = [
  "writeCriticalGovernanceEvent",
  "writeGovernanceEventBestEffort",
  "writeCriticalEventWithPosture",
];
for (const w of forbiddenWriters) {
  if (new RegExp(`\\b${w}\\b`).test(code)) {
    errors.push(
      `probe must NOT reference critical-event writer '${w}' — assessment-only`,
    );
  }
}

// --- forbidden: runtime introspection (information_schema / pg_catalog) ---
if (/information_schema\.|pg_catalog\./i.test(code)) {
  errors.push(
    "probe must NOT introspect information_schema / pg_catalog at runtime — static matrix only",
  );
}

// --- audit name pin ---
if (!src.includes(`"${CANONICAL_AUDIT}"`)) {
  errors.push(`probe must reference canonical audit name '${CANONICAL_AUDIT}'`);
}
if (
  !new RegExp(
    `COVERAGE_AUDIT_NAME\\s*=\\s*"${CANONICAL_AUDIT.replace(/\./g, "\\.")}"`,
  ).test(src)
) {
  errors.push(
    "COVERAGE_AUDIT_NAME constant must equal canonical name and be pinned",
  );
}
if (!/from\("audit_logs"\)\.insert/.test(src)) {
  errors.push("probe must write the canonical audit to audit_logs");
}

// --- assessment-only response markers ---
if (!/assessment_only:\s*true/.test(src)) {
  errors.push("probe response must include assessment_only: true");
}
if (!/reads_event_store_rows:\s*false/.test(src)) {
  errors.push("probe response must include reads_event_store_rows: false");
}
if (!/mutates_event_store:\s*false/.test(src)) {
  errors.push("probe response must include mutates_event_store: false");
}
if (!/adds_fail_closed_enforcement:\s*false/.test(src)) {
  errors.push("probe response must include adds_fail_closed_enforcement: false");
}

// --- no UI surface ---
const ADMIN_GOV_DIR = resolve(ROOT, "src/components/admin/governance");
if (existsSync(ADMIN_GOV_DIR)) {
  for (const f of readdirSync(ADMIN_GOV_DIR)) {
    if (/^CoveragePanel/i.test(f) || /CoverageProbe/i.test(f)) {
      errors.push(
        `forbidden UI surface: src/components/admin/governance/${f} (Batch 1 is probe/test/assessment only)`,
      );
    }
  }
}

// --- no client-side import of the probe ---
function walkSrc(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkSrc(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(full)) out.push(full);
  }
  return out;
}
for (const f of walkSrc(resolve(ROOT, "src"))) {
  const content = readFileSync(f, "utf8");
  if (/governance-record-coverage-probe/.test(content) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")) {
    errors.push(
      `client-side reference to probe is forbidden: ${f.replace(ROOT + "/", "")}`,
    );
  }
}

// --- aal-preflight registry pin ---
if (!existsSync(resolve(ROOT, AAL_REGISTRY))) {
  errors.push(`aal-preflight registry missing at ${AAL_REGISTRY}`);
} else {
  const reg = read(AAL_REGISTRY);
  if (!new RegExp(`"${AAL_ACTION.replace(/\./g, "\\.")}"\\s*:\\s*"aal2"`).test(reg)) {
    errors.push(
      `aal-preflight ACTION_AAL_REQUIREMENTS must pin '${AAL_ACTION}': 'aal2'`,
    );
  }
}

// --- no pg_cron schedule for the probe ---
function walkSql(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkSql(full));
    else if (full.endsWith(".sql")) out.push(full);
  }
  return out;
}
const migrationsDir = resolve(ROOT, "supabase/migrations");
if (existsSync(migrationsDir)) {
  for (const file of walkSql(migrationsDir)) {
    const sql = readFileSync(file, "utf8");
    if (/cron\.schedule\([^)]*governance-record-coverage-probe/i.test(sql)) {
      errors.push(`forbidden: pg_cron schedule for the coverage probe in ${file}`);
    }
  }
}

if (errors.length) {
  console.error("✗ Governance Record Batch 1 coverage contract failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(
  `✓ Governance Record Batch 1 coverage contract OK (probe assessment-only; audit '${CANONICAL_AUDIT}' pinned)`,
);
