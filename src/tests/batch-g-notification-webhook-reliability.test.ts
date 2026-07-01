/**
 * Batch G — Notification & Customer Webhook Reliability
 * ------------------------------------------------------
 * Source-of-truth static guards for the additive observability wired in:
 *
 *   - supabase/migrations/<batch_g>_webhook_auto_disable_observability.sql
 *   - supabase/functions/webhooks/index.ts (PATCH re-enable audit)
 *   - supabase/functions/infra-alerts/index.ts (two new windows)
 *   - supabase/functions/notification-dispatch/index.ts (slack_status envelope)
 *
 * These tests DO NOT hit the network. They read files and assert the
 * hardened contracts are in place so a regression breaks `vitest run`
 * before it reaches staging.
 *
 * Explicit non-goals: no real webhook, email, or Slack traffic; no
 * threshold or backoff behaviour change is asserted here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

const migrationFile = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith("_batch_g_webhook_auto_disable_observability.sql"))
  .sort()
  .pop();

describe("Batch G — webhook_record_failure observability migration", () => {
  it("migration file exists", () => {
    expect(migrationFile).toBeDefined();
  });

  const sql = migrationFile ? read(`supabase/migrations/${migrationFile}`) : "";

  it("preserves the 10-failure threshold default", () => {
    expect(sql).toMatch(/p_threshold\s+integer\s+DEFAULT\s+10/);
  });

  it("preserves the atomic counter increment", () => {
    expect(sql).toMatch(/consecutive_failures\s*=\s*consecutive_failures\s*\+\s*1/);
  });

  it("still only trips when disabled_at is NULL (idempotent trip)", () => {
    expect(sql).toMatch(/AND\s+disabled_at\s+IS\s+NULL/);
  });

  it("writes a webhook.endpoint.auto_disabled audit row on trip", () => {
    expect(sql).toMatch(/'webhook\.endpoint\.auto_disabled'/);
    expect(sql).toMatch(/INSERT INTO public\.audit_logs/);
  });

  it("writes an admin_risk_items row with kind webhook_auto_disabled and dedup_key", () => {
    expect(sql).toMatch(/'webhook_auto_disabled'/);
    expect(sql).toMatch(/INSERT INTO public\.admin_risk_items/);
    expect(sql).toMatch(/ON CONFLICT \(dedup_key\) DO NOTHING/);
  });

  it("emits per-platform-admin in-app notifications", () => {
    expect(sql).toMatch(/INSERT INTO public\.notifications/);
    expect(sql).toMatch(/role\s*=\s*'platform_admin'/);
  });

  it("wraps each observability insert in an exception block so the counter/trip contract is preserved", () => {
    const matches = sql.match(/EXCEPTION WHEN OTHERS THEN/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("does not store raw webhook payloads (only endpoint id/url/counter/threshold/disabled_at)", () => {
    expect(sql).not.toMatch(/payload_body|request_body|response_body/);
  });
});

describe("Batch G — webhook re-enable audit", () => {
  const src = read("supabase/functions/webhooks/index.ts");

  it("captures prior status on PATCH", () => {
    expect(src).toMatch(/select\("id, status, disabled_at"\)/);
  });

  it("detects inactive -> active transition", () => {
    expect(src).toMatch(/existing\.status\s*===\s*"inactive"\s*&&\s*body\.status\s*===\s*"active"/);
  });

  it("writes webhook.endpoint.reenabled audit row on re-enable", () => {
    expect(src).toMatch(/"webhook\.endpoint\.reenabled"/);
  });

  it("clears disabled_at and consecutive_failures on re-enable", () => {
    expect(src).toMatch(/patchPayload\.disabled_at\s*=\s*null/);
    expect(src).toMatch(/patchPayload\.consecutive_failures\s*=\s*0/);
  });
});

describe("Batch G — infra-alerts new windows", () => {
  const src = read("supabase/functions/infra-alerts/index.ts");

  it("adds a webhook auto-disable window", () => {
    expect(src).toMatch(/Webhook Auto-Disable \(1 hr\)/);
    expect(src).toMatch(/\.eq\("kind",\s*"webhook_auto_disabled"\)/);
  });

  it("adds a slack dispatcher unavailable window", () => {
    expect(src).toMatch(/Slack Dispatcher Unavailable \(1 hr\)/);
    expect(src).toMatch(/notification_channel_skipped_events/);
    expect(src).toMatch(/\.eq\("reason",\s*"dispatcher_unavailable"\)/);
  });

  it("wraps each new window in try/catch so one failing check does not kill the run", () => {
    const wh = src.match(/Webhook Auto-Disable[\s\S]*?Webhook auto-disable check failed/);
    const sl = src.match(/Slack Dispatcher Unavailable[\s\S]*?Slack dispatcher unavailable check failed/);
    expect(wh).not.toBeNull();
    expect(sl).not.toBeNull();
  });

  it("uses warning/critical thresholds as specified in the batch brief", () => {
    // Webhook: warning >=1, critical >=5
    expect(src).toMatch(/ad >= 5 \? "critical" : "warning"/);
    // Slack: warning >=5, critical >=20
    expect(src).toMatch(/sf >= 20 \? "critical" : "warning"/);
  });

  it("does not send real Slack/webhook traffic from the new checks", () => {
    // The new checks only run supabase.from(...).select(...) — no fetch().
    const whBlock = src.match(/Webhook Auto-Disable[\s\S]*?Webhook auto-disable check failed[\s\S]*?}/);
    const slBlock = src.match(/Slack Dispatcher Unavailable[\s\S]*?Slack dispatcher unavailable check failed[\s\S]*?}/);
    expect(whBlock?.[0]).not.toMatch(/\bfetch\(/);
    expect(slBlock?.[0]).not.toMatch(/\bfetch\(/);
  });
});

describe("Batch G — notification-dispatch slack_status envelope", () => {
  const src = read("supabase/functions/notification-dispatch/index.ts");

  it("declares a typed slackStatus variable with the four allowed values", () => {
    expect(src).toMatch(/"sent"\s*\|\s*"skipped_not_configured"\s*\|\s*"failed"\s*\|\s*"not_requested"/);
  });

  it("returns slack_status in the response envelope", () => {
    expect(src).toMatch(/slack_status:\s*slackStatus/);
  });

  it("sets slack_status='sent' on 2xx", () => {
    expect(src).toMatch(/slackStatus\s*=\s*"sent"/);
  });

  it("sets slack_status='failed' on non-2xx and on thrown error", () => {
    const failedHits = src.match(/slackStatus\s*=\s*"failed"/g) ?? [];
    expect(failedHits.length).toBeGreaterThanOrEqual(2);
  });

  it("sets slack_status='skipped_not_configured' when no webhook configured", () => {
    expect(src).toMatch(/slackStatus\s*=\s*"skipped_not_configured"/);
  });

  it("still records notification_channel_skipped_events on Slack failure", () => {
    expect(src).toMatch(/recordNotificationSkipped[\s\S]*?channel:\s*"slack"[\s\S]*?reason:\s*"dispatcher_unavailable"/);
  });

  it("does not turn Slack failure into a top-level function failure", () => {
    // Response envelope stays { ok: true, ... }
    expect(src).toMatch(/ok:\s*true,\s*dispatched,\s*skipped,\s*slack_status/);
  });
});
