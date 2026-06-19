/**
 * Role-Negative evidence fixture.
 *
 * Wraps the base Playwright `test` with a per-test evidence row that
 * matches §11 of the build brief. Writes JSONL under
 * /test-evidence/role-negative-e2e/<run_id>/<row-slug>/ plus a
 * `summary.json` and a network/response capture for the protected-data
 * scan helpers.
 *
 * NEVER captures: request bodies, Authorization headers, raw documents.
 */
import { test as base, expect, type TestInfo } from "@playwright/test";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

const RUN_ID = process.env.E2E_RN_RUN_ID
  ?? `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${process.pid}`;
const ROOT = `test-evidence/role-negative-e2e/${RUN_ID}`;

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function scrub(s: string): string {
  return s
    .replace(/sk_[A-Za-z0-9_-]{6,}/g, "sk_***")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g, "<jwt>")
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer <redacted>")
    .replace(/"password"\s*:\s*"[^"]+"/g, '"password":"<redacted>"');
}

export type EvidenceRow = {
  run_id: string;
  test_suite: string;
  test_name: string;
  test_type: "positive_path" | "role_negative" | "wrong_tenant" | "logged_out" | "direct_link" | "direct_backend";
  role_used: string;
  organisation_used: string;
  route_or_action_tested: string;
  record_type?: string;
  seeded_record_reference?: string;
  expected_result: string;
  actual_result?: string;
  pass_fail_status?: "pass" | "fail" | "skipped";
  failure_reason?: string;
  environment: string;
  browser: string;
  date_time: string;
  build_id?: string;
  before_state?: unknown;
  after_state?: unknown;
  screenshot_or_trace_path?: string;
  notes?: string;
};

export type EvidenceCtx = {
  set: (partial: Partial<EvidenceRow>) => void;
  /** Mutable buffer of response bodies — used by expectNoProtectedDataInNetwork. */
  networkBodies: string[];
  dir: string;
  runId: string;
};

export const test = base.extend<{ ev: EvidenceCtx }>({
  ev: async ({ page }, use, testInfo: TestInfo) => {
    const dir = join(ROOT, slug(`${testInfo.titlePath.slice(-2).join("-")}`));
    await mkdir(dir, { recursive: true });
    const networkBodies: string[] = [];
    let row: Partial<EvidenceRow> = {
      run_id: RUN_ID,
      test_suite: testInfo.titlePath[0] ?? "role-negative-e2e",
      test_name: testInfo.title,
      test_type: "role_negative",
      role_used: "unknown",
      organisation_used: "unknown",
      route_or_action_tested: "unknown",
      expected_result: "unknown",
      environment: process.env.E2E_RN_ENV ?? "unknown",
      browser: testInfo.project.name,
      date_time: new Date().toISOString(),
      build_id: process.env.E2E_RN_BUILD_ID ?? process.env.GITHUB_SHA,
    };

    page.on("response", async (res) => {
      try {
        const ct = res.headers()["content-type"] ?? "";
        if (ct.includes("application/json") || ct.includes("text/")) {
          const text = await res.text();
          if (text.length < 200_000) networkBodies.push(scrub(text));
        }
      } catch { /* best-effort */ }
    });

    const set: EvidenceCtx["set"] = (p) => { row = { ...row, ...p }; };

    try {
      await use({ set, networkBodies, dir, runId: RUN_ID });
    } finally {
      try {
        const buf = await page.screenshot({ fullPage: true }).catch(() => null);
        if (buf) {
          const file = join(dir, "final.png");
          await writeFile(file, buf);
          row.screenshot_or_trace_path = file;
        }
      } catch { /* best-effort */ }
      row.actual_result = row.actual_result ?? (testInfo.status === "passed" ? "as_expected" : "deviation");
      row.pass_fail_status = testInfo.status === "passed" ? "pass" : testInfo.status === "skipped" ? "skipped" : "fail";
      row.failure_reason = testInfo.error?.message;
      await writeFile(join(dir, "summary.json"), JSON.stringify(row, null, 2)).catch(() => {});
      await appendFile(join(ROOT, "evidence.jsonl"), JSON.stringify(row) + "\n").catch(() => {});
    }
  },
});

export { expect, RUN_ID, ROOT };
