/**
 * NOT-002 / NOT-010 — Outreach cooldown + stale-reminder hardening
 * ----------------------------------------------------------------
 * Source-pin tests. They read the actual edge-function source files
 * and assert the wiring is in place. Runtime behaviour of the helpers
 * (notification_skipped helper, audit_logs writes) is covered by the
 * NOT-001/006 suite.
 *
 * Scope (per approved batch):
 *   1. Same-body resend idempotency still works (cache lookup precedes
 *      cooldown check).
 *   2. Edited-body resend within 30s returns 429 with Retry-After.
 *   3. Rate-limited send writes notification_skipped(rate_limited).
 *   4. Resend outside cooldown writes engagement.outreach_resend_attempted
 *      in addition to the normal outreach_email_queued audit.
 *   5. outreach-sla-monitor re-checks status before update; predicate
 *      pinned to ['pending','notification_sent'].
 *   6. outreach-sla-monitor filters digest items via live recheck so
 *      accepted engagements are excluded.
 *   7. outreach-sla-monitor writes notification_skipped(lifecycle_noop)
 *      for stale rows.
 *   8. engagement-reminder re-fetches live status and only inserts a
 *      notification when status is still 'notification_sent'.
 *   9. engagement-reminder writes notification_skipped(lifecycle_noop)
 *      for skipped stale rows.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const poiEngSrc = read("supabase/functions/poi-engagements/index.ts");
const slaMonSrc = read("supabase/functions/outreach-sla-monitor/index.ts");
const reminderSrc = read("supabase/functions/engagement-reminder/index.ts");

describe("NOT-002 — send-outreach 30s cooldown", () => {
  it("Fix 1: cache lookup runs BEFORE the cooldown check (same-body replay still wins)", () => {
    const cacheIdx = poiEngSrc.indexOf("lookupIdempotentResponse(idemOpts)");
    const cooldownIdx = poiEngSrc.indexOf("NOT-002: 30s per-engagement send cooldown");
    expect(cacheIdx).toBeGreaterThan(0);
    expect(cooldownIdx).toBeGreaterThan(0);
    expect(cacheIdx).toBeLessThan(cooldownIdx);
  });

  it("Fix 2: cooldown window is 30 seconds", () => {
    expect(poiEngSrc).toMatch(/const COOLDOWN_SECONDS\s*=\s*30/);
  });

  it("Fix 3: cooldown queries audit_logs for prior queued + follow-up sends", () => {
    expect(poiEngSrc).toContain('"engagement.outreach_email_queued"');
    expect(poiEngSrc).toContain('"engagement.outreach_followup_email_sent"');
    // Both must be in the SEND_AUDIT_ACTIONS array used by the cooldown.
    expect(poiEngSrc).toMatch(/SEND_AUDIT_ACTIONS\s*=\s*\[[\s\S]*?engagement\.outreach_email_queued[\s\S]*?engagement\.outreach_followup_email_sent[\s\S]*?\]/);
  });

  it("Fix 4: cooldown breach throws 429 RATE_LIMITED with retryAfter detail", () => {
    expect(poiEngSrc).toMatch(/throw new ApiException\(\s*\n?\s*"RATE_LIMITED"[\s\S]*?429,\s*\{\s*retryAfter\s*\}/);
  });

  it("Fix 5: rate-limited send writes notification_skipped(rate_limited)", () => {
    // The cooldown branch must call recordNotificationSkipped with the
    // canonical rate_limited reason BEFORE throwing the 429.
    const block = poiEngSrc.match(
      /if \(recentSend\) \{[\s\S]*?throw new ApiException\(\s*\n?\s*"RATE_LIMITED"/
    );
    expect(block, "rate-limit block not found").toBeTruthy();
    expect(block![0]).toContain("recordNotificationSkipped");
    expect(block![0]).toMatch(/reason:\s*["']rate_limited["']/);
    expect(block![0]).toMatch(/sourceFunction:\s*["']poi-engagements\/send-outreach["']/);
    expect(block![0]).toMatch(/channel:\s*["']email["']/);
  });

  it("Fix 6: prior-send count drives resend detection", () => {
    expect(poiEngSrc).toMatch(/const isResend\s*=\s*\(priorSends\s*\?\?\s*\[\]\)\.length\s*>\s*0/);
  });

  it("Fix 7: resend outside cooldown writes engagement.outreach_resend_attempted", () => {
    // Audit row must exist, and must only be written when isResend.
    const block = poiEngSrc.match(
      /if \(isResend\) \{[\s\S]*?action:\s*"engagement\.outreach_resend_attempted"[\s\S]*?\}\)/
    );
    expect(block, "resend audit block not found").toBeTruthy();
    expect(block![0]).toContain("entity_type: \"poi_engagement\"");
    expect(block![0]).toMatch(/prior_send_count:/);
  });
});

describe("NOT-010 — outreach-sla-monitor stale-reminder guard", () => {
  it("Fix 1: live status recheck happens before update + digest", () => {
    expect(slaMonSrc).toContain("NOT-010: TOCTOU recheck");
    // Reminder-eligible set must be the canonical pair.
    expect(slaMonSrc).toMatch(/REMINDER_ELIGIBLE\s*=\s*\[\s*"pending"\s*,\s*"notification_sent"\s*\]/);
  });

  it("Fix 2: digest items are built from the post-recheck eligible set", () => {
    // After the recheck, `eligible` is the only source of `items`.
    expect(slaMonSrc).toMatch(/const items\s*=\s*eligible\.map/);
  });

  it("Fix 3: per-row UPDATE pins engagement_status with .in predicate", () => {
    // The .update() call must end with .in("engagement_status", REMINDER_ELIGIBLE)
    expect(slaMonSrc).toMatch(
      /\.update\(\{[\s\S]*?sla_reminder_sent_at[\s\S]*?\}\)\s*\.eq\("id",\s*e\.id\)\s*\.in\("engagement_status",\s*REMINDER_ELIGIBLE\)/
    );
  });

  it("Fix 4: skipped stale rows write notification_skipped(lifecycle_noop)", () => {
    expect(slaMonSrc).toMatch(/action:\s*"notification_skipped"/);
    expect(slaMonSrc).toMatch(/reason:\s*["']lifecycle_noop["']/);
    expect(slaMonSrc).toMatch(/source_function:\s*["']outreach-sla-monitor["']/);
  });

  it("Fix 5: zero-eligible response still reports skipped_stale count", () => {
    expect(slaMonSrc).toMatch(/skipped_stale:\s*skippedStale\.length/);
  });
});

describe("NOT-010 — engagement-reminder stale-reminder guard", () => {
  it("Fix 1: live status recheck before notifications insert", () => {
    expect(reminderSrc).toContain("NOT-010: TOCTOU recheck");
    // Recheck must read engagement_status from poi_engagements.
    expect(reminderSrc).toMatch(/\.from\("poi_engagements"\)[\s\S]{0,120}\.select\("id, engagement_status"\)/);
  });

  it("Fix 2: only rows still in 'notification_sent' get a reminder", () => {
    expect(reminderSrc).toMatch(/if \(live === "notification_sent"\) \{[\s\S]*?stillStale\.push/);
  });

  it("Fix 3: notifications insert is gated on stillStale, not raw fetch", () => {
    expect(reminderSrc).toMatch(/const notifications\s*=\s*stillStale\.map/);
    // Must NOT regress to the old `staleEngagements!.map` call when building
    // notifications.
    expect(reminderSrc).not.toMatch(
      /const notifications\s*=\s*staleEngagements!\.map/,
    );
  });

  it("Fix 4: skipped stale rows write notification_skipped(lifecycle_noop)", () => {
    expect(reminderSrc).toMatch(/action:\s*"notification_skipped"/);
    expect(reminderSrc).toMatch(/reason:\s*["']lifecycle_noop["']/);
    expect(reminderSrc).toMatch(/source_function:\s*["']engagement-reminder["']/);
  });

  it("Fix 5: admin_audit_logs run summary records the skipped count", () => {
    expect(reminderSrc).toMatch(/skipped_lifecycle_noop_count:\s*skippedStale\.length/);
  });
});
