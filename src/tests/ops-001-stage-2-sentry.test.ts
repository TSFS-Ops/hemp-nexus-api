/**
 * OPS-001 Stage 2 — Sentry receiving-events assurance.
 *
 * Tests pair pure-logic checks of the HealthBoard `deriveSentryStatus`
 * helper with file-content checks that lock the migration, edge function,
 * and shared helper into the spec.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { deriveSentryStatus } from "@/components/governance/HealthBoard";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const NOW = new Date("2026-05-16T13:00:00Z").getTime();
const within = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

describe("OPS-001 Stage 2 — deriveSentryStatus", () => {
  it("1. missing heartbeat row renders not_monitored (never green)", () => {
    expect(deriveSentryStatus(null, NOW)).toBe("not_monitored");
  });

  it("2. DSN missing renders dsn_missing (never green)", () => {
    expect(
      deriveSentryStatus(
        {
          last_attempt_at: within(1),
          last_success_at: null,
          last_status: "dsn_missing",
          last_http_status: null,
          last_error: "SENTRY_BACKEND_DSN not configured",
          last_event_id: null,
          dsn_configured: false,
          updated_at: within(1),
        },
        NOW,
      ),
    ).toBe("dsn_missing");
  });

  it("3. no attempt yet but DSN configured renders never_run (never green)", () => {
    expect(
      deriveSentryStatus(
        {
          last_attempt_at: null,
          last_success_at: null,
          last_status: "unknown",
          last_http_status: null,
          last_error: null,
          last_event_id: null,
          dsn_configured: true,
          updated_at: within(1),
        },
        NOW,
      ),
    ).toBe("never_run");
  });

  it("4. stale (>30 min old) attempt renders stale (never green)", () => {
    expect(
      deriveSentryStatus(
        {
          last_attempt_at: within(45),
          last_success_at: within(45),
          last_status: "success",
          last_http_status: 200,
          last_error: null,
          last_event_id: "abc",
          dsn_configured: true,
          updated_at: within(45),
        },
        NOW,
      ),
    ).toBe("stale");
  });

  it("5. failed ingest renders failed (never green)", () => {
    expect(
      deriveSentryStatus(
        {
          last_attempt_at: within(5),
          last_success_at: null,
          last_status: "failed",
          last_http_status: 500,
          last_error: "http_500",
          last_event_id: null,
          dsn_configured: true,
          updated_at: within(5),
        },
        NOW,
      ),
    ).toBe("failed");
  });

  it("6. recent successful ingest renders operational", () => {
    expect(
      deriveSentryStatus(
        {
          last_attempt_at: within(5),
          last_success_at: within(5),
          last_status: "success",
          last_http_status: 200,
          last_error: null,
          last_event_id: "abc",
          dsn_configured: true,
          updated_at: within(5),
        },
        NOW,
      ),
    ).toBe("operational");
  });
});

describe("OPS-001 Stage 2 — HealthBoard wiring", () => {
  const src = read("src/components/governance/HealthBoard.tsx");

  it("7. queries the singleton sentry_heartbeats row", () => {
    expect(src).toMatch(/from\(["']sentry_heartbeats["']\)/);
    expect(src).toMatch(/\.eq\(["']id["'],\s*true\)/);
  });

  it("8. renders a Sentry receiving-events tile with derived status attribute", () => {
    expect(src).toMatch(/data-testid="healthboard-sentry-tile"/);
    expect(src).toMatch(/data-sentry-status=\{sentryStatus\}/);
    expect(src).toMatch(/Sentry Receiving Events/);
  });

  it("9. tile must NOT hardcode Sentry as green — colour is derived through sentryToneFor", () => {
    expect(src).toMatch(/sentryToneFor\(sentryStatus\)/);
    // Operational tone is only returned by sentryToneFor for status === "operational".
    expect(src).toMatch(/if \(s === "operational"\) return \{ dot: "bg-\[hsl\(var\(--emerald\)\)\]"/);
  });

  it("10. monitored jobs include sentry-heartbeat-cron so the row also surfaces in cron list", () => {
    expect(src).toMatch(/name:\s*["']sentry-heartbeat-cron["']/);
  });
});

describe("OPS-001 Stage 2 — backend helper & edge function", () => {
  it("11. shared sentry helper exists with no-op safety on missing DSN", () => {
    const s = read("supabase/functions/_shared/sentry.ts");
    expect(s).toMatch(/SENTRY_BACKEND_DSN/);
    expect(s).toMatch(/SENTRY_DSN/);
    expect(s).toMatch(/export function sentryDsnConfigured/);
    // Dispatch returns a structured `dsn_missing` result instead of throwing.
    expect(s).toMatch(/error:\s*["']dsn_missing["']/);
    // captureException + captureMessage exist and are async.
    expect(s).toMatch(/export async function captureException/);
    expect(s).toMatch(/export async function captureMessage/);
  });

  it("12. helper does not transmit auth headers, tokens, request bodies or secrets", () => {
    const s = read("supabase/functions/_shared/sentry.ts");
    // Body assembled from typed event fields only — never raw request.
    expect(s).not.toMatch(/req\.headers/);
    expect(s).not.toMatch(/Authorization/);
    expect(s).not.toMatch(/req\.text\(\)|req\.json\(\)/);
    // Only the public Sentry key is sent (X-Sentry-Auth), never the secret service key.
    expect(s).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("13. sentry-heartbeat edge function exists and enforces x-internal-key", () => {
    const s = read("supabase/functions/sentry-heartbeat/index.ts");
    expect(s).toMatch(/INTERNAL_CRON_KEY/);
    expect(s).toMatch(/x-internal-key/);
    expect(s).toMatch(/sendHeartbeatEvent\(\)/);
  });

  it("14. edge function writes singleton sentry_heartbeats row with honest status", () => {
    const s = read("supabase/functions/sentry-heartbeat/index.ts");
    expect(s).toMatch(/from\(["']sentry_heartbeats["']\)[\s\S]*\.upsert/);
    expect(s).toMatch(/last_status:\s*["']dsn_missing["']/);
    // success/failed paths both land in last_status.
    expect(s).toMatch(/last_status:\s*status/);
    expect(s).toMatch(/dsn_configured/);
  });

  it("15. missing DSN never calls Sentry (no fetch dispatch on that branch)", () => {
    const s = read("supabase/functions/sentry-heartbeat/index.ts");
    // The early `dsn_missing` branch must return BEFORE sendHeartbeatEvent runs.
    const dsnBranch = s.indexOf("if (!dsnConfigured)");
    const dispatchCall = s.indexOf("sendHeartbeatEvent(");
    expect(dsnBranch).toBeGreaterThan(0);
    expect(dispatchCall).toBeGreaterThan(dsnBranch);
    // The dsn_missing branch contains an explicit early return.
    const branchSlice = s.slice(dsnBranch, dispatchCall);
    expect(branchSlice).toMatch(/return new Response/);
  });
});

describe("OPS-001 Stage 2 — migration schedules sentry-heartbeat via cron_invoke", () => {
  const migrationsDir = join(root, "supabase/migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const blobs = files.map((f) => read(`supabase/migrations/${f}`)).join("\n");

  it("16. migration creates sentry_heartbeats with admin-only RLS", () => {
    expect(blobs).toMatch(/CREATE TABLE IF NOT EXISTS public\.sentry_heartbeats/);
    expect(blobs).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(blobs).toMatch(/Admins can view sentry heartbeats[\s\S]*is_admin\(auth\.uid\(\)\)/);
  });

  it("17. migration schedules sentry-heartbeat-cron through cron_invoke (so failures surface in cron_heartbeats)", () => {
    expect(blobs).toMatch(/cron\.schedule\(\s*['"]sentry-heartbeat-cron['"]/);
    expect(blobs).toMatch(/cron_invoke\([\s\S]*sentry-heartbeat-cron[\s\S]*\/functions\/v1\/sentry-heartbeat/);
  });

  it("18. sentry-heartbeat function path exists for the prebuild edge-function-path guard", () => {
    expect(existsSync(join(root, "supabase/functions/sentry-heartbeat/index.ts"))).toBe(true);
  });
});
