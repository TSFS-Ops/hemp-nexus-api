/**
 * Per-test evidence capture fixture.
 *
 * Bundles, per smoke row (A/B/C/D):
 *   - milestone screenshots (call `ev.snapshot('label')` at key points;
 *     a final one is auto-captured on teardown including failures)
 *   - full console log stream (level, text, location)
 *   - network trace with x-request-id / x-trace-id / sb-request-id
 *     headers from every response (the values Daniel's approval step
 *     needs to follow a failure end-to-end through edge-function logs)
 *   - a summary.json with status, duration, error message + stack
 *
 * Output layout:
 *
 *   evidence/
 *     <row-slug>/
 *       summary.json
 *       console.log
 *       requests.jsonl
 *       01-<label>.png
 *       02-<label>.png
 *       ...
 *
 * Run `node scripts/pack-evidence.mjs` after the suite to fold this
 * plus the playwright-report HTML into a single dated zip under
 * /mnt/documents/ for the approver to download.
 *
 * Privacy:
 *   - Request bodies are NOT captured (could contain PII or the TOTP
 *     code). Only method, url, status, duration, and a small allowlist
 *     of response trace headers.
 *   - Authorization / Cookie / apikey headers are never recorded.
 */
import { test as base, expect, type TestInfo } from "@playwright/test";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

const TRACE_HEADERS = new Set([
  "x-request-id",
  "x-trace-id",
  "sb-request-id",
  "cf-ray",
]);

export type Evidence = {
  /** Take a labelled screenshot. Auto-numbered in capture order. */
  snapshot: (label: string) => Promise<void>;
  /** Directory the row's artefacts are being written to. */
  dir: string;
};

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export const test = base.extend<{ ev: Evidence }>({
  ev: async ({ page }, use, testInfo: TestInfo) => {
    const rowSlug = slug(`${testInfo.titlePath.slice(-2).join(" ")}`);
    const dir = join(testInfo.project.outputDir ?? "test-results", "..", "evidence", rowSlug);
    await mkdir(dir, { recursive: true });

    let shotN = 0;
    const consoleFile = join(dir, "console.log");
    const requestsFile = join(dir, "requests.jsonl");
    const requestIds: string[] = [];

    page.on("console", (msg) => {
      const loc = msg.location();
      const line = JSON.stringify({
        t: new Date().toISOString(),
        level: msg.type(),
        text: msg.text(),
        url: loc.url,
        line: loc.lineNumber,
      }) + "\n";
      appendFile(consoleFile, line).catch(() => { /* fixture best-effort */ });
    });
    page.on("pageerror", (err) => {
      appendFile(consoleFile, JSON.stringify({
        t: new Date().toISOString(),
        level: "pageerror",
        text: err.message,
        stack: err.stack,
      }) + "\n").catch(() => { /* fixture best-effort */ });
    });

    page.on("response", (res) => {
      try {
        const headers = res.headers();
        const trace: Record<string, string> = {};
        for (const h of TRACE_HEADERS) if (headers[h]) trace[h] = headers[h];
        const rid = trace["x-request-id"] ?? trace["sb-request-id"];
        if (rid) requestIds.push(rid);
        const line = JSON.stringify({
          t: new Date().toISOString(),
          method: res.request().method(),
          url: res.url(),
          status: res.status(),
          trace,
        }) + "\n";
        appendFile(requestsFile, line).catch(() => { /* best-effort */ });
      } catch { /* ignore — evidence is best-effort */ }
    });

    const snapshot: Evidence["snapshot"] = async (label) => {
      shotN += 1;
      const name = `${String(shotN).padStart(2, "0")}-${slug(label)}.png`;
      try {
        const buf = await page.screenshot({ fullPage: true });
        await writeFile(join(dir, name), buf);
        await testInfo.attach(name, { body: buf, contentType: "image/png" });
      } catch { /* never fail a test because evidence capture failed */ }
    };

    const started = Date.now();
    try {
      await use({ snapshot, dir });
    } finally {
      // Auto final snapshot — captures pass AND fail states.
      await snapshot(testInfo.status === "passed" ? "final-pass" : "final-fail");
      const summary = {
        row: testInfo.title,
        suite: testInfo.titlePath[0],
        status: testInfo.status,
        expected: testInfo.expectedStatus,
        durationMs: Date.now() - started,
        retry: testInfo.retry,
        error: testInfo.error ? {
          message: testInfo.error.message,
          stack: testInfo.error.stack,
        } : null,
        requestIds: Array.from(new Set(requestIds)).slice(0, 200),
        capturedAt: new Date().toISOString(),
      };
      await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2)).catch(() => { /* best-effort */ });
    }
  },
});

export { expect };
