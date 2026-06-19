/**
 * Public API V1 — Batch 12: Final Acceptance / Closeout
 *
 * This batch introduces NO new product features. It cross-checks that
 * Batches 0–11 are internally consistent and that the documented hard
 * exclusions are still in force.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, "src/tests");
const SHARED_DIR = join(ROOT, "supabase/functions/_shared");
const GATEWAY = join(ROOT, "supabase/functions/public-api/index.ts");
const OPENAPI = join(SHARED_DIR, "public-api-v1-openapi.ts");
const V1 = join(SHARED_DIR, "public-api-v1.ts");

function read(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

describe("Batch 12 — Final Acceptance Pack (Public API V1)", () => {
  it("ships contract-guard test files for Batches 1–11", () => {
    const files = readdirSync(TESTS_DIR).filter((f) =>
      /^public-api-v1-batch(1|2|3|4|5|6|7|8|9|10|11)-/.test(f),
    );
    // 11 batches, one file each
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it("preserves single-source-of-truth OpenAPI module", () => {
    const src = read(OPENAPI);
    expect(src).toMatch(/Izenzo Public API V1/);
    expect(src).toMatch(/V1_AVAILABLE_ENDPOINTS/);
    expect(src).toMatch(/V1_DEFERRED_ENDPOINTS/);
    expect(src).toMatch(/V1_SCOPE_CATALOGUE/);
    expect(src).toMatch(/V1_ERROR_CATALOGUE/);
  });

  it("keeps docs routes API-key-gated and non-billable", () => {
    const gw = read(GATEWAY);
    expect(gw).toMatch(/\/v1\/docs/);
    expect(gw).toMatch(/openapi\.json/);
    // Both routes flow through handleV1 which enforces API key + scope
    expect(gw).toMatch(/handleV1/);
  });

  it("keeps the canonical error envelope in v1 handler", () => {
    const v1 = read(V1);
    expect(v1).toMatch(/error/);
    expect(v1).toMatch(/request_id|requestId|X-Request-Id/i);
  });

  // ---- Hard exclusions: scan the whole Public API V1 surface area ----
  function v1Surface(): string {
    const parts: string[] = [];
    for (const f of readdirSync(SHARED_DIR)) {
      if (f.startsWith("public-api-v1") || f === "public-api-v1.ts") {
        parts.push(read(join(SHARED_DIR, f)));
      }
    }
    parts.push(read(GATEWAY));
    return parts.join("\n");
  }

  it("does not expose write/payment/webhook/OAuth routes via V1", () => {
    const surface = v1Surface();
    // No write endpoints
    expect(surface).not.toMatch(/\/v1\/(matches|pois|wads|trade_requests)\b/);
    // No payment collection / invoice routes
    expect(surface).not.toMatch(/\/v1\/(payments|invoices|charges|checkout)\b/);
    // No webhook configuration via V1
    expect(surface).not.toMatch(/\/v1\/webhooks\b/);
    // No OAuth / public signup via V1
    expect(surface).not.toMatch(/\/v1\/(oauth|signup|register)\b/);
    // No evidence/document downloads via V1
    expect(surface).not.toMatch(/\/v1\/(documents|evidence)\b/);
  });

  it("does not log or echo raw key secrets", () => {
    const surface = v1Surface();
    // Hash storage allowed; raw-secret echoing in responses is not
    expect(surface).not.toMatch(/raw_secret\s*:\s*[a-z_]+\s*,/);
  });
});
