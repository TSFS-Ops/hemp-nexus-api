#!/usr/bin/env node
/**
 * Validates a generated client release-pack DOCX against the
 * source-of-truth batch framing.
 *
 * Usage:
 *   node scripts/validate-release-pack-docx.mjs <path-to-docx>
 *
 * Exits non-zero if any check fails. Prints a structured report.
 *
 * Checks:
 *   1. Each Batch heading begins with the SSOT title prefix.
 *   2. Batch D / Batch E framing is not swapped (the most common drift).
 *   3. Downstream "introduced in Batch X" references point to the SSOT
 *      origin batch.
 *   4. Banned phrases ("Lovable", "in plain English") are absent.
 *   5. The CSV column list and the do-not-include field list are present
 *      verbatim.
 *   6. Numbered lists render as proper sequential numbering (no
 *      "1. 1. 1." restarts caused by each item having its own numId).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// ------- Source of truth -------
// Keep this in sync with the human history of the batches.
const BATCH_SSOT = {
  D: {
    titlePrefix: "Pending Engagement notifications and safety logic",
    mustMention: ["recipient", "initiator"],
    mustNotMention: ["first-class audit signal", "stale audit signal"],
  },
  E: {
    titlePrefix: "Outreach-blocked audit",
    mustMention: ["outreach-blocked", "safe"],
    mustNotMention: ["stale audit signal", "Retiring"],
  },
  F: {
    titlePrefix: "Production hardening, coverage, and proof consolidation",
    mustMention: ["coverage"],
    mustNotMention: ["Pending Engagement screen returns"],
  },
  K: {
    titlePrefix: "Outreach Blocks admin panel and CSV export",
    mustMention: ["panel", "CSV"],
    mustNotMention: [],
  },
  L: {
    titlePrefix: "Export clarity",
    mustMention: ["empty-state", "500-row"],
    mustNotMention: [],
  },
  M: {
    titlePrefix: "Precise total count, last-refreshed time, and optional auto-refresh",
    mustMention: ["last refreshed", "auto-refresh"],
    mustNotMention: [],
  },
};

// "Operational record introduced in Batch X" must point to E (the
// outreach-blocked audit), never D.
const DOWNSTREAM_REFERENCES = [
  {
    label: 'operational record origin',
    pattern: /operational record introduced in Batch ([A-Z])/i,
    expected: "E",
  },
  {
    label: 'safe-field tightening origin',
    pattern: /safe-field tightening described under Batch ([A-Z])/i,
    expected: "E",
  },
  {
    label: 'response-hardening origin',
    pattern: /response-hardening from Batch ([A-Z])/i,
    expected: "E",
  },
];

const BANNED_PHRASES = [
  { phrase: "Lovable", caseSensitive: false },
  { phrase: "in plain English", caseSensitive: false },
];

const REQUIRED_CSV_COLUMNS = [
  "Created At", "Reason", "Action",
  "Organisation Name", "Organisation ID", "Engagement ID", "Surface",
];

const REQUIRED_EXCLUDED_FIELDS = [
  "Counterparty email", "Counterparty name", "Dispute reason",
  "Candidate organisations", "Binding candidates", "Commercial terms",
  "Price", "Quantity", "Administrator notes", "Support notes",
];

// ------- Extraction -------
function extractText(docxPath) {
  const xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"]).toString("utf8");
  // Convert <w:p> boundaries into newlines, strip all other tags.
  const withBreaks = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t");
  const text = withBreaks
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
  return text;
}

// ------- Checks -------
function checkBatchHeadings(text) {
  const failures = [];
  // Match lines beginning with "Batch X — <title>"
  const re = /^Batch ([A-Z])\s+[—-]\s+(.+)$/gm;
  const found = {};
  for (const m of text.matchAll(re)) {
    found[m[1]] = m[2].trim();
  }
  for (const [letter, ssot] of Object.entries(BATCH_SSOT)) {
    const title = found[letter];
    if (!title) {
      failures.push(`Missing heading for Batch ${letter}.`);
      continue;
    }
    if (!title.toLowerCase().startsWith(ssot.titlePrefix.toLowerCase())) {
      failures.push(
        `Batch ${letter} heading mismatch.\n    expected to start with: "${ssot.titlePrefix}"\n    actual: "${title}"`,
      );
    }
    // Per-batch body slice (from this heading to the next "Batch X —" or EOF).
    const slice = sliceBatch(text, letter);
    for (const term of ssot.mustMention) {
      if (!slice.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`Batch ${letter} body is missing required term "${term}".`);
      }
    }
    for (const term of ssot.mustNotMention) {
      if (slice.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`Batch ${letter} body contains forbidden term "${term}" (drift).`);
      }
    }
  }
  return failures;
}

function sliceBatch(text, letter) {
  const start = text.search(new RegExp(`^Batch ${letter}\\s+[—-]`, "m"));
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/^Batch [A-Z]\s+[—-]/m);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

function checkDownstreamRefs(text) {
  const failures = [];
  for (const ref of DOWNSTREAM_REFERENCES) {
    const m = text.match(ref.pattern);
    if (!m) continue; // reference may legitimately be absent
    if (m[1] !== ref.expected) {
      failures.push(
        `Downstream reference "${ref.label}" points to Batch ${m[1]}; expected Batch ${ref.expected}.`,
      );
    }
  }
  return failures;
}

function checkBannedPhrases(text) {
  const failures = [];
  for (const { phrase, caseSensitive } of BANNED_PHRASES) {
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? phrase : phrase.toLowerCase();
    if (haystack.includes(needle)) {
      failures.push(`Banned phrase present: "${phrase}".`);
    }
  }
  return failures;
}

function checkRequiredLists(text) {
  const failures = [];
  for (const col of REQUIRED_CSV_COLUMNS) {
    if (!text.includes(col)) failures.push(`Missing required CSV column: "${col}".`);
  }
  for (const f of REQUIRED_EXCLUDED_FIELDS) {
    if (!text.includes(f)) failures.push(`Missing do-not-include field: "${f}".`);
  }
  return failures;
}

// ------- Cross-check: D vs E swap -------
function checkDvsEFraming(text) {
  const dSlice = sliceBatch(text, "D").toLowerCase();
  const eSlice = sliceBatch(text, "E").toLowerCase();
  const failures = [];
  // D must be the notification/recipient batch, not the audit batch.
  if (dSlice.includes("outreach-blocked audit") || dSlice.includes("first-class audit")) {
    failures.push("Batch D appears to describe the outreach-blocked audit work — that is Batch E. Frames are swapped.");
  }
  // E must be the audit/visibility/safe-field batch, not the recipient batch.
  if (eSlice.includes("recipient rules") && !eSlice.includes("outreach-blocked")) {
    failures.push("Batch E appears to describe recipient/wording work — that is Batch D. Frames are swapped.");
  }
  return failures;
}

// ------- Numbered-list regression check -------
// Detects the docx-js failure mode where consecutive numbered paragraphs
// each get their own numId and therefore each restart at "1.", producing
// a rendered list that looks like "1. 1. 1." instead of "1. 2. 3.".
function loadXml(docxPath, member) {
  try {
    return execFileSync("unzip", ["-p", docxPath, member]).toString("utf8");
  } catch {
    return "";
  }
}

function buildNumberingMap(numberingXml) {
  const numIdToAbs = new Map();
  for (const m of numberingXml.matchAll(
    /<w:num\s+w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g,
  )) {
    const abs = m[2].match(/<w:abstractNumId\s+w:val="(\d+)"/);
    if (abs) numIdToAbs.set(m[1], abs[1]);
  }
  const absToLevels = new Map();
  for (const m of numberingXml.matchAll(
    /<w:abstractNum\s+w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  )) {
    const levels = new Map();
    for (const lv of m[2].matchAll(
      /<w:lvl\s+w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g,
    )) {
      const fmt = lv[2].match(/<w:numFmt\s+w:val="([^"]+)"/);
      levels.set(lv[1], fmt ? fmt[1] : "decimal");
    }
    absToLevels.set(m[1], levels);
  }
  return { numIdToAbs, absToLevels };
}

function checkNumberedListRestarts(docxPath) {
  const failures = [];
  const documentXml = loadXml(docxPath, "word/document.xml");
  const numberingXml = loadXml(docxPath, "word/numbering.xml");
  if (!documentXml) return failures;

  const { numIdToAbs, absToLevels } = numberingXml
    ? buildNumberingMap(numberingXml)
    : { numIdToAbs: new Map(), absToLevels: new Map() };

  // Per-paragraph (numId, ilvl, fmt) or null if not a list item.
  const items = [];
  for (const p of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const numPr = p[1].match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
    if (!numPr) { items.push(null); continue; }
    const numId = numPr[1].match(/<w:numId\s+w:val="(\d+)"/);
    if (!numId) { items.push(null); continue; }
    const ilvl = numPr[1].match(/<w:ilvl\s+w:val="(\d+)"/);
    const id = numId[1];
    const lvl = ilvl ? ilvl[1] : "0";
    const abs = numIdToAbs.get(id);
    const fmt = abs ? absToLevels.get(abs)?.get(lvl) ?? "decimal" : "decimal";
    items.push({ id, lvl, fmt });
  }

  // Scan runs of consecutive numbered items at the same level.
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (!it || it.fmt === "bullet") { i += 1; continue; }
    let j = i;
    const idsSeen = new Set();
    while (
      j < items.length && items[j] &&
      items[j].fmt === it.fmt && items[j].lvl === it.lvl
    ) {
      idsSeen.add(items[j].id);
      j += 1;
    }
    if (j - i >= 2 && idsSeen.size > 1) {
      failures.push(
        `Numbered list starting at paragraph ${i} has ${j - i} consecutive items spread across ${idsSeen.size} distinct numIds (${[...idsSeen].join(", ")}). Each numId restarts at 1, so the list will render as "1. 1. ..." instead of sequential numbers. Use a single numbering reference for the run, or switch to bullets.`,
      );
    }
    i = j;
  }
  return failures;
}

// ------- Runner -------
function main() {
  const docxPath = process.argv[2];
  if (!docxPath) {
    console.error("Usage: node scripts/validate-release-pack-docx.mjs <path-to-docx>");
    process.exit(2);
  }
  if (!existsSync(docxPath)) {
    console.error(`File not found: ${docxPath}`);
    process.exit(2);
  }

  const text = extractText(docxPath);

  const groups = [
    ["Batch headings & body framing", checkBatchHeadings(text)],
    ["Batch D vs Batch E swap guard", checkDvsEFraming(text)],
    ["Downstream cross-references", checkDownstreamRefs(text)],
    ["Banned phrases", checkBannedPhrases(text)],
    ["Required column / excluded-field lists", checkRequiredLists(text)],
    ["Numbered-list rendering (no '1. 1. 1.' restarts)", checkNumberedListRestarts(docxPath)],
  ];

  let total = 0;
  for (const [label, failures] of groups) {
    if (failures.length === 0) {
      console.log(`PASS  ${label}`);
    } else {
      total += failures.length;
      console.log(`FAIL  ${label}`);
      for (const f of failures) console.log(`      - ${f}`);
    }
  }

  if (total === 0) {
    console.log(`\nAll checks passed for ${docxPath}.`);
    process.exit(0);
  }
  console.log(`\n${total} check(s) failed for ${docxPath}.`);
  process.exit(1);
}

main();
