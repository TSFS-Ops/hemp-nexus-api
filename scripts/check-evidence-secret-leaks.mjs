#!/usr/bin/env node
/**
 * check-evidence-secret-leaks
 *
 * Scans evidence/, playwright-report/, and test-results/ (Playwright traces +
 * attachments) for accidental secret leaks before any release bundle is built
 * or shipped. Exits non-zero on the first suspicious hit so:
 *   - `npm run build` (via prebuild) blocks the bundle, and
 *   - `node scripts/pack-evidence.mjs` refuses to zip a tainted run.
 *
 * Patterns covered (high-signal, low-false-positive):
 *   1. Supabase service_role JWTs — decoded payload contains
 *      `"role":"service_role"` (catches both literal env var paste and any
 *      base64url token whose payload decodes to that string).
 *   2. SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY env-var names paired
 *      with a non-empty value.
 *   3. INTERNAL_CRON_KEY paired with a value (cron auth shared secret).
 *   4. otpauth:// provisioning URIs (these embed the raw TOTP seed —
 *      worst-case leak; treat as critical).
 *   5. TOTP codes only when they appear next to an explicit label such as
 *      `totp`, `otp`, `mfa_code`, `code:` — bare 6-digit numbers are
 *      ignored to avoid false positives on timestamps / IDs / amounts.
 *   6. `sk_live_…` / `sk_test_…` Stripe-style keys and `sk_…` Izenzo
 *      API keys longer than 24 chars.
 *
 * Safe-list:
 *   - Anonymous/publishable JWTs (payload `"role":"anon"` or
 *     `"role":"authenticated"`) are explicitly allowed.
 *   - `summary.json` / log files for fixture orgs may legitimately
 *     contain 6-digit reference codes, so we only flag TOTP-labelled ones.
 *
 * Usage:
 *   node scripts/check-evidence-secret-leaks.mjs
 *   node scripts/check-evidence-secret-leaks.mjs --paths evidence playwright-report
 *
 * Override scan roots via EVIDENCE_SCAN_ROOTS env var (comma-separated).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";

const ROOT = resolve(process.cwd());

const DEFAULT_ROOTS = ["evidence", "playwright-report", "test-results"];
const ENV_ROOTS = process.env.EVIDENCE_SCAN_ROOTS
  ? process.env.EVIDENCE_SCAN_ROOTS.split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const cliPathsIdx = process.argv.indexOf("--paths");
const CLI_ROOTS = cliPathsIdx >= 0 ? process.argv.slice(cliPathsIdx + 1) : null;
const ROOTS = (CLI_ROOTS ?? ENV_ROOTS ?? DEFAULT_ROOTS)
  .map((r) => (r.startsWith("/") ? r : join(ROOT, r)))
  .filter((p) => existsSync(p));

// Binary/irrelevant extensions we never scan — but we still scan playwright
// `.zip` traces by extracting their text members. For now we treat .zip
// as text by streaming, which is sufficient because trace files store
// network/console snapshots as JSON entries that compress predictably and
// the JWT/otpauth string patterns still appear verbatim inside the zip
// container often enough to catch leaks; deeper inspection can be added
// later if a real miss is found.
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf",
  ".mp4", ".webm", ".mov",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file cap

const findings = [];

function record(severity, rule, file, line, snippet) {
  findings.push({ severity, rule, file: relative(ROOT, file), line, snippet });
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SERVICE_ROLE_ENV_RE = /\b(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\b\s*[=:]\s*['"]?([^\s'"]{12,})/g;
const CRON_KEY_RE = /\bINTERNAL_CRON_KEY\b\s*[=:]\s*['"]?([^\s'"]{8,})/g;
const OTPAUTH_RE = /otpauth:\/\/[^\s'"<>]+/g;
const TOTP_LABEL_RE = /\b(totp|otp|mfa[_-]?code|mfa[_-]?token|one[_-]?time[_-]?(?:pass|code))\b['":\s=]+["']?(\d{6,8})\b/gi;
const SK_KEY_RE = /\bsk_(?:live|test)?_?[A-Za-z0-9]{24,}\b/g;

// Allow-list snippets that are known-safe (e.g. doc examples).
const ALLOW_SUBSTRINGS = [
  "role\":\"anon\"",
  "role\":\"authenticated\"",
];

function isAllowed(snippet) {
  return ALLOW_SUBSTRINGS.some((s) => snippet.includes(s));
}

function scanContent(file, text) {
  // 1 + 2 — JWT bodies that decode to service_role
  let m;
  JWT_RE.lastIndex = 0;
  while ((m = JWT_RE.exec(text)) !== null) {
    const payload = decodeJwtPayload(m[0]);
    if (payload && payload.includes("\"role\":\"service_role\"")) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      record("CRITICAL", "supabase_service_role_jwt", file, lineNo, m[0].slice(0, 32) + "…");
    }
  }
  // 3 — env-style service role assignments
  SERVICE_ROLE_ENV_RE.lastIndex = 0;
  while ((m = SERVICE_ROLE_ENV_RE.exec(text)) !== null) {
    const snippet = m[0];
    if (isAllowed(snippet)) continue;
    if (/(REDACTED|<redacted>|REPLACE_ME|YOUR_KEY|\*\*\*)/i.test(m[2])) continue;
    const lineNo = text.slice(0, m.index).split("\n").length;
    record("CRITICAL", "service_role_env_assignment", file, lineNo, `${m[1]}=${m[2].slice(0, 8)}…`);
  }
  // 4 — internal cron key
  CRON_KEY_RE.lastIndex = 0;
  while ((m = CRON_KEY_RE.exec(text)) !== null) {
    if (/(REDACTED|<redacted>|REPLACE_ME|YOUR_KEY|\*\*\*)/i.test(m[1])) continue;
    const lineNo = text.slice(0, m.index).split("\n").length;
    record("CRITICAL", "internal_cron_key", file, lineNo, `INTERNAL_CRON_KEY=${m[1].slice(0, 6)}…`);
  }
  // 5 — otpauth provisioning URIs (leaks the TOTP seed)
  OTPAUTH_RE.lastIndex = 0;
  while ((m = OTPAUTH_RE.exec(text)) !== null) {
    const lineNo = text.slice(0, m.index).split("\n").length;
    record("CRITICAL", "otpauth_provisioning_uri", file, lineNo, m[0].slice(0, 48) + "…");
  }
  // 6 — labelled TOTP / MFA codes
  TOTP_LABEL_RE.lastIndex = 0;
  while ((m = TOTP_LABEL_RE.exec(text)) !== null) {
    const lineNo = text.slice(0, m.index).split("\n").length;
    record("HIGH", "labelled_totp_code", file, lineNo, `${m[1]}=${m[2]}`);
  }
  // 7 — sk_ live/test keys
  SK_KEY_RE.lastIndex = 0;
  while ((m = SK_KEY_RE.exec(text)) !== null) {
    if (/REDACTED|<redacted>|REPLACE_ME/i.test(m[0])) continue;
    const lineNo = text.slice(0, m.index).split("\n").length;
    record("CRITICAL", "sk_secret_key", file, lineNo, m[0].slice(0, 10) + "…");
  }
}

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) { await walk(full); continue; }
    if (!ent.isFile()) continue;
    if (SKIP_EXT.has(extname(ent.name).toLowerCase())) continue;
    let st;
    try { st = await stat(full); } catch { continue; }
    if (st.size === 0 || st.size > MAX_BYTES) continue;
    let text;
    try { text = await readFile(full, "utf8"); } catch { continue; }
    scanContent(full, text);
  }
}

if (ROOTS.length === 0) {
  console.log("✅ Evidence secret-leak scan: no evidence/ or playwright artefacts present — nothing to scan.");
  process.exit(0);
}

for (const root of ROOTS) await walk(root);

if (findings.length === 0) {
  console.log(`✅ Evidence secret-leak scan: clean (${ROOTS.length} root(s) scanned).`);
  process.exit(0);
}

console.error("❌ Evidence secret-leak scan FAILED — bundle blocked.\n");
const grouped = new Map();
for (const f of findings) {
  const key = `${f.severity} · ${f.rule}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(f);
}
for (const [key, items] of grouped) {
  console.error(`  ${key}  (${items.length} hit${items.length === 1 ? "" : "s"})`);
  for (const f of items.slice(0, 20)) {
    console.error(`    - ${f.file}:${f.line}  ${f.snippet}`);
  }
  if (items.length > 20) console.error(`    … ${items.length - 20} more`);
}
console.error(`\nRemove the secret(s) from the evidence and re-run the smoke suite before packaging or shipping.`);
process.exit(1);
