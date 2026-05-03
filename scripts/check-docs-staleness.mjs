#!/usr/bin/env node
/**
 * check-docs-staleness.mjs
 *
 * Fails CI if key documentation files are stale or missing required sections.
 *
 * Two rules per doc:
 *   1. STALENESS — the most recent dated marker in the file
 *      ("Last updated: YYYY-MM-DD" / "**Last updated:** D Month YYYY" /
 *       "Updated: YYYY-MM-DD" / a top-of-file ISO date) must be within
 *      MAX_AGE_DAYS of today (default 120).
 *   2. REQUIRED SECTIONS — every heading in `requiredSections` must appear
 *      verbatim (case-insensitive substring match) in the file.
 *
 * Override the freshness window with DOCS_MAX_AGE_DAYS=N (e.g. in CI).
 *
 * To register a new doc, add it to DOC_RULES below.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MAX_AGE_DAYS = Number.isFinite(Number(process.env.DOCS_MAX_AGE_DAYS))
  ? Number(process.env.DOCS_MAX_AGE_DAYS)
  : 120;

/** @type {Array<{ path: string, requiredSections: string[] }>} */
const DOC_RULES = [
  {
    path: "docs/README.md",
    requiredSections: [
      "Trade Request",
      "Engagement",
      "Proof of Intent",
      "Without a Doubt",
      "X-API-Key",
    ],
  },
  {
    path: "docs/getting-started.md",
    requiredSections: [
      "X-API-Key",
      "USD",
      "ENGAGEMENT_PENDING",
      "DISPUTE_ACTIVE",
    ],
  },
  {
    path: "docs/architecture.md",
    requiredSections: [
      "Recent Architectural Changes",
      "atomic_generate_poi_v2",
      "trade_requests",
      "SECDEF",
    ],
  },
  {
    path: "CHANGELOG.md",
    requiredSections: [
      "USD-Native Billing Cutover",
      "SECDEF Stage D1",
      "Counterparty Rating",
      "Webhook Replay Protection",
    ],
  },
  {
    path: "docs/api-reference.md",
    requiredSections: [
      "ENGAGEMENT_PENDING",
      "DISPUTE_ACTIVE",
      "WEBHOOK_REPLAY",
      "clampSubject",
      "counterparty-intel-auto",
      "delete-account",
    ],
  },
  {
    path: "docs/webhooks.md",
    requiredSections: [
      "Replay Protection",
      "WEBHOOK_REPLAY",
      "clampSubject",
    ],
  },
  {
    path: "public/docs/end-to-end-walkthrough.md",
    requiredSections: [
      "Trade Request",
      "Engage Counterparty",
      "Evidence Strength",
      "Without a Doubt",
    ],
  },
  {
    path: "public/docs/walkthrough.html",
    requiredSections: [
      "Trade Request",
      "Engage Counterparty",
      "Without a Doubt",
      "ENGAGEMENT_PENDING",
    ],
  },
];

// --- date extraction --------------------------------------------------------

const ISO = /(\d{4})-(\d{2})-(\d{2})/;
const MONTH_NAMES = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6,
  aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const LONG = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;

function extractDates(text) {
  const dates = [];
  // Look only in the first ~3KB to avoid matching example timestamps deep in the doc.
  const head = text.slice(0, 3000);
  const markerLines = head
    .split(/\r?\n/)
    .filter((l) => /last\s+updated|^updated\s*:|^date\s*:/i.test(l));

  for (const line of markerLines) {
    let m = line.match(ISO);
    if (m) {
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
      if (!isNaN(d)) dates.push(d);
      continue;
    }
    m = line.match(LONG);
    if (m) {
      const month = MONTH_NAMES[m[2].toLowerCase()];
      if (month != null) {
        const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
        if (!isNaN(d)) dates.push(d);
      }
    }
  }
  return dates;
}

// --- main -------------------------------------------------------------------

const errors = [];
const warnings = [];
const now = Date.now();
const MS_PER_DAY = 86_400_000;

for (const rule of DOC_RULES) {
  const abs = resolve(process.cwd(), rule.path);
  if (!existsSync(abs)) {
    errors.push(`MISSING FILE: ${rule.path}`);
    continue;
  }
  const text = readFileSync(abs, "utf8");

  // Section check
  const missing = rule.requiredSections.filter(
    (needle) => !text.toLowerCase().includes(needle.toLowerCase()),
  );
  if (missing.length) {
    errors.push(
      `MISSING SECTIONS in ${rule.path}:\n  - ${missing.join("\n  - ")}`,
    );
  }

  // Staleness check
  const dates = extractDates(text);
  if (dates.length === 0) {
    errors.push(
      `NO DATE MARKER in ${rule.path} — add a "Last updated: YYYY-MM-DD" line near the top.`,
    );
    continue;
  }
  const newest = new Date(Math.max(...dates.map((d) => d.getTime())));
  const ageDays = Math.floor((now - newest.getTime()) / MS_PER_DAY);
  if (ageDays > MAX_AGE_DAYS) {
    errors.push(
      `STALE: ${rule.path} — last updated ${ageDays} days ago (${newest.toISOString().slice(0, 10)}); max allowed = ${MAX_AGE_DAYS}.`,
    );
  } else if (ageDays > MAX_AGE_DAYS * 0.75) {
    warnings.push(
      `[warn] ${rule.path} — ${ageDays} days old, approaching ${MAX_AGE_DAYS}-day limit.`,
    );
  }
}

const scanned = DOC_RULES.length;

if (warnings.length) {
  for (const w of warnings) console.warn(w);
}

if (errors.length) {
  console.error(`\n[check-docs-staleness] FAILED — ${errors.length} issue(s) across ${scanned} file(s):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    `\nFix: refresh the "Last updated" line and re-add any missing sections, or adjust DOC_RULES in scripts/check-docs-staleness.mjs if the requirement has genuinely changed.`,
  );
  process.exit(1);
}

console.log(
  `[check-docs-staleness] OK — scanned ${scanned} doc(s); all fresh (≤${MAX_AGE_DAYS} days) and contain required sections.`,
);
