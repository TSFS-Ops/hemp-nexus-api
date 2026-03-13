#!/usr/bin/env node
/**
 * Load Test Script — Compliance Matching Platform
 *
 * Simulates concurrent users hitting critical endpoints.
 * Usage:
 *   node scripts/load-test.mjs --url <SUPABASE_URL> --token <JWT> [--rps 50] [--duration 30]
 *
 * Endpoints tested:
 *   1. GET /functions/v1/healthz            (unauthenticated)
 *   2. GET /rest/v1/matches?select=id       (authenticated, read-heavy)
 *   3. GET /functions/v1/audit-logs          (authenticated, read-heavy)
 *   4. POST /functions/v1/search            (authenticated, write-heavy)
 */

import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    token: { type: "string" },
    key: { type: "string" },
    rps: { type: "string", default: "50" },
    duration: { type: "string", default: "30" },
    endpoint: { type: "string", default: "all" },
  },
});

const BASE_URL = args.url;
const TOKEN = args.token;
const ANON_KEY = args.key;
const TARGET_RPS = parseInt(args.rps, 10);
const DURATION_S = parseInt(args.duration, 10);
const ENDPOINT_FILTER = args.endpoint;

if (!BASE_URL) {
  console.error("Usage: node scripts/load-test.mjs --url <SUPABASE_URL> --token <JWT> --key <ANON_KEY>");
  process.exit(1);
}

// ── Endpoint definitions ──
const ENDPOINTS = [
  {
    name: "healthz",
    method: "GET",
    path: "/functions/v1/healthz",
    auth: false,
    weight: 2,
  },
  {
    name: "matches-list",
    method: "GET",
    path: "/rest/v1/matches?select=id,commodity,status&limit=25&order=created_at.desc",
    auth: true,
    weight: 4,
  },
  {
    name: "audit-logs",
    method: "GET",
    path: "/functions/v1/audit-logs?limit=25",
    auth: true,
    weight: 2,
  },
  {
    name: "token-balance",
    method: "GET",
    path: "/rest/v1/token_balances?select=balance&limit=1",
    auth: true,
    weight: 3,
  },
];

// ── Stats tracking ──
const stats = {};
for (const ep of ENDPOINTS) {
  stats[ep.name] = {
    total: 0,
    success: 0,
    errors: 0,
    statusCodes: {},
    latencies: [],
    timeouts: 0,
  };
}

