/**
 * Batch I1 — payment provider observability guards.
 *
 * Static source-content invariants for the additive observability wired
 * in for tracker items #56 (missing Paystack secret), #78 (invalid
 * Paystack webhook signature), and #46/#54 residual (skeletal
 * paid-credit label repair failure surfacing).
 *
 * These tests DO NOT call real providers, do not mutate money/credits,
 * and do not exercise refund or settlement code paths. They only assert
 * that the observability primitives are wired, that failure-response
 * shape is preserved, and that out-of-scope crediting/refund/settlement
 * logic was not touched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const paystackWebhookSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/paystack-webhook/index.ts'),
  'utf8',
);
const tokenPurchaseSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/token-purchase/index.ts'),
  'utf8',
);
const reconSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/transaction-reconciliation/index.ts'),
  'utf8',
);
const infraAlertsSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/infra-alerts/index.ts'),
  'utf8',
);
const helperSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/payment-observability.ts'),
  'utf8',
);

describe('Batch I1 (#56) — missing Paystack secret observability', () => {
  it('helper writes payment.provider_secret_missing audit', () => {
    expect(helperSrc).toMatch(/payment\.provider_secret_missing/);
  });

  it('helper upserts paystack_secret_missing risk with critical severity', () => {
    expect(helperSrc).toMatch(/paystack_secret_missing/);
    expect(helperSrc).toMatch(/'critical'/);
  });

  it('paystack-webhook records secret missing on missing key path', () => {
    expect(paystackWebhookSrc).toMatch(/recordProviderSecretMissing/);
    expect(paystackWebhookSrc).toMatch(/source:\s*"paystack-webhook"/);
    // Preserves original 500 response and text
    expect(paystackWebhookSrc).toMatch(/"Not configured".*500|status:\s*500/);
  });

  it('token-purchase records secret missing on both checkout and webhook paths', () => {
    expect(tokenPurchaseSrc).toMatch(/recordProviderSecretMissing/);
    expect(tokenPurchaseSrc).toMatch(/"token-purchase\/webhook"/);
    // Checkout still returns PAYMENTS_NOT_CONFIGURED 500
    expect(tokenPurchaseSrc).toMatch(/PAYMENTS_NOT_CONFIGURED/);
  });

  it('transaction-reconciliation records secret missing (no provider call)', () => {
    expect(reconSrc).toMatch(/recordProviderSecretMissing/);
    expect(reconSrc).toMatch(/"transaction-reconciliation"/);
  });
});

describe('Batch I1 (#78) — invalid Paystack webhook signature observability', () => {
  it('helper writes payment.webhook_signature_invalid audit', () => {
    expect(helperSrc).toMatch(/payment\.webhook_signature_invalid/);
  });

  it('paystack-webhook records invalid signature and still returns 401', () => {
    expect(paystackWebhookSrc).toMatch(/recordWebhookSignatureInvalid/);
    expect(paystackWebhookSrc).toMatch(/"Invalid signature"[\s\S]*401|status:\s*401/);
    // Never uses success language on invalid signature
    expect(paystackWebhookSrc).not.toMatch(/"ok"\s*,\s*status:\s*200[\s\S]{0,80}Invalid signature/);
  });

  it('token-purchase webhook records invalid signature and still returns 401', () => {
    expect(tokenPurchaseSrc).toMatch(/recordWebhookSignatureInvalid/);
    // 401 for Invalid signature is still present in the source
    expect(tokenPurchaseSrc).toMatch(/"Invalid signature"[\s\S]*?401/);
  });

  it('helper does NOT store raw payload body or signature value', () => {
    expect(helperSrc).not.toMatch(/body:/);
    expect(helperSrc).not.toMatch(/rawPayload/);
    expect(helperSrc).not.toMatch(/signature:\s*args/);
  });
});

describe('Batch I1 (#46/#54 residual) — skeletal repair failure surfacing', () => {
  it('helper writes payment_ledger_label_repair_failed risk item', () => {
    expect(helperSrc).toMatch(/payment_ledger_label_repair_failed/);
    expect(helperSrc).toMatch(/balances are not changed/);
  });

  it('transaction-reconciliation opens risk item on repair error', () => {
    expect(reconSrc).toMatch(/recordLedgerLabelRepairFailed/);
    // Existing behaviour retained: still captures error string
    expect(reconSrc).toMatch(/results\.skeletal_paid_credit_error\s*=\s*repairErr\.message/);
    expect(reconSrc).toMatch(/results\.errors\.push\(`Skeletal paid-credit repair/);
  });
});

describe('Batch I1 — infra-alerts windows', () => {
  it('has the three new windows', () => {
    expect(infraAlertsSrc).toMatch(/Paystack Secret Missing \(1 hr\)/);
    expect(infraAlertsSrc).toMatch(/Paystack Webhook Signature Invalid \(1 hr\)/);
    expect(infraAlertsSrc).toMatch(/Ledger Label Repair Failed \(24 hr\)/);
  });

  it('each new window is wrapped in try/catch', () => {
    for (const label of [
      'Paystack secret missing check failed',
      'Paystack webhook signature invalid check failed',
      'Ledger label repair failure check failed',
    ]) {
      expect(infraAlertsSrc).toContain(label);
    }
  });

  it('uses correct thresholds for each new window', () => {
    expect(infraAlertsSrc).toMatch(/payment\.provider_secret_missing[\s\S]*?warning >=1, critical >=1/);
    expect(infraAlertsSrc).toMatch(/payment\.webhook_signature_invalid[\s\S]*?warning >=5, critical >=20/);
    expect(infraAlertsSrc).toMatch(/payment_ledger_label_repair_failed[\s\S]*?warning >=1, critical >=5/);
  });
});

describe('Batch I1 — out-of-scope containment', () => {
  it('does not modify atomic_paid_credit_purchase call sites', () => {
    // Sanity: reconciliation still calls atomic_paid_credit_purchase for
    // stale-payment recovery and I1 must not have altered that.
    expect(reconSrc).toMatch(/atomic_paid_credit_purchase/);
  });

  it('does not introduce any new provider HTTP fetch calls', () => {
    // I1 helper is pure observability — no fetch to Paystack/PayFast.
    expect(helperSrc).not.toMatch(/api\.paystack/i);
    expect(helperSrc).not.toMatch(/api\.payfast/i);
    expect(helperSrc).not.toMatch(/fetch\(/);
  });

  it('helper never mutates balances or ledger', () => {
    expect(helperSrc).not.toMatch(/token_balances/);
    expect(helperSrc).not.toMatch(/token_ledger/);
    expect(helperSrc).not.toMatch(/atomic_token_credit/);
    expect(helperSrc).not.toMatch(/atomic_token_burn/);
    expect(helperSrc).not.toMatch(/atomic_paid_credit_purchase/);
  });

  it('helper never opens a settlement mismatch risk (out of scope for I1)', () => {
    expect(helperSrc).not.toMatch(/settlement_mismatch/);
    expect(helperSrc).not.toMatch(/refund/i);
  });
});
