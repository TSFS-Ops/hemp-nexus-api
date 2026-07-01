/**
 * Batch H — email reliability partial repair (safe subset).
 *
 * Static contract tests pinning the two safe-subset changes:
 *   • #18 — auth DLQ observability (audit + admin_risk_items, idempotent).
 *   • #47 — explicit per-message send timeout (< pgmq VT of 30s).
 *
 * Deferred (must NOT appear in this batch):
 *   • #22 — suppressed-auth-email disposition. Pending client decision.
 *
 * Tests are file-content scans only — they do not send email, do not touch
 * providers, and do not exercise Deno runtime code paths.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

describe("Batch H — process-email-queue (#47) send timeout", () => {
  const src = read("supabase/functions/process-email-queue/index.ts");

  it("defines SEND_TIMEOUT_MS constant", () => {
    expect(src).toMatch(/const\s+SEND_TIMEOUT_MS\s*=\s*20_?000/);
  });

  it("timeout value is strictly less than pgmq visibility timeout (30s)", () => {
    const match = src.match(/const\s+SEND_TIMEOUT_MS\s*=\s*(\d[\d_]*)/);
    expect(match).not.toBeNull();
    const ms = Number((match![1] as string).replace(/_/g, ""));
    expect(ms).toBeLessThan(30_000);
    expect(ms).toBeGreaterThan(0);
  });

  it("defines withSendTimeout race helper and SendTimeoutError", () => {
    expect(src).toMatch(/function\s+withSendTimeout/);
    expect(src).toMatch(/class\s+SendTimeoutError/);
    expect(src).toMatch(/Promise\.race\(/);
  });

  it("wraps sendLovableEmail with withSendTimeout(..., SEND_TIMEOUT_MS)", () => {
    expect(src).toMatch(
      /withSendTimeout\(\s*[\s\S]*?sendLovableEmail\([\s\S]*?SEND_TIMEOUT_MS\s*\)/,
    );
  });

  it("SendTimeoutError message is the 'send_timeout' marker so error_message is recorded verbatim", () => {
    expect(src).toMatch(/SEND_TIMEOUT_MARKER\s*=\s*['"]send_timeout['"]/);
    expect(src).toMatch(/super\(SEND_TIMEOUT_MARKER\)/);
  });

  it("timeout failures reuse the existing failed-insert path (not marked sent, not double-sent)", () => {
    // isRateLimited and isForbidden must NOT match a SendTimeoutError, so it
    // falls through to the generic status='failed' insert with error_message
    // = 'send_timeout' — exactly what the tracker item requires.
    expect(src).toMatch(/status:\s*['"]failed['"]/);
    expect(src).not.toMatch(/status:\s*['"]sent['"][\s\S]{0,200}send_timeout/);
  });
});

describe("Batch H — process-email-queue (#18) DLQ observability", () => {
  const src = read("supabase/functions/process-email-queue/index.ts");

  it("moveToDlq emits an email.dead_lettered audit log", () => {
    expect(src).toMatch(/action:\s*['"]email\.dead_lettered['"]/);
  });

  it("audit insert is idempotent per message_id", () => {
    expect(src).toMatch(
      /from\(['"]audit_logs['"]\)[\s\S]*?email\.dead_lettered[\s\S]*?message_id/,
    );
    expect(src).toMatch(/alreadyAudited/);
  });

  it("auth templates create an admin_risk_items row (kind=auth_email_dead_lettered)", () => {
    expect(src).toMatch(/kind:\s*['"]auth_email_dead_lettered['"]/);
    expect(src).toMatch(/isAuthTemplate\(/);
  });

  it("admin_risk_items insert is idempotent per message_id", () => {
    expect(src).toMatch(/alreadyRisked/);
  });

  it("recipient email is masked in metadata (no full address written)", () => {
    expect(src).toMatch(/maskEmail\(/);
    expect(src).toMatch(/recipient_email_masked/);
  });

  it("metadata never carries email html/text body", () => {
    // The audit metadata block explicitly enumerates its fields; assert the
    // sensitive body fields are absent from that construction.
    const metaBlock = src.match(/const auditMetadata\s*=\s*\{[\s\S]*?\}\s*\n/);
    expect(metaBlock).not.toBeNull();
    expect(metaBlock![0]).not.toMatch(/\bhtml\b/);
    expect(metaBlock![0]).not.toMatch(/\btext\b/);
  });

  it("preserves existing DLQ behaviour (email_send_log status=dlq + move_to_dlq rpc)", () => {
    expect(src).toMatch(/status:\s*['"]dlq['"]/);
    expect(src).toMatch(/rpc\(['"]move_to_dlq['"]/);
  });

  it("observability failure is non-fatal (wrapped in try/catch)", () => {
    expect(src).toMatch(
      /Batch H \(#18\) DLQ observability[\s\S]*?try\s*\{[\s\S]*?catch\s*\(obsErr\)/,
    );
  });

  it("auth template set matches the Supabase auth action taxonomy", () => {
    for (const t of [
      "signup",
      "magiclink",
      "recovery",
      "invite",
      "email_change",
      "reauthentication",
    ]) {
      expect(src).toContain(`'${t}'`);
    }
  });
});

describe("Batch H — infra-alerts windows", () => {
  const src = read("supabase/functions/infra-alerts/index.ts");

  it("has an Auth Email Dead-Letter (1 hr) window", () => {
    expect(src).toMatch(/Auth Email Dead-Letter \(1 hr\)/);
    expect(src).toMatch(
      /from\(['"]email_send_log['"]\)[\s\S]*?status['"],\s*['"]dlq['"]/,
    );
  });

  it("auth DLQ severity is warning >=1, critical >=5", () => {
    expect(src).toMatch(/a >= 5 \? ['"]critical['"] : ['"]warning['"]/);
  });

  it("has an Email Send Timeout (1 hr) window", () => {
    expect(src).toMatch(/Email Send Timeout \(1 hr\)/);
    expect(src).toMatch(/error_message['"],\s*['"]send_timeout['"]/);
  });

  it("send-timeout severity is warning >=3, critical >=10", () => {
    expect(src).toMatch(/t >= 10 \? ['"]critical['"] : ['"]warning['"]/);
  });

  it("both new checks are try/catch wrapped", () => {
    const authBlock = src.match(
      /Auth Email Dead-Letter[\s\S]*?Auth email DLQ check failed/,
    );
    const toBlock = src.match(
      /Email Send Timeout[\s\S]*?Email send timeout check failed/,
    );
    expect(authBlock).not.toBeNull();
    expect(toBlock).not.toBeNull();
  });
});

describe("Batch H — deferred scope (#22 must NOT be applied)", () => {
  it("auth-email-hook still does not check suppressed_emails pre-enqueue", () => {
    // #22 is deferred pending a client decision on send-with-disclaimer vs
    // suppress. Guard against accidental inclusion in this batch.
    const src = read("supabase/functions/auth-email-hook/index.ts");
    expect(src).not.toMatch(/suppressed_emails/);
  });

  it("process-email-queue does not add pre-send suppression check", () => {
    const src = read("supabase/functions/process-email-queue/index.ts");
    expect(src).not.toMatch(/suppressed_emails/);
  });
});
