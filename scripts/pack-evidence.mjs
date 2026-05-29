#!/usr/bin/env node
/**
 * pack-evidence — bundle the latest smoke run's evidence into a single
 * dated zip under /mnt/documents/ for the approver to download.
 *
 * Includes:
 *   - evidence/   (per-row screenshots, console.log, requests.jsonl, summary.json)
 *   - playwright-report/  (Playwright HTML report)
 *   - index.html  (top-level overview linking each row's summary)
 *
 * Usage:  node scripts/pack-evidence.mjs
 *
 * No secrets are written; this only packages what the suite already
 * produced. Re-runs are idempotent (new dated file each time).
 */
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(process.cwd());
const EVIDENCE_DIR = join(ROOT, "evidence");
const REPORT_DIR = join(ROOT, "playwright-report");
const OUT_DIR = process.env.EVIDENCE_OUT_DIR ?? "/mnt/documents";

if (!existsSync(EVIDENCE_DIR)) {
  console.error("No evidence/ directory found. Run the smoke suite first.");
  process.exit(2);
}

// Block packaging if the evidence contains a leaked secret. The scanner
// itself exits non-zero on any hit and prints the offending file/line.
await new Promise((res, rej) => {
  const p = spawn("node", ["scripts/check-evidence-secret-leaks.mjs"], { stdio: "inherit", cwd: ROOT });
  p.on("exit", (code) => code === 0
    ? res(undefined)
    : rej(new Error(`Refusing to pack — evidence secret-leak scan failed (exit ${code}).`)));
});

async function buildIndex() {
  const rows = [];
  for (const name of (await readdir(EVIDENCE_DIR)).sort()) {
    const p = join(EVIDENCE_DIR, name);
    if (!(await stat(p)).isDirectory()) continue;
    let summary = null;
    try { summary = JSON.parse(await readFile(join(p, "summary.json"), "utf8")); } catch { /* missing */ }
    rows.push({ name, summary });
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Smoke A–D evidence</title>
<style>
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;color:#0F172A;max-width:880px;margin:32px auto;padding:0 16px}
  h1{font-size:18px;margin:0 0 16px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #E2E8F0;padding:8px 10px;text-align:left;font-size:13px;vertical-align:top}
  th{background:#F8FAFC;font-weight:600}
  .pass{color:#047857;font-weight:600}.fail{color:#B91C1C;font-weight:600}
  code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}
  details{margin-top:4px}
</style>
<h1>Smoke A–D evidence — ${new Date().toISOString()}</h1>
<table><thead><tr><th>Row</th><th>Status</th><th>Duration</th><th>Request IDs</th><th>Artefacts</th></tr></thead><tbody>
${rows.map(({ name, summary }) => {
  const s = summary?.status ?? "unknown";
  const cls = s === "passed" ? "pass" : "fail";
  const ids = (summary?.requestIds ?? []).slice(0, 5).map((x) => `<code>${x}</code>`).join("<br>") || "—";
  const moreIds = (summary?.requestIds?.length ?? 0) > 5
    ? `<details><summary>+${summary.requestIds.length - 5} more</summary>${summary.requestIds.slice(5).map((x) => `<code>${x}</code>`).join("<br>")}</details>` : "";
  const err = summary?.error ? `<details><summary>error</summary><pre>${(summary.error.message ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre></details>` : "";
  return `<tr>
    <td><a href="evidence/${name}/">${name}</a></td>
    <td class="${cls}">${s}</td>
    <td>${summary?.durationMs ?? "?"} ms</td>
    <td>${ids}${moreIds}</td>
    <td><a href="evidence/${name}/summary.json">summary.json</a> · <a href="evidence/${name}/console.log">console</a> · <a href="evidence/${name}/requests.jsonl">requests</a>${err}</td>
  </tr>`;
}).join("")}
</tbody></table>
<p><a href="playwright-report/index.html">Full Playwright HTML report →</a></p>`;
  await writeFile(join(EVIDENCE_DIR, "index.html"), html);
}

await buildIndex();
await mkdir(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(OUT_DIR, `smoke-a-d-evidence-${stamp}.zip`);

// Use system `zip` — preinstalled in CI/sandbox.
const args = ["-r", outFile, "evidence"];
if (existsSync(REPORT_DIR)) args.push("playwright-report");

await new Promise((res, rej) => {
  const p = spawn("zip", args, { stdio: "inherit", cwd: ROOT });
  p.on("exit", (code) => code === 0 ? res(undefined) : rej(new Error(`zip exit ${code}`)));
});

console.log(`\nEvidence bundle: ${outFile}`);
