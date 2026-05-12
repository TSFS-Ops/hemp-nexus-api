#!/usr/bin/env node
// Phrase/field linter for the Release Checkpoint Pack.
// Extracts the DOCX to plain text via pandoc, splits it into "allowed zones"
// (sections where prohibited terms legitimately appear as deny-list copy) and
// "forbidden zones" (everything else), then blocks release if any prohibited
// phrase, forbidden field, or counterparty/candidate/disputed-party
// email/SMS implication appears in a forbidden zone.
//
// Run: node scripts/lint-release-pack.mjs <path-to-docx>
// Exit code: 0 = clean, 1 = blocked.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const target = resolve(
  process.argv[2] ||
    "/mnt/documents/Izenzo_Release_Checkpoint_Client_Acceptance_Pack_REVISED.docx",
);
if (!existsSync(target)) {
  console.error("LINT FAIL — file not found:", target);
  process.exit(1);
}

// ---- Extract & flatten text --------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), "lint-pack-"));
const txt = join(tmp, "pack.txt");
execFileSync("pandoc", [target, "-t", "plain", "-o", txt]);
const raw = readFileSync(txt, "utf8");
const flat = raw.replace(/\s+/g, " ");

// ---- Allowed-zone carve-outs -------------------------------------------
// These section headings introduce zones where the prohibited fields/phrases
// MAY legitimately appear (deny-lists, "must not include" lists, etc.).
// Each zone runs from its start anchor to its end anchor.
const ALLOWED_ZONES = [
  {
    name: "Safe to test warning",
    start: "Safe to test",
    end: "What this release covers",
  },
  {
    name: "Fields that the panel and CSV deliberately do not include",
    start: "Fields that the panel and CSV deliberately do not include",
    end: "Batch L —",
  },
  {
    name: "Test 5 — CSV export expected/problem lines",
    start: "Test 5 — CSV export",
    end: "Test 6 —",
  },
  {
    name: "What counts as a problem",
    start: "What counts as a problem",
    end: "Sign-off requested",
  },
];

function buildZones() {
  const allowed = []; // [start, end) offsets in `flat`
  for (const z of ALLOWED_ZONES) {
    const s = flat.indexOf(z.start);
    if (s === -1) continue;
    const e = z.end ? flat.indexOf(z.end, s + z.start.length) : flat.length;
    allowed.push({ name: z.name, s, e: e === -1 ? flat.length : e });
  }
  return allowed.sort((a, b) => a.s - b.s);
}
const allowedZones = buildZones();
const inAllowedZone = (offset) =>
  allowedZones.some((z) => offset >= z.s && offset < z.e);

// ---- Rules --------------------------------------------------------------
// Each rule is { id, severity, pattern, why, alwaysBlocks? }.
// alwaysBlocks=true means hits anywhere fail the lint, ignoring zones.
const RULES = [
  // Hard bans — anywhere in the document.
  {
    id: "BAN_LOVABLE", severity: "block", alwaysBlocks: true,
    pattern: /\bLovable\b/g,
    why: "Internal tool name must not appear in client-facing output.",
  },
  {
    id: "BAN_PLAIN_ENGLISH", severity: "block", alwaysBlocks: true,
    pattern: /\bin plain English\b/gi,
    why: "Patronising phrase explicitly disallowed.",
  },

  // Forbidden CSV / panel fields — only fail OUTSIDE allowed deny-list zones.
  ...[
    "counterparty email",
    "counterparty name",
    "dispute reason",
    "candidate organisations",
    "binding candidates",
    "commercial terms",
    "administrator notes",
    "support notes",
  ].map((field) => ({
    id: `CSV_FIELD_LEAK:${field}`,
    severity: "block",
    pattern: new RegExp(`\\b${field.replace(/ /g, "\\s+")}\\b`, "gi"),
    why: `Forbidden CSV/panel field "${field}" must only appear inside the deny-list or "what counts as a problem" sections.`,
  })),

  // Counterparty / candidate / disputed-party email or SMS implications.
  // Hits outside allowed zones imply the platform sends/added such messages,
  // which is the exact assertion we must never make in this pack.
  {
    id: "CP_EMAIL_SMS_IMPLICATION",
    severity: "block",
    pattern:
      /\b(counterpart(y|ies)|candidate(?:\s+organisations?)?|disputed[-\s]party|disputed parties)\b[^.]{0,120}?\b(email|e-mail|sms|notif(?:y|ication)|sent|notified|outreach|messag(?:e|ed))\b/gi,
    why: "Phrasing implies a counterparty/candidate/disputed-party email or SMS path was added or used. This release explicitly does not change counterparty-facing surfaces.",
  },
  {
    id: "CP_EMAIL_SMS_IMPLICATION_REVERSE",
    severity: "block",
    pattern:
      /\b(email|e-mail|sms|notif(?:y|ication)|outreach|messag(?:e|ed))\b[^.]{0,80}?\b(counterpart(y|ies)|candidate(?:\s+organisations?)?|disputed[-\s]party|disputed parties)\b/gi,
    why: "Phrasing implies sending email/SMS/notifications to counterparties, candidates, or disputed parties.",
  },
];

// ---- Scan ---------------------------------------------------------------
const findings = [];
for (const rule of RULES) {
  let m;
  rule.pattern.lastIndex = 0;
  while ((m = rule.pattern.exec(flat)) !== null) {
    const offset = m.index;
    if (!rule.alwaysBlocks && inAllowedZone(offset)) continue;
    const ctxStart = Math.max(0, offset - 40);
    const ctxEnd = Math.min(flat.length, offset + m[0].length + 40);
    findings.push({
      ruleId: rule.id,
      match: m[0],
      offset,
      zone: allowedZones.find((z) => offset >= z.s && offset < z.e)?.name || "(forbidden zone)",
      context: flat.slice(ctxStart, ctxEnd).trim(),
      why: rule.why,
    });
    if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
  }
}

// ---- Report -------------------------------------------------------------
console.log(`Lint target: ${target}`);
console.log(`Allowed zones detected: ${allowedZones.length}`);
for (const z of allowedZones) console.log(`  [${z.s}-${z.e}] ${z.name}`);
console.log(`Rules evaluated: ${RULES.length}`);

if (findings.length === 0) {
  console.log("\nLINT PASS — no prohibited phrases or field leaks in forbidden zones.");
  process.exit(0);
}

console.log(`\nLINT FAIL — ${findings.length} blocking finding(s):\n`);
for (const f of findings) {
  console.log(`  [${f.ruleId}] match="${f.match}" @${f.offset} (zone=${f.zone})`);
  console.log(`    context: …${f.context}…`);
  console.log(`    why: ${f.why}`);
}
console.log(`\nRelease BLOCKED. Fix the source before publishing.`);
process.exit(1);
