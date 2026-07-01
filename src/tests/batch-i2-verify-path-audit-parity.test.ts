/**
 * Batch I2 — verify-path post-credit audit/event/notification parity.
 *
 * Source-level static contract guards. No provider calls, no DB writes,
 * no Deno runtime. Locks the additive verify-path repair against
 * regressions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TP = readFileSync(
  resolve(__dirname, "../../supabase/functions/token-purchase/index.ts"),
  "utf8",
);
const OBS = readFileSync(
  resolve(__dirname, "../../supabase/functions/_shared/payment-observability.ts"),
  "utf8",
);

function verifySlice(): string {
  const start = TP.indexOf('path === "verify"');
  const end = TP.indexOf("// All other endpoints require authentication", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return TP.slice(start, end);
}

function webhookSlice(): string {
  const start = TP.indexOf("async function handleWebhook");
  expect(start).toBeGreaterThan(0);
  return TP.slice(start);
}

describe("Batch I2 — payment-observability helpers exported", () => {
  it("exports the three new verify-path helpers", () => {
    expect(OBS).toMatch(/export async function recordVerifyPostCreditAuditFailed\b/);
    expect(OBS).toMatch(/export async function recordVerifyPostCreditEventFailed\b/);
    expect(OBS).toMatch(/export async function recordVerifyRevenueNotificationFailed\b/);
  });

  it("uses reference-scoped dedup keys and correct severities", () => {
    expect(OBS).toContain("`payment_verify_post_credit_audit_failed:${args.reference}`");
    expect(OBS).toContain("`payment_verify_post_credit_event_failed:${args.reference}`");
    expect(OBS).toContain("`payment_verify_revenue_notification_failed:${args.reference}`");
    expect(OBS).toMatch(/'payment_verify_post_credit_audit_failed',\s*`payment_verify_post_credit_audit_failed:\$\{args\.reference\}`,\s*'high'/);
    expect(OBS).toMatch(/'payment_verify_post_credit_event_failed',\s*`payment_verify_post_credit_event_failed:\$\{args\.reference\}`,\s*'high'/);
    expect(OBS).toMatch(/'payment_verify_revenue_notification_failed',\s*`payment_verify_revenue_notification_failed:\$\{args\.reference\}`,\s*'medium'/);
  });

  it("emits best-effort audit rows for all three verify-path failures", () => {
    expect(OBS).toContain("'payment.verify_post_credit_audit_failed'");
    expect(OBS).toContain("'payment.verify_post_credit_event_failed'");
    expect(OBS).toContain("'payment.verify_revenue_notification_failed'");
  });
});

describe("Batch I2 — token-purchase imports the new helpers", () => {
  it("imports all three helpers alongside Batch I1 helpers", () => {
    expect(TP).toMatch(/recordVerifyPostCreditAuditFailed[\s\S]*from "\.\.\/_shared\/payment-observability\.ts"/);
    expect(TP).toContain("recordVerifyPostCreditEventFailed");
    expect(TP).toContain("recordVerifyRevenueNotificationFailed");
  });
});

describe("Batch I2 — verify branch parity with webhook", () => {
  it("writes payment.event_created with source_function=token-purchase/verify", () => {
    const s = verifySlice();
    expect(s).toContain("writeCriticalEventWithPosture(");
    expect(s).toContain('event_type: "payment.event_created"');
    expect(s).toContain('source_function: "token-purchase/verify"');
    expect(s).toMatch(/idempotency_extra:\s*reference/);
  });

  it("does not throw on non-23505 audit failure after successful credit", () => {
    const s = verifySlice();
    // The old fail-open throw must be gone.
    expect(s).not.toContain('if (auditErr && auditErr.code !== "23505") throw auditErr');
    // The new path calls the observability helper instead.
    expect(s).toContain("recordVerifyPostCreditAuditFailed(supabase, {");
    // 23505 duplicate tolerance is preserved.
    expect(s).toMatch(/auditErr\?\.code === "23505"/);
  });

  it("tolerates duplicate/idempotent event conflict from webhook↔verify race", () => {
    const s = verifySlice();
    expect(s).toMatch(/duplicate\|23505\|already exists\|idempoten/);
    expect(s).toContain("recordVerifyPostCreditEventFailed(supabase, {");
  });

  it("wraps emitRevenueNotification in try/catch and records risk on failure", () => {
    const s = verifySlice();
    expect(s).toContain("emitRevenueNotification(supabase, {");
    expect(s).toContain("recordVerifyRevenueNotificationFailed(supabase, {");
    expect(s).toMatch(/catch\s*\(\s*notifyErr\s*\)/);
  });


  it("keeps atomic_paid_credit_purchase call signature unchanged in verify", () => {
    const s = verifySlice();
    expect(s).toContain('supabase.rpc("atomic_paid_credit_purchase", {');
    expect(s).toContain('p_endpoint: "payment:paystack:verify"');
    expect(s).toContain("p_reference_id: reference");
    expect(s).toContain("p_amount: credits");
    expect(s).toContain("p_org_id: orgId");
  });
});

describe("Batch I2 — webhook branch unchanged", () => {
  it("still fail-closes on credits.purchased audit failure (Paystack retry)", () => {
    const w = webhookSlice();
    expect(w).toContain('throw new Error(`AUDIT_WRITE_FAILED:');
    expect(w).toContain('throw new Error(`GOV_AUDIT_WRITE_FAILED:');
  });

  it("still writes payment.event_created with source_function=token-purchase/webhook", () => {
    const w = webhookSlice();
    expect(w).toContain('source_function: "token-purchase/webhook"');
  });
});

describe("Batch I2 — non-change guarantees", () => {
  it("adds no new Paystack provider fetch URLs", () => {
    const provider = TP.match(/https:\/\/api\.paystack\.co\/[^"'\s`)]+/g) ?? [];
    // Existing surfaces: transaction/initialize + transaction/verify/. Nothing new.
    const unique = Array.from(new Set(provider.map((u) => u.replace(/\/[A-Za-z0-9_-]+$/, "/"))));
    expect(unique.sort()).toEqual([
      "https://api.paystack.co/transaction/",
      "https://api.paystack.co/transaction/verify/",
    ].sort());
  });

  it("does not introduce refund or settlement-mismatch mutation in the helper", () => {
    expect(OBS).not.toMatch(/refund|settlement_mismatch|atomic_paid_credit_purchase|atomic_token_(credit|burn)|token_balances|token_ledger/);
  });
});
