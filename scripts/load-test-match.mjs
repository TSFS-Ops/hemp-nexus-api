/**
 * k6 Load Test — Match Endpoint
 *
 * Tests the POST /match endpoint under load with idempotency enforcement.
 *
 * Prerequisites:
 *   - k6 installed (https://k6.io)
 *   - Valid API key set as K6_API_KEY environment variable
 *   - Base URL set as K6_BASE_URL (default: https://api.trade.izenzo.co.za/functions/v1)
 *
 * Usage:
 *   # Smoke test (10 VUs, 30s)
 *   k6 run scripts/load-test-match.mjs
 *
 *   # Stress test (100 VUs, 5m)
 *   k6 run --vus 100 --duration 5m scripts/load-test-match.mjs
 *
 *   # 1M RPS test (requires distributed k6 cloud or multiple machines)
 *   k6 run --vus 10000 --duration 60s scripts/load-test-match.mjs
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// ─── Configuration ──────────────────────────────────────────────────

const BASE_URL = __ENV.K6_BASE_URL || "https://api.trade.izenzo.co.za/functions/v1";
const API_KEY = __ENV.K6_API_KEY;

if (!API_KEY) {
  throw new Error("K6_API_KEY environment variable is required");
}

export const options = {
  stages: [
    { duration: "10s", target: 10 },   // warm up
    { duration: "30s", target: 50 },   // ramp to 50 VUs
    { duration: "1m", target: 50 },    // hold
    { duration: "10s", target: 0 },    // cool down
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"], // P95 < 2s
    http_req_failed: ["rate<0.05"],     // Error rate < 5%
    match_created: ["count>0"],
    idempotent_replays: ["count>0"],
  },
};

// ─── Custom Metrics ─────────────────────────────────────────────────

const matchCreated = new Counter("match_created");
const idempotentReplays = new Counter("idempotent_replays");
const matchDuration = new Trend("match_duration", true);
const errorRate = new Rate("match_errors");

// ─── Helpers ────────────────────────────────────────────────────────

function makeHeaders(idempotencyKey) {
  return {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

function makePayload(vuId) {
  return JSON.stringify({
    buyer: { id: `load-buyer-${vuId}`, name: `Load Buyer ${vuId}` },
    seller: { id: `load-seller-${vuId}`, name: `Load Seller ${vuId}` },
    commodity: "Steel Coils",
    quantity: { amount: Math.floor(Math.random() * 1000) + 1, unit: "MT" },
    price: { amount: Math.floor(Math.random() * 100000) + 1000, currency: "USD" },
    terms: `Load test term — VU ${vuId}`,
    metadata: { source: "k6-load-test", vu: vuId },
  });
}

// ─── Test Scenarios ─────────────────────────────────────────────────

export default function () {
  const vuId = __VU;

  // Scenario 1: Create a new match
  const idempotencyKey = `k6_${uuidv4()}`;
  const payload = makePayload(vuId);

  const createRes = http.post(`${BASE_URL}/match`, payload, {
    headers: makeHeaders(idempotencyKey),
    tags: { scenario: "create_match" },
  });

  matchDuration.add(createRes.timings.duration);

  const createOk = check(createRes, {
    "create: status is 200 or 201": (r) => r.status === 200 || r.status === 201,
    "create: has match id": (r) => {
      try { return !!JSON.parse(r.body).id; } catch { return false; }
    },
    "create: has hash": (r) => {
      try { return !!JSON.parse(r.body).hash; } catch { return false; }
    },
  });

  if (createOk) {
    matchCreated.add(1);
    errorRate.add(false);
  } else {
    errorRate.add(true);
  }

  sleep(0.1);

  // Scenario 2: Replay same idempotency key (should return cached)
  const replayRes = http.post(`${BASE_URL}/match`, payload, {
    headers: makeHeaders(idempotencyKey),
    tags: { scenario: "idempotent_replay" },
  });

  const replayOk = check(replayRes, {
    "replay: status is 200": (r) => r.status === 200,
    "replay: has X-Idempotent-Replay header": (r) =>
      r.headers["X-Idempotent-Replay"] === "true",
  });

  if (replayOk) {
    idempotentReplays.add(1);
  }

  sleep(0.1);

  // Scenario 3: Missing idempotency key (should be rejected)
  const noKeyRes = http.post(`${BASE_URL}/match`, payload, {
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    tags: { scenario: "missing_idempotency" },
  });

  check(noKeyRes, {
    "no-key: rejected with 400": (r) => r.status === 400,
    "no-key: error mentions Idempotency-Key": (r) => {
      try { return JSON.parse(r.body).message?.includes("Idempotency-Key"); } catch { return false; }
    },
  });

  sleep(Math.random() * 0.5);
}

// ─── Summary ────────────────────────────────────────────────────────

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state?.testRunDurationMs,
    vus_max: data.metrics?.vus_max?.values?.value,
    iterations: data.metrics?.iterations?.values?.count,
    http_reqs: data.metrics?.http_reqs?.values?.count,
    http_req_duration_p95: data.metrics?.http_req_duration?.values?.["p(95)"],
    http_req_duration_avg: data.metrics?.http_req_duration?.values?.avg,
    http_req_failed_rate: data.metrics?.http_req_failed?.values?.rate,
    matches_created: data.metrics?.match_created?.values?.count,
    idempotent_replays: data.metrics?.idempotent_replays?.values?.count,
    match_error_rate: data.metrics?.match_errors?.values?.rate,
  };

  return {
    stdout: `\n════ Load Test Summary ════\n${JSON.stringify(summary, null, 2)}\n`,
    "scripts/load-test-results.json": JSON.stringify(summary, null, 2),
  };
}
