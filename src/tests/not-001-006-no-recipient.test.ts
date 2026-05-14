/**
 * NOT-001 / NOT-006 — No-recipient & skipped-notification audit hardening
 * -----------------------------------------------------------------------
 * Source-pin tests verifying:
 *   1. match.soft_route writes notification_skipped(no_recipient) when no
 *      counterparty email is supplied (both counterparty-gate and
 *      eligibility soft-route branches).
 *   2. poi-engagements/send-outreach writes notification_skipped(no_recipient)
 *      when blocked for a missing recipient.
 *   3. poi-engagements/send-outreach writes notification_skipped(recipient_suppressed)
 *      in the suppression branch.
 *   4. recordNotificationSkipped helper dedupes per target/reason/channel/source/day.
 *   5. Audit action is `engagement.outreach_email_queued`, never `*_sent`.
 *   6. UI-003 truthful copy ("queued", not "sent") still holds.
 *   7. HealthBoard surfaces no-recipient skip count.
 *   8. No automatic outreach is attempted for unknown recipients
 *      (no calls to send-transactional-email on the no-recipient path).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const matchSrc = read("supabase/functions/match/index.ts");
const poiEngSrc = read("supabase/functions/poi-engagements/index.ts");
const skipHelperSrc = read("supabase/functions/_shared/notification-skip-audit.ts");
const healthBoardSrc = read("src/components/governance/HealthBoard.tsx");

describe("NOT-001/006 — no-recipient skip audit wiring", () => {
  it("Fix 1a: match.ts imports recordNotificationSkipped", () => {
    expect(matchSrc).toMatch(
      /from\s+["']\.\.\/_shared\/notification-skip-audit\.ts["']/
    );
    expect(matchSrc).toContain("recordNotificationSkipped");
  });

  it("Fix 1b: match.ts soft-route writes notification_skipped(no_recipient) with source=match.soft_route", () => {
    // Both soft-route branches must call recordNotificationSkipped.
    const calls = matchSrc.match(/recordNotificationSkipped\s*\(\s*supabase/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(matchSrc).toMatch(/reason:\s*["']no_recipient["']/);
    expect(matchSrc).toMatch(/sourceFunction:\s*["']match\.soft_route["']/);
    expect(matchSrc).toMatch(/channel:\s*["']email["']/);
  });

  it("Fix 1c: match.ts skip is gated on absent counterpartyEmail (no false skips)", () => {
    expect(matchSrc).toMatch(/if\s*\(\s*!counterpartyEmail\s*\)\s*\{[\s\S]*?recordNotificationSkipped/);
  });

  it("Fix 2a: poi-engagements imports recordNotificationSkipped", () => {
    expect(poiEngSrc).toMatch(
      /from\s+["']\.\.\/_shared\/notification-skip-audit\.ts["']/
    );
  });

  it("Fix 2b: poi-engagements no-recipient branch records notification_skipped before throwing", () => {
    // The block must call the helper before the VALIDATION_ERROR throw.
    const noRecipientBlock = poiEngSrc.match(
      /if\s*\(\s*!recipient\s*\)\s*\{[\s\S]*?throw new ApiException\("VALIDATION_ERROR"/
    );
    expect(noRecipientBlock, "no-recipient block not found").toBeTruthy();
    expect(noRecipientBlock![0]).toContain("recordNotificationSkipped");
    expect(noRecipientBlock![0]).toMatch(/reason:\s*["']no_recipient["']/);
    expect(noRecipientBlock![0]).toMatch(
      /sourceFunction:\s*["']poi-engagements\/send-outreach["']/
    );
  });

  it("Fix 2c: poi-engagements suppression branch records notification_skipped(recipient_suppressed)", () => {
    const suppressedBlock = poiEngSrc.match(
      /if\s*\(\s*suppressed\s*\)\s*\{[\s\S]*?throw new ApiException\(\s*\n?\s*"RECIPIENT_SUPPRESSED"/
    );
    expect(suppressedBlock, "suppression block not found").toBeTruthy();
    expect(suppressedBlock![0]).toContain("recordNotificationSkipped");
    expect(suppressedBlock![0]).toMatch(/reason:\s*["']recipient_suppressed["']/);
    expect(suppressedBlock![0]).toMatch(
      /sourceFunction:\s*["']poi-engagements\/send-outreach["']/
    );
  });

  it("Fix 2d: suppression branch still throws RECIPIENT_SUPPRESSED 409 (no behaviour drift)", () => {
    expect(poiEngSrc).toMatch(/throw new ApiException\(\s*\n?\s*"RECIPIENT_SUPPRESSED"[\s\S]*?409/);
  });

  it("Fix 2e: no-recipient branch does NOT call send-transactional-email", () => {
    // Carve out the !recipient block and assert no invoke call inside it.
    const block = poiEngSrc.match(
      /if\s*\(\s*!recipient\s*\)\s*\{[\s\S]*?throw new ApiException\("VALIDATION_ERROR"[\s\S]*?\}/
    );
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/send-transactional-email/);
    expect(block![0]).not.toMatch(/functions\.invoke/);
  });
});

describe("NOT-001/006 — Fix 3: queued vs sent audit action rename", () => {
  it("poi-engagements uses engagement.outreach_email_queued (not _sent)", () => {
    expect(poiEngSrc).toContain('"engagement.outreach_email_queued"');
    expect(poiEngSrc).not.toMatch(
      /p_audit_action:\s*["']engagement\.outreach_email_sent["']/
    );
  });

  it("snapshot note says EMAIL QUEUED (UI-003 carryover)", () => {
    expect(poiEngSrc).toContain("EMAIL QUEUED");
    expect(poiEngSrc).not.toMatch(/EMAIL SENT to/);
  });
});

describe("NOT-001/006 — Fix 4: idempotent skipped-notification writes", () => {
  it("recordNotificationSkipped helper has dedupe check", () => {
    expect(skipHelperSrc).toMatch(/dedupe|idempotent/i);
    // Existence query against audit_logs guarded by action + entity_id.
    expect(skipHelperSrc).toContain('.eq("action", "notification_skipped")');
    expect(skipHelperSrc).toContain('.eq("entity_id"');
  });

  it("dedupe key spans reason + source_function + channel within day window", () => {
    expect(skipHelperSrc).toContain("reason: args.reason");
    expect(skipHelperSrc).toContain("source_function: args.sourceFunction");
    expect(skipHelperSrc).toContain("channel: args.channel");
    // Day-bucketed window
    expect(skipHelperSrc).toMatch(/dayStartIso|T00:00:00\.000Z/);
  });

  it("dedupe failure does NOT swallow the audit write", () => {
    // The catch around the existence check must fall through to insert.
    expect(skipHelperSrc).toMatch(/dedupe check failed.*continuing to insert/i);
  });
});

describe("NOT-001/006 — Fix 6: HealthBoard manual-follow-up tile", () => {
  it("HealthBoard queries notification_skipped(no_recipient, match.soft_route)", () => {
    expect(healthBoardSrc).toContain('reason: "no_recipient"');
    expect(healthBoardSrc).toContain('source_function: "match.soft_route"');
    expect(healthBoardSrc).toContain('"notification_skipped"');
  });

  it("HealthBoard renders no-recipient outreach tile", () => {
    expect(healthBoardSrc).toContain("healthboard-no-recipient-tile");
    expect(healthBoardSrc).toMatch(/No-Recipient Outreach/);
    expect(healthBoardSrc).toMatch(/manual follow-up required/);
  });
});

describe("NOT-001/006 — UI-003 invariants still hold", () => {
  it("no admin/user surface in poi-engagements claims 'sent' for enqueue-only state", () => {
    // The runtime audit action and snapshot must use queued.
    expect(poiEngSrc).not.toMatch(/p_audit_action:\s*["'][^"']*outreach_email_sent["']/);
  });
});
