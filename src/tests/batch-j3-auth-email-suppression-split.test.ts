/**
 * Batch J3 / tracker item #22 — auth email suppression split approach.
 *
 * Static contract tests (file-content scans only). No runtime, no provider
 * calls, no queue mutations.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

const HELPER = "supabase/functions/_shared/auth-email-suppression.ts";
const HOOK = "supabase/functions/auth-email-hook/index.ts";
const QUEUE = "supabase/functions/process-email-queue/index.ts";

describe("Batch J3 shared helper — auth email suppression split", () => {
  const src = read(HELPER);

  it("classifies security-critical templates: recovery, email_change, reauthentication", () => {
    for (const t of ["recovery", "email_change", "reauthentication"]) {
      expect(src).toMatch(new RegExp(`['"\`]${t}['"\`]`));
    }
    expect(src).toMatch(/AUTH_SECURITY_CRITICAL_TEMPLATES/);
  });

  it("classifies non-critical templates: signup, invite, magiclink", () => {
    for (const t of ["signup", "invite", "magiclink"]) {
      expect(src).toMatch(new RegExp(`['"\`]${t}['"\`]`));
    }
    expect(src).toMatch(/AUTH_NON_CRITICAL_TEMPLATES/);
  });

  it("exports the disclaimer text on the approved security-critical path only", () => {
    expect(src).toMatch(/AUTH_SECURITY_DISCLAIMER_TEXT/);
    expect(src).toMatch(/essential account-security email/);
    expect(src).toMatch(/suppressed or unsubscribed/);
    expect(src).toMatch(/injectSecurityDisclaimerHtml/);
    expect(src).toMatch(/injectSecurityDisclaimerText/);
  });

  it("exports the three disposition outcomes", () => {
    expect(src).toMatch(/['"]send['"]/);
    expect(src).toMatch(/['"]send_with_disclaimer['"]/);
    expect(src).toMatch(/['"]suppress['"]/);
  });

  it("exports the audit/risk marker constants used by hook and queue", () => {
    expect(src).toMatch(/AUDIT_ACTION_AUTH_SUPPRESSED\s*=\s*['"]email\.auth_suppressed['"]/);
    expect(src).toMatch(
      /AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER\s*=\s*['"]email\.auth_security_sent_with_disclaimer['"]/,
    );
    expect(src).toMatch(
      /RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT\s*=\s*['"]auth_email_to_suppressed_recipient['"]/,
    );
  });

  it("evaluator reads suppressed_emails and does not mutate it", () => {
    expect(src).toMatch(/from\(['"]suppressed_emails['"]\)/);
    expect(src).not.toMatch(/from\(['"]suppressed_emails['"]\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/from\(['"]email_unsubscribe_tokens['"]\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/);
  });
});

describe("Batch J3 auth-email-hook — pre-enqueue suppression split", () => {
  const src = read(HOOK);

  it("imports the shared evaluator and disclaimer helpers", () => {
    expect(src).toMatch(/evaluateAuthEmailSuppression/);
    expect(src).toMatch(/injectSecurityDisclaimerHtml/);
    expect(src).toMatch(/injectSecurityDisclaimerText/);
  });

  it("checks suppression before calling enqueue_email", () => {
    const evalIdx = src.indexOf("evaluateAuthEmailSuppression(");
    const enqIdx = src.indexOf("enqueue_email");
    expect(evalIdx).toBeGreaterThan(0);
    expect(enqIdx).toBeGreaterThan(evalIdx);
  });

  it("suppress branch: does NOT enqueue and logs status=suppressed", () => {
    expect(src).toMatch(
      /disposition\s*===\s*['"]suppress['"][\s\S]{0,1200}status:\s*['"]suppressed['"]/,
    );
    // Between the suppress branch and the return, no enqueue_email call
    const suppressSlice = src.slice(
      src.indexOf("disposition === 'suppress'"),
      src.indexOf("send_with_disclaimer"),
    );
    expect(suppressSlice).not.toMatch(/enqueue_email/);
  });

  it("suppress branch emits audit action and risk item markers", () => {
    expect(src).toMatch(/AUDIT_ACTION_AUTH_SUPPRESSED/);
    expect(src).toMatch(/RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT/);
  });

  it("send_with_disclaimer branch injects disclaimer into html AND text", () => {
    expect(src).toMatch(/injectSecurityDisclaimerHtml\(/);
    expect(src).toMatch(/injectSecurityDisclaimerText\(/);
    expect(src).toMatch(/AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER/);
  });
});

describe("Batch J3 process-email-queue — pre-provider suppression split", () => {
  const src = read(QUEUE);

  it("imports the shared evaluator and disclaimer helpers", () => {
    expect(src).toMatch(/from\s+['"]\.\.\/_shared\/auth-email-suppression\.ts['"]/);
    expect(src).toMatch(/evaluateAuthEmailSuppression/);
  });

  it("gates auth messages against suppression BEFORE sendLovableEmail", () => {
    const evalIdx = src.indexOf("evaluateAuthEmailSuppression(");
    const sendIdx = src.indexOf("sendLovableEmail(");
    expect(evalIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(evalIdx);
  });

  it("suppressed non-critical auth message is deleted from queue and never sent", () => {
    // suppress branch uses `continue` and delete_email — never falls through to send
    expect(src).toMatch(
      /disposition\s*===\s*['"]suppress['"][\s\S]{0,4000}delete_email[\s\S]{0,400}continue/,
    );
  });

  it("suppress branch logs status=suppressed and emits audit + risk observability", () => {
    expect(src).toMatch(/status:\s*['"]suppressed['"]/);
    expect(src).toMatch(/AUDIT_ACTION_AUTH_SUPPRESSED/);
    expect(src).toMatch(/RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT/);
  });

  it("security-critical suppressed path injects disclaimer into html + text before send", () => {
    expect(src).toMatch(/injectSecurityDisclaimerHtml\(payload\.html\)/);
    expect(src).toMatch(/injectSecurityDisclaimerText\(payload\.text\)/);
    // sendLovableEmail must consume the potentially-rewritten html/text vars
    expect(src).toMatch(/html:\s*sendHtml/);
    expect(src).toMatch(/text:\s*sendText/);
  });

  it("preserves Batch H #47 send timeout and #18 DLQ observability", () => {
    expect(src).toMatch(/withSendTimeout\(/);
    expect(src).toMatch(/SEND_TIMEOUT_MS\s*=\s*20_?000/);
    expect(src).toMatch(/kind:\s*['"]auth_email_dead_lettered['"]/);
    expect(src).toMatch(/action:\s*['"]email\.dead_lettered['"]/);
  });

  it("does not mutate suppressed_emails / email_unsubscribe_tokens", () => {
    expect(src).not.toMatch(/from\(['"]suppressed_emails['"]\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/from\(['"]email_unsubscribe_tokens['"]\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/);
  });
});
