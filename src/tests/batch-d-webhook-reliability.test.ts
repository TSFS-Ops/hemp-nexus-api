/**
 * Batch D — Webhook Delivery Reliability regression tests.
 *
 * Source-of-truth assertions for the hardening implemented in
 * supabase/functions/_shared/webhooks.ts, webhook-retry/, webhooks/,
 * and the prebuild guard scripts/check-webhook-callsite-idempotency.mjs.
 *
 * These are static-source checks (file content invariants). The runtime
 * behaviour is exercised end-to-end via Deno tests against the edge
 * functions; this suite guards the contracts so that a regression in
 * the source breaks `vitest run` and the prebuild step.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const sharedWebhooks = readFileSync(
  "supabase/functions/_shared/webhooks.ts",
  "utf8",
);
const retryWorker = readFileSync(
  "supabase/functions/webhook-retry/index.ts",
  "utf8",
);
const webhooksFn = readFileSync(
  "supabase/functions/webhooks/index.ts",
  "utf8",
);
const docs = readFileSync("src/pages/docs/Webhooks.tsx", "utf8");

describe("Batch D — primary-path timeout", () => {
  it("deliverWebhook uses AbortSignal.timeout(10s)", () => {
    expect(sharedWebhooks).toMatch(/PRIMARY_DELIVERY_TIMEOUT_MS\s*=\s*10_000/);
    expect(sharedWebhooks).toMatch(/AbortSignal\.timeout\(PRIMARY_DELIVERY_TIMEOUT_MS\)/);
  });

  it("surfaces timeouts distinctly in error_message", () => {
    expect(sharedWebhooks).toMatch(/error\.name\s*===\s*"TimeoutError"/);
    expect(sharedWebhooks).toMatch(/timeout after \$\{PRIMARY_DELIVERY_TIMEOUT_MS\}ms/);
  });
});

describe("Batch D — bounded response body", () => {
  it("caps body at 64 KB before truncation", () => {
    expect(sharedWebhooks).toMatch(/MAX_RESPONSE_BODY_BYTES\s*=\s*64\s*\*\s*1024/);
    expect(sharedWebhooks).toMatch(/readBoundedResponseBody/);
  });
});

describe("Batch D — required idempotency key", () => {
  it("triggerWebhooks signature requires eventIdempotencyKey", () => {
    expect(sharedWebhooks).toMatch(
      /options:\s*\{\s*eventIdempotencyKey:\s*string\s*\}/,
    );
  });

  it("refuses to deliver when key missing", () => {
    expect(sharedWebhooks).toMatch(/REFUSED — triggerWebhooks called/);
  });

  it("outbound POST includes X-Webhook-Idempotency-Key header", () => {
    expect(sharedWebhooks).toMatch(/"X-Webhook-Idempotency-Key":\s*eventIdempotencyKey/);
  });

  it("prebuild guard script exists and passes", () => {
    expect(existsSync("scripts/check-webhook-callsite-idempotency.mjs")).toBe(true);
    const out = execSync("node scripts/check-webhook-callsite-idempotency.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/✓ Batch D webhook idempotency/);
  });
});

describe("Batch D — no-endpoint auditability", () => {
  it("writes webhook.skipped_no_endpoint audit row when zero subscribers", () => {
    expect(sharedWebhooks).toMatch(/"webhook\.skipped_no_endpoint"/);
    expect(sharedWebhooks).toMatch(/no_active_subscribed_endpoint/);
  });
});

describe("Batch D — secret rotation", () => {
  it("rotate route exists in webhooks edge function", () => {
    expect(webhooksFn).toMatch(/parts\[1\]\s*===\s*"rotate"/);
    expect(webhooksFn).toMatch(/previous_secret_hash:/);
    expect(webhooksFn).toMatch(/previous_secret_expires_at:/);
    expect(webhooksFn).toMatch(/"webhook\.secret_rotated"/);
  });

  it("uses a 24h grace window", () => {
    expect(webhooksFn).toMatch(/ROTATION_GRACE_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
});

describe("Batch D — retry cap reconciliation", () => {
  it("retry worker honours per-row max_retries", () => {
    expect(retryWorker).toMatch(/delivery\.max_retries/);
    expect(retryWorker).toMatch(/delivery\.delivery_attempt\s*>=\s*rowMaxRetries/);
  });
});

describe("Batch D — docs ↔ implementation parity", () => {
  it("docs document the idempotency-key header", () => {
    expect(docs).toMatch(/X-Webhook-Idempotency-Key/);
  });

  it("docs document secret rotation endpoint", () => {
    expect(docs).toMatch(/POST \/webhooks\/:id\/rotate/);
  });

  it("docs no longer claim the old 5m,15m,1h,6h,24h schedule", () => {
    expect(docs).not.toMatch(/5m, 15m, 1h, 6h, 24h/);
  });
});
