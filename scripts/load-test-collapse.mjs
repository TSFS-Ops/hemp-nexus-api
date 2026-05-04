/**
 * k6 Load Test — Collapse (Deal Sealing) Endpoint
 *
 * Tests the critical collapse/deal-sealing path under load.
 * This is the highest-integrity path in the platform.
 *
 * Prerequisites:
 *   - k6 installed (https://k6.io)
 *   - Valid API key: K6_API_KEY
 *   - Pre-created match IDs: K6_MATCH_IDS (comma-separated)
 *   - Base URL: K6_BASE_URL (default: https://api.trade.izenzo.co.za/functions/v1)
 *
 * Usage:
 *   K6_API_KEY=sk_... K6_MATCH_IDS=id1,id2,id3 k6 run scripts/load-test-collapse.mjs
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.K6_BASE_URL || "https://api.trade.izenzo.co.za/functions/v1";
const API_KEY = __ENV.K6_API_KEY;
const MATCH_IDS = (__ENV.K6_MATCH_IDS || "").split(",").filter(Boolean);

if (!API_KEY) throw new Error("K6_API_KEY is required");
if (MATCH_IDS.length === 0) throw new Error("K6_MATCH_IDS is required (comma-separated match UUIDs)");

export const options = {
  stages: [
    { duration: "5s", target: 5 },
    { duration: "20s", target: 20 },
    { duration: "30s", target: 20 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    collapse_errors: ["rate<0.10"],
  },
};

const collapseDuration = new Trend("collapse_duration", true);
const collapseErrors = new Rate("collapse_errors");
const stateConflicts = new Counter("state_conflicts");

export default function () {
  const matchId = MATCH_IDS[__VU % MATCH_IDS.length];
  const idempotencyKey = `k6_collapse_${uuidv4()}`;

  // Attempt to settle/confirm the match
  const res = http.post(`${BASE_URL}/match/${matchId}/settle`, null, {
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    tags: { scenario: "collapse" },
  });

  collapseDuration.add(res.timings.duration);

  const ok = check(res, {
    "collapse: status is 2xx or state_conflict": (r) => {
      if (r.status >= 200 && r.status < 300) return true;
      // State conflicts are expected under concurrent load
      try {
        const body = JSON.parse(r.body);
        return body.code === "STATE_CONFLICT" || body.error === "STATE_CONFLICT";
      } catch {
        return false;
      }
    },
  });

  if (!ok) {
    collapseErrors.add(true);
  } else {
    collapseErrors.add(false);
    // Track state conflicts separately (expected, not errors)
    try {
      const body = JSON.parse(res.body);
      if (body.code === "STATE_CONFLICT" || body.error === "STATE_CONFLICT") {
        stateConflicts.add(1);
      }
    } catch { /* ignore */ }
  }

  sleep(Math.random() * 0.3);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    endpoint: "collapse/settle",
    vus_max: data.metrics?.vus_max?.values?.value,
    iterations: data.metrics?.iterations?.values?.count,
    collapse_p95: data.metrics?.collapse_duration?.values?.["p(95)"],
    collapse_avg: data.metrics?.collapse_duration?.values?.avg,
    collapse_error_rate: data.metrics?.collapse_errors?.values?.rate,
    state_conflicts: data.metrics?.state_conflicts?.values?.count,
  };

  return {
    stdout: `\n════ Collapse Load Test Summary ════\n${JSON.stringify(summary, null, 2)}\n`,
    "scripts/collapse-load-test-results.json": JSON.stringify(summary, null, 2),
  };
}
