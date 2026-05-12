#!/usr/bin/env node
// Automated red-team QA for the Release Checkpoint Client Acceptance Pack.
// Steps:
//   1. Re-generate the DOCX via scripts/build-release-pack.cjs
//   2. Run the structural validator (scripts/validate-release-pack-docx.mjs)
//   3. Extract text via pandoc and independently re-check:
//        - the seven client tests are all present, in order, with their headings
//        - the CSV column headers are exactly the seven safe columns, in order
//        - none of the do-not-include fields appear in the CSV header line
//        - banned phrases ("Lovable", "in plain English") are absent
//   4. Print a concise changes/evidence report and exit non-zero on any failure.
//
// Run: node scripts/qa-release-pack.mjs [path/to/output.docx]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(
  process.argv[2] ||
    "/mnt/documents/Izenzo_Release_Checkpoint_Client_Acceptance_Pack_REVISED.docx",
);
const BUILD = resolve("scripts/build-release-pack.cjs");
const VALIDATOR = resolve("scripts/validate-release-pack-docx.mjs");

const EXPECTED_TESTS = [
  "Test 1 — Open the Outreach Blocks panel",
  "Test 2 — Apply filters",
  "Test 3 — Empty state",
  "Test 4 — Large-export warning",
  "Test 5 — CSV export",
  "Test 6 — Last refreshed and auto-refresh",
  "Test 7 — Notification safety check",
];

const EXPECTED_CSV_COLUMNS = [
  "Created At",
  "Reason",
  "Action",
  "Organisation Name",
  "Organisation ID",
  "Engagement ID",
  "Surface",
];

const FORBIDDEN_IN_CSV_HEADER = [
  "counterparty email",
  "counterparty name",
  "dispute reason",
  "candidate organisations",
  "binding candidates",
  "commercial terms",
  "price",
  "quantity",
  "administrator notes",
  "support notes",
];

const BANNED_PHRASES = ["Lovable", "in plain English"];

const evidence = [];
const failures = [];
const ok = (label, detail) => evidence.push({ status: "PASS", label, detail });
const fail = (label, detail) => {
  evidence.push({ status: "FAIL", label, detail });
  failures.push(`${label}: ${detail}`);
};

// ---- Step 1: rebuild ----------------------------------------------------
let buildOut = "";
try {
  buildOut = execFileSync("node", [BUILD], { encoding: "utf8" });
  ok("Rebuild DOCX", buildOut.trim().split("\n").pop());
} catch (e) {
  fail("Rebuild DOCX", e.message);
}
if (!existsSync(OUT)) {
  fail("DOCX exists", `missing: ${OUT}`);
  report();
  process.exit(1);
}

// ---- Step 2: structural validator ---------------------------------------
{
  const r = spawnSync("node", [VALIDATOR, OUT], { encoding: "utf8" });
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | ");
  if (r.status === 0) ok("Structural validator", tail);
  else fail("Structural validator", `exit ${r.status} — ${tail}`);
}

// ---- Step 3: pandoc text extract & semantic checks ----------------------
const tmp = mkdtempSync(join(tmpdir(), "qa-pack-"));
const txtPath = join(tmp, "pack.txt");
let text = "";
try {
  execFileSync("pandoc", [OUT, "-t", "plain", "-o", txtPath]);
  const raw = readFileSync(txtPath, "utf8");
  // pandoc plain output hard-wraps at ~72 chars; flatten whitespace for regex
  text = raw.replace(/\s+/g, " ");
  ok("Pandoc text extract", `${raw.length} chars (flattened ${text.length})`);
} catch (e) {
  fail("Pandoc text extract", e.message);
  report();
  process.exit(1);
}

// 3a: seven tests present, in order
{
  let cursor = 0;
  let allFound = true;
  const positions = [];
  for (const t of EXPECTED_TESTS) {
    const i = text.indexOf(t, cursor);
    if (i === -1) {
      fail("Seven client tests", `missing or out of order: "${t}"`);
      allFound = false;
      break;
    }
    positions.push(i);
    cursor = i + t.length;
  }
  if (allFound)
    ok(
      "Seven client tests",
      `all 7 headings present in order (offsets ${positions[0]}…${positions[6]})`,
    );
}

// 3b: CSV header line contains exactly the seven safe columns, in order
{
  // The DOCX phrases the row as: "exactly these columns, in this order: A, B, C, ..."
  const m = text.match(
    /exactly these columns,?\s*in this order:\s*([^\n.]+?)(?:\.|\n)/i,
  );
  if (!m) {
    fail("CSV column headers", "could not locate 'exactly these columns, in this order:' line");
  } else {
    const raw = m[1].trim().replace(/\s+/g, " ");
    const cols = raw
      .split(/,\s*|\s+and\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const matchExact =
      cols.length === EXPECTED_CSV_COLUMNS.length &&
      cols.every((c, i) => c === EXPECTED_CSV_COLUMNS[i]);
    if (matchExact) {
      ok("CSV column headers", `7 columns verbatim & in order: ${cols.join(" | ")}`);
    } else {
      fail(
        "CSV column headers",
        `expected [${EXPECTED_CSV_COLUMNS.join(", ")}] got [${cols.join(", ")}]`,
      );
    }
    // 3c: forbidden fields must NOT appear in this header line
    const lower = raw.toLowerCase();
    const leaked = FORBIDDEN_IN_CSV_HEADER.filter((f) => lower.includes(f));
    if (leaked.length === 0)
      ok("CSV header leak check", `none of ${FORBIDDEN_IN_CSV_HEADER.length} forbidden fields present`);
    else fail("CSV header leak check", `forbidden in header: ${leaked.join(", ")}`);
  }
}

// 3d: banned phrases
{
  const hits = BANNED_PHRASES.filter((p) =>
    new RegExp(`\\b${p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(
      text,
    ),
  );
  if (hits.length === 0) ok("Banned phrases", "none found");
  else fail("Banned phrases", `present: ${hits.join(", ")}`);
}

// 3e: D/E framing sanity (mirrors validator but stated as evidence)
{
  const dHeading = /Batch D\s*[—-]\s*Pending Engagement notifications and safety logic/.test(
    text,
  );
  const eHeading = /Batch E\s*[—-]\s*Outreach-blocked audit, in-product visibility, and server response hardening/.test(
    text,
  );
  if (dHeading && eHeading)
    ok("Batch D/E framing", "headings match SSOT (D=notifications & safety, E=audit & hardening)");
  else
    fail(
      "Batch D/E framing",
      `D heading ok=${dHeading}, E heading ok=${eHeading}`,
    );
}

// ---- Report -------------------------------------------------------------
function report() {
  const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
  console.log("\n=== Red-team QA: Release Checkpoint Pack ===");
  console.log("Target:", OUT);
  console.log("");
  for (const e of evidence) {
    console.log(`[${e.status}] ${pad(e.label, 28)} ${e.detail}`);
  }
  console.log("");
  if (failures.length === 0) {
    console.log(`RESULT: PASS — ${evidence.length} checks, 0 failures`);
  } else {
    console.log(
      `RESULT: FAIL — ${failures.length}/${evidence.length} failures`,
    );
    for (const f of failures) console.log("  - " + f);
  }
  // Persist a machine-readable summary alongside the DOCX
  const sidecar = OUT.replace(/\.docx$/, ".qa.json");
  writeFileSync(
    sidecar,
    JSON.stringify(
      { target: OUT, ranAt: new Date().toISOString(), evidence, failures },
      null,
      2,
    ),
  );
  console.log("Evidence sidecar:", sidecar);
}

report();
process.exit(failures.length === 0 ? 0 : 1);
