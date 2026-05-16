#!/usr/bin/env node
/**
 * Batch W — AUD-020. Generates a dated closeout snapshot artefact at
 * docs/closeout/YYYY-MM-DD-closeout-snapshot.md by calling
 * public.closeout_drift_summary() on the configured Supabase project.
 *
 * Env required for live evidence:
 *   - VITE_SUPABASE_URL (or SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY (preferred) OR VITE_SUPABASE_PUBLISHABLE_KEY
 *
 * If env is absent the script exits 0 with a clear "skipped" message
 * (unless --strict is passed, in which case it exits 1).
 *
 * The artefact body is explicit that the snapshot is live-environment
 * evidence ONLY when this script was run against the live DB.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STRICT = process.argv.includes("--strict");
const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "";

if (!url || !key) {
  const msg =
    "skipped: missing DB env (set VITE_SUPABASE_URL and a SUPABASE key to produce a live snapshot).";
  if (STRICT) {
    console.error("❌ closeout-snapshot " + msg);
    process.exit(1);
  }
  console.log("ℹ closeout-snapshot " + msg);
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const outDir = "docs/closeout";
const outPath = join(outDir, `${today}-closeout-snapshot.md`);
mkdirSync(outDir, { recursive: true });

let summary = null;
let queryError = null;
try {
  const res = await fetch(`${url}/rest/v1/rpc/closeout_drift_summary`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    queryError = `RPC returned ${res.status}: ${await res.text()}`;
  } else {
    summary = await res.json();
  }
} catch (e) {
  queryError = String(e?.message ?? e);
}

const rows = Array.isArray(summary) ? summary : summary ? [summary] : [];
let criticalCount = 0;
const byKindSeverity = new Map();
for (const r of rows) {
  const kind = r.kind ?? r.drift_kind ?? "unknown";
  const sev = (r.severity ?? "unknown").toLowerCase();
  const cnt = Number(r.count ?? r.open_count ?? 0);
  if (sev === "critical") criticalCount += cnt;
  const k = `${kind} / ${sev}`;
  byKindSeverity.set(k, (byKindSeverity.get(k) ?? 0) + cnt);
}

const lines = [];
lines.push(`# Closeout Snapshot — ${today}`);
lines.push("");
lines.push(`- **generated_at**: ${new Date().toISOString()}`);
lines.push(`- **source**: \`public.closeout_drift_summary()\``);
lines.push(`- **db_url**: ${url}`);
lines.push("");
lines.push(
  "> This artefact is live-environment evidence **only when this script was run against the live database**. Verify the `db_url` above matches the live tier before using this as launch evidence.",
);
lines.push("");
if (queryError) {
  lines.push("## Query status: FAILED");
  lines.push("");
  lines.push("```");
  lines.push(queryError);
  lines.push("```");
  lines.push("");
  lines.push(
    "**Do not treat this snapshot as evidence of zero drift.** Investigate the RPC failure before go-live.",
  );
} else {
  lines.push(`## Open critical drift: **${criticalCount}**`);
  lines.push("");
  lines.push("## Open risk counts by kind / severity");
  lines.push("");
  if (byKindSeverity.size === 0) {
    lines.push("_No open drift reported._");
  } else {
    lines.push("| kind / severity | count |");
    lines.push("|---|---|");
    for (const [k, v] of [...byKindSeverity.entries()].sort()) {
      lines.push(`| ${k} | ${v} |`);
    }
  }
}
lines.push("");

writeFileSync(outPath, lines.join("\n"));
console.log(`✓ closeout snapshot written: ${outPath}`);
if (queryError) process.exit(2);
