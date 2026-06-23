/**
 * Guard tests for engagement-reminder notification insert schema/code mismatch fix.
 *
 * Asserts the edge function source:
 *  - imports and uses resolveAdminRecipients
 *  - routes engagement reminders to real platform_admin user_ids (no null user_id)
 *  - uses `body` (not `message`) in the notifications insert
 *  - does NOT include a `metadata` field in the notifications insert
 *  - skips insert and records routing_failed when no admin recipients exist
 *  - preserves the (entity_id, user_id) duplicate-prevention pre-filter
 *  - preserves the 23505 duplicate-skip fallback
 *  - introduces no external send paths (email/sms/whatsapp/webhook/provider)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "supabase/functions/engagement-reminder/index.ts"),
  "utf8",
);

// Extract the notifications.push({...}) literal that builds an in-app reminder row.
function extractReminderRowLiteral(): string {
  const start = SRC.indexOf("notifications.push({");
  expect(start, "notifications.push({...}) literal must exist").toBeGreaterThan(-1);
  // Find matching closing brace+paren.
  let depth = 0;
  for (let i = start + "notifications.push(".length; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 2);
    }
  }
  throw new Error("Could not find end of notifications.push literal");
}

describe("engagement-reminder notification insert schema/code mismatch fix", () => {
  it("imports resolveAdminRecipients from the shared helper", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*resolveAdminRecipients\s*\}\s*from\s*["']\.\.\/_shared\/admin-recipients\.ts["']/,
    );
  });

  it("calls resolveAdminRecipients with an engagement.reminder routing key", () => {
    expect(SRC).toMatch(/resolveAdminRecipients\(\s*supabase\s*,\s*["']engagement\.reminder["']\s*\)/);
  });

  it("notification row literal uses real user_id (no `user_id: null`)", () => {
    const lit = extractReminderRowLiteral();
    expect(lit).toMatch(/user_id:\s*r\.userId/);
    expect(lit).not.toMatch(/user_id:\s*null/);
  });

  it("notification row literal uses `body`, not `message`", () => {
    const lit = extractReminderRowLiteral();
    expect(lit).toMatch(/\bbody:\s*`/);
    expect(lit).not.toMatch(/\bmessage:\s*/);
  });

  it("notification row literal contains no `metadata` field", () => {
    const lit = extractReminderRowLiteral();
    expect(lit).not.toMatch(/\bmetadata:\s*/);
  });

  it("skips notification insert and records routing_failed when no admin recipients", () => {
    expect(SRC).toMatch(/routingFailed\s*=\s*adminRouting\.routingFailed\s*\|\|\s*adminRecipients\.length\s*===\s*0/);
    expect(SRC).toMatch(/routing_failed:\s*true/);
    // The routing_failed=true branch must NOT perform a notifications insert.
    const failedBranch = SRC.split("else if (routingFailed)")[1]?.split("} else {")[0] ?? "";
    expect(failedBranch).not.toMatch(/from\(["']notifications["']\)\s*\.insert/);
  });

  it("preserves (entity_id, user_id) duplicate-prevention pre-filter against the partial unique index", () => {
    expect(SRC).toMatch(/\.select\(["']entity_id,\s*user_id["']\)/);
    expect(SRC).toMatch(/\.in\(["']entity_id["']\s*,\s*stillStaleIds\)/);
    expect(SRC).toMatch(/\.in\(["']user_id["']\s*,\s*recipientIds\)/);
  });

  it("preserves the 23505 unique-violation per-row fallback", () => {
    expect(SRC).toMatch(/code === "23505"/);
    expect(SRC).toMatch(/duplicate key\|unique constraint/);
  });

  it("introduces no external send paths (email / sms / whatsapp / webhook / provider)", () => {
    expect(SRC).not.toMatch(/\b(resend|sendgrid|twilio|whatsapp|webhook_endpoints|notification-dispatch|send-transactional-email)\b/i);
    // fetch() to outbound providers must not be added by this fix.
    expect(SRC).not.toMatch(/fetch\(["']https?:\/\//);
  });
});
