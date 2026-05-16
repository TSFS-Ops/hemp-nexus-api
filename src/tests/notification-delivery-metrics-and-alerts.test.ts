/**
 * Notification delivery & in-app auto-resolve metrics + alerts
 * ------------------------------------------------------------
 * Source-of-truth scan ensuring the early-warning instrumentation stays
 * wired so staging/production alerts trigger before users notice silent
 * dropped notifications or stale unread badges.
 *
 * Covers:
 *  - resolve-notifications.ts writes a structured
 *    `notification.auto_resolve_failed` audit row on RPC failure/throw.
 *  - infra-alerts evaluates the three new windows:
 *      8) notification dispatch failure rate (1 hr)
 *      9) admin routing failures (30 min)
 *     10) in-app auto-resolve failures (1 hr)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

describe("resolve-notifications writes auto_resolve_failed audit on failure", () => {
  const src = read("supabase/functions/_shared/resolve-notifications.ts");

  it("defines a recordAutoResolveFailure helper", () => {
    expect(src).toMatch(/recordAutoResolveFailure/);
  });

  it("inserts a notification.auto_resolve_failed audit row", () => {
    expect(src).toMatch(/action:\s*["']notification\.auto_resolve_failed["']/);
  });

  it("captures both rpc_error and threw reasons", () => {
    expect(src).toMatch(/recordAutoResolveFailure\([^)]*"rpc_error"/);
    expect(src).toMatch(/recordAutoResolveFailure\([^)]*"threw"/);
  });

  it("audit failures are non-fatal (host request not broken)", () => {
    // The helper itself swallows errors with console.warn.
    expect(src).toMatch(/recordAutoResolveFailure[\s\S]*?catch[\s\S]*?console\.warn/);
  });

  it("preserves structured metadata for forensic correlation", () => {
    expect(src).toMatch(/target_entity_type/);
    expect(src).toMatch(/target_entity_id/);
    expect(src).toMatch(/error_message/);
    expect(src).toMatch(/request_id/);
  });
});

describe("infra-alerts: notification delivery + auto-resolve thresholds", () => {
  const src = read("supabase/functions/infra-alerts/index.ts");

  it("alerts on notification dispatch failure rate over 10% in 1 hr", () => {
    expect(src).toMatch(/Notification Dispatch Failure Rate \(1 hr\)/);
    expect(src).toMatch(/notification_dispatches[\s\S]*?status[\s\S]*?failed/);
  });

  it("alerts on admin_routing_failed skips in 30 min", () => {
    expect(src).toMatch(/Admin Routing Failures \(30 min\)/);
    expect(src).toMatch(/admin_routing_failed/);
  });

  it("alerts on in-app auto-resolve failures in 1 hr", () => {
    expect(src).toMatch(/In-App Auto-Resolve Failures \(1 hr\)/);
    expect(src).toMatch(/notification\.auto_resolve_failed/);
  });

  it("each new check tags critical vs warning severity", () => {
    // Dispatch failure rate
    expect(src).toMatch(/failRate > 40 \|\| dFails >= 20 \? "critical" : "warning"/);
    // Routing failures
    expect(src).toMatch(/rFails >= 10 \? "critical" : "warning"/);
    // Auto-resolve failures
    expect(src).toMatch(/arFails >= 25 \? "critical" : "warning"/);
  });

  it("each new check is wrapped in try/catch so one failure doesn't drop the run", () => {
    const dispatchBlock = src.match(/Notification Dispatch Failure Rate[\s\S]*?Notification dispatch failure check failed/);
    const routingBlock = src.match(/Admin Routing Failures[\s\S]*?Admin routing failure check failed/);
    const resolveBlock = src.match(/In-App Auto-Resolve Failures[\s\S]*?In-app auto-resolve failure check failed/);
    expect(dispatchBlock).not.toBeNull();
    expect(routingBlock).not.toBeNull();
    expect(resolveBlock).not.toBeNull();
  });
});