async function fireRequest(endpoint) {
  const s = stats[endpoint.name];
  s.total++;

  const headers = {
    "Content-Type": "application/json",
    apikey: ANON_KEY || "",
  };
  if (endpoint.auth && TOKEN) {
    headers["Authorization"] = `Bearer ${TOKEN}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const start = performance.now();

  try {
    const res = await fetch(`${BASE_URL}${endpoint.path}`, {
      method: endpoint.method,
      headers,
      signal: controller.signal,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });

    const latency = performance.now() - start;
    s.latencies.push(latency);
    s.statusCodes[res.status] = (s.statusCodes[res.status] || 0) + 1;

    if (res.ok) {
      s.success++;
    } else {
      s.errors++;
    }

    // Consume body to free connection
    await res.text();
  } catch (err) {
    const latency = performance.now() - start;
    s.latencies.push(latency);
    if (err.name === "AbortError") {
      s.timeouts++;
    }
    s.errors++;
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printReport() {
  console.log("\n" + "═".repeat(80));
  console.log("  LOAD TEST REPORT");
  console.log("═".repeat(80));
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Config: ${TARGET_RPS} req/s × ${DURATION_S}s = ~${TARGET_RPS * DURATION_S} total requests`);
  console.log("─".repeat(80));

  let grandTotal = 0;
  let grandSuccess = 0;
  let grandErrors = 0;

  for (const [name, s] of Object.entries(stats)) {
    if (s.total === 0) continue;

    grandTotal += s.total;
    grandSuccess += s.success;
    grandErrors += s.errors;

    const p50 = percentile(s.latencies, 50).toFixed(0);
    const p95 = percentile(s.latencies, 95).toFixed(0);
    const p99 = percentile(s.latencies, 99).toFixed(0);
    const max = Math.max(...s.latencies).toFixed(0);
    const errorRate = ((s.errors / s.total) * 100).toFixed(1);

    console.log(`\n  📍 ${name.toUpperCase()}`);
    console.log(`     Requests:  ${s.total} total, ${s.success} ok, ${s.errors} failed (${errorRate}% error rate)`);
    console.log(`     Timeouts:  ${s.timeouts}`);
    console.log(`     Latency:   p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  max=${max}ms`);
    console.log(`     Status:    ${Object.entries(s.statusCodes).map(([k, v]) => `${k}:${v}`).join("  ")}`);

    // Thresholds
    if (parseFloat(p95) > 2000) {
      console.log(`     ⚠️  p95 latency exceeds 2s threshold`);
    }
    if (parseFloat(errorRate) > 5) {
      console.log(`     ⚠️  Error rate exceeds 5% threshold`);
    }
  }

  console.log("\n" + "─".repeat(80));
  const overallErrorRate = grandTotal > 0 ? ((grandErrors / grandTotal) * 100).toFixed(1) : "0";
  console.log(`  OVERALL: ${grandTotal} requests, ${grandSuccess} ok, ${grandErrors} errors (${overallErrorRate}%)`);

  // Pass/fail verdict
  const allLatencies = Object.values(stats).flatMap((s) => s.latencies);
  const globalP95 = percentile(allLatencies, 95);
  const pass = parseFloat(overallErrorRate) < 5 && globalP95 < 3000;
  console.log(`  VERDICT: ${pass ? "✅ PASS" : "❌ FAIL"} (p95=${globalP95.toFixed(0)}ms, error=${overallErrorRate}%)`);
  console.log("═".repeat(80) + "\n");

  process.exit(pass ? 0 : 1);
}

// ── Main loop ──
async function run() {
  // Filter endpoints
  const active = ENDPOINT_FILTER === "all"
    ? ENDPOINTS
    : ENDPOINTS.filter((e) => e.name === ENDPOINT_FILTER);

  if (active.length === 0) {
    console.error(`No endpoint matching "${ENDPOINT_FILTER}". Available: ${ENDPOINTS.map((e) => e.name).join(", ")}`);
    process.exit(1);
  }

  // Skip auth-required endpoints if no token
  const runnable = active.filter((e) => !e.auth || TOKEN);
  if (runnable.length === 0) {
    console.error("All selected endpoints require --token. Provide a JWT.");
    process.exit(1);
  }

  // Build weighted list for random selection
  const weighted = [];
  for (const ep of runnable) {
    for (let i = 0; i < ep.weight; i++) weighted.push(ep);
  }

  console.log(`\n🚀 Starting load test: ${TARGET_RPS} req/s for ${DURATION_S}s`);
  console.log(`   Endpoints: ${runnable.map((e) => e.name).join(", ")}`);
  console.log(`   Auth: ${TOKEN ? "provided" : "skipped (use --token for auth endpoints)"}\n`);

  const intervalMs = 1000 / TARGET_RPS;
  const endTime = Date.now() + DURATION_S * 1000;
  let fired = 0;

  const timer = setInterval(() => {
    if (Date.now() >= endTime) {
      clearInterval(timer);
      // Wait for in-flight requests to complete
      setTimeout(printReport, 5000);
      return;
    }

    const ep = weighted[Math.floor(Math.random() * weighted.length)];
    fireRequest(ep);
    fired++;

    // Progress every 5 seconds
    if (fired % (TARGET_RPS * 5) === 0) {
      const elapsed = Math.floor((Date.now() - (endTime - DURATION_S * 1000)) / 1000);
      const totalReqs = Object.values(stats).reduce((a, s) => a + s.total, 0);
      const totalErrs = Object.values(stats).reduce((a, s) => a + s.errors, 0);
      console.log(`   [${elapsed}s] ${totalReqs} requests sent, ${totalErrs} errors`);
    }
  }, intervalMs);
}

run();
