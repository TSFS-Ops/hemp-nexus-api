/**
 * Public API V1 · Sand/Prod Batch 7 — Webhook testing and production
 * webhook controls. Static source-contract tests (no Deno imports, no
 * live DB roundtrip) — matches the Batch 2-6 pattern.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const SHARED = read("supabase/functions/_shared/public-api-v1-webhooks.ts");
const DISPATCHER = read("supabase/functions/public-api-webhooks-dispatch/index.ts");
const AUDIT_GUARD = read("scripts/check-public-api-audit-names.mjs");

describe("Batch 7 · canonical event catalogues", () => {
  it("sandbox catalogue includes the required test events", () => {
    for (const evt of [
      "lookup.completed",
      "lookup.failed",
      "usage.limit_warning",
      "usage.limit_reached",
      "key.expiring",
      "key.revoked",
      "webhook.test",
    ]) {
      expect(SHARED).toContain(`"${evt}"`);
    }
  });

  it("production catalogue includes the required production events", () => {
    for (const evt of [
      "lookup.completed",
      "lookup.failed",
      "usage.limit_80",
      "usage.limit_100",
      "usage.limit_120",
      "billable_overage",
      "key.expiring",
      "key.revoked",
      "incident.notice",
      "webhook.delivery_failed",
    ]) {
      expect(SHARED).toContain(`"${evt}"`);
    }
  });

  it("forbidden event patterns block POI/WaD/compliance/payment/verification/evidence/document/bank/governance", () => {
    for (const fam of ["poi", "wad", "compliance", "verification", "payment", "evidence", "document", "bank", "governance"]) {
      expect(SHARED).toMatch(new RegExp(`\\^${fam}\\\\\\.`, "i"));
    }
  });
});

describe("Batch 7 · environment routing", () => {
  it("sandbox endpoint cannot receive production-only event", () => {
    expect(SHARED).toMatch(/production_event_to_sandbox/);
  });
  it("production endpoint cannot receive sandbox-only event", () => {
    expect(SHARED).toMatch(/sandbox_event_to_production/);
  });
  it("forbidden event reason is enforced", () => {
    expect(SHARED).toMatch(/forbidden_event/);
  });
  it("dispatcher enforces env match before delivery", () => {
    expect(DISPATCHER).toMatch(/classifyEventForEnvironment\(/);
  });
});

describe("Batch 7 · production gating on sandbox test", () => {
  it("shared module exposes assertSandboxTestPassedForClient", () => {
    expect(SHARED).toMatch(/assertSandboxTestPassedForClient/);
    expect(SHARED).toMatch(/sandbox_test_required/);
  });
  it("dispatcher checks the sandbox-test gate for production endpoints", () => {
    expect(DISPATCHER).toMatch(/assertSandboxTestPassedForClient/);
    expect(DISPATCHER).toMatch(/api\.webhook\.production\.blocked_until_sandbox_tested/);
  });
});

describe("Batch 7 · payload markers", () => {
  it("sandbox payload includes environment=sandbox and test_event=true", () => {
    expect(SHARED).toMatch(/environment:\s*"sandbox"/);
    expect(SHARED).toMatch(/test_event:\s*true/);
  });

  it("sandbox payload includes event_id, event_type, client_id, request_id, timestamp", () => {
    for (const field of ["event_id", "event_type", "client_id", "request_id", "timestamp"]) {
      expect(SHARED).toMatch(new RegExp(`${field}:`));
    }
  });

  it("sandbox payload may carry sandbox_case_id when supplied", () => {
    expect(SHARED).toMatch(/sandbox_case_id/);
  });

  it("production payload includes environment=production and never includes test_event or sandbox_case_id", () => {
    expect(SHARED).toMatch(/environment:\s*"production"/);
    expect(SHARED).toMatch(/delete \(body as Record<string, unknown>\)\.test_event/);
    expect(SHARED).toMatch(/delete \(body as Record<string, unknown>\)\.sandbox_case_id/);
  });
});

describe("Batch 7 · signing", () => {
  it("signature header is X-Izenzo-Signature", () => {
    expect(SHARED).toMatch(/V1_WEBHOOK_SIGNATURE_HEADER\s*=\s*"X-Izenzo-Signature"/);
  });
  it("timestamp header is X-Izenzo-Timestamp", () => {
    expect(SHARED).toMatch(/V1_WEBHOOK_TIMESTAMP_HEADER\s*=\s*"X-Izenzo-Timestamp"/);
  });
  it("HMAC-SHA256 over timestamp + payload", () => {
    expect(SHARED).toMatch(/HMAC.*SHA-256/);
    expect(SHARED).toMatch(/\$\{timestamp\}\.\$\{payload\}/);
  });
  it("dispatcher does not echo the raw secret in headers, logs, audit metadata, or response", () => {
    expect(DISPATCHER).not.toMatch(/secret_hash[^,;\n]*console\.log/);
    expect(DISPATCHER).not.toMatch(/raw_secret/);
    // Response signature header is intentionally truncated to a prefix.
    expect(DISPATCHER).toMatch(/signature\.slice\(0,\s*12\)/);
  });
});

describe("Batch 7 · retry schedule", () => {
  it("schedule is 1m / 5m / 30m", () => {
    expect(SHARED).toMatch(/V1_WEBHOOK_RETRY_SCHEDULE_MINUTES\s*=\s*\[1,\s*5,\s*30\]/);
  });
  it("max attempts is 4 (1 initial + 3 retries)", () => {
    expect(SHARED).toMatch(/V1_WEBHOOK_MAX_ATTEMPTS\s*=\s*1\s*\+\s*V1_WEBHOOK_RETRY_SCHEDULE_MINUTES\.length/);
  });
  it("final failure surfaces webhook.delivery_failed", () => {
    expect(SHARED).toContain('"webhook.delivery_failed"');
  });
  it("retry preserves event_id (single eventId built per dispatch)", () => {
    // exactly one randomUUID() call assigned to eventId
    const matches = DISPATCHER.match(/const eventId = crypto\.randomUUID\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });
  it("retry does not duplicate billable usage — sandbox response sets billable:false", () => {
    expect(DISPATCHER).toMatch(/billable:\s*false/);
  });
});

describe("Batch 7 · payload safety", () => {
  it("forbidden payload fields are screened", () => {
    for (const f of [
      "document", "documents", "evidence", "evidence_pack",
      "internal_notes", "id_document", "passport", "national_id",
      "bank_account", "iban", "swift", "other_client_data",
      "cross_client", "raw_document",
    ]) {
      expect(SHARED).toContain(`"${f}"`);
    }
  });
  it("assertSafePayload is invoked by both payload builders", () => {
    const builderHits = (SHARED.match(/assertSafePayload\(/g) ?? []).length;
    expect(builderHits).toBeGreaterThanOrEqual(2);
  });
  it("dispatcher also calls assertSafePayload before fetch()", () => {
    const idx = DISPATCHER.indexOf("assertSafePayload(payload)");
    const fetchIdx = DISPATCHER.indexOf("await fetch(endpoint.url");
    expect(idx).toBeGreaterThan(0);
    expect(fetchIdx).toBeGreaterThan(idx);
  });
});

describe("Batch 7 · read-only invariants", () => {
  it("dispatcher never references POI / WaD / payment / compliance / verification tables", () => {
    for (const banned of [
      "from(\"pois", "from(\"wads", "from(\"payment", "from(\"compliance_cases",
      "from(\"screening_results", "from(\"trade_orders",
    ]) {
      expect(DISPATCHER).not.toContain(banned);
    }
  });
  it("dispatcher only POSTs the outbound webhook (no internal RPC writes that mutate state)", () => {
    const fetchCount = (DISPATCHER.match(/await fetch\(/g) ?? []).length;
    expect(fetchCount).toBe(1);
  });
});

describe("Batch 7 · audit taxonomy guard", () => {
  it("audit-name guard includes every Batch 7 canonical name", () => {
    for (const n of [
      "api.webhook.endpoint.created",
      "api.webhook.endpoint.updated",
      "api.webhook.endpoint.enabled",
      "api.webhook.endpoint.disabled",
      "api.webhook.test.sent",
      "api.webhook.delivery.succeeded",
      "api.webhook.delivery.failed",
      "api.webhook.delivery.retry_scheduled",
      "api.webhook.production.enabled",
      "api.webhook.production.blocked_until_sandbox_tested",
    ]) {
      expect(AUDIT_GUARD).toContain(`"${n}"`);
    }
  });
});

describe("Batch 7 · scope catalogue is unchanged in Batch 7", () => {
  it("webhook:test is still sandbox-only", () => {
    const scopes = read("supabase/functions/_shared/public-api-v1-scopes.ts");
    expect(scopes).toMatch(/scope:\s*"webhook:test"[\s\S]{0,120}envRule:\s*"sandbox"/);
  });
  it("webhook:events_read is still production-only", () => {
    const scopes = read("supabase/functions/_shared/public-api-v1-scopes.ts");
    expect(scopes).toMatch(/scope:\s*"webhook:events_read"[\s\S]{0,160}envRule:\s*"production"/);
  });
});
