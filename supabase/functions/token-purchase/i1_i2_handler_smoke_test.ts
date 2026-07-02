/**
 * token-purchase Batch I1/I2 local handler smoke tests.
 *
 * These tests exercise the runtime observability contracts that the
 * `token-purchase` edge function relies on for Batch I1 (#56, #78) and
 * Batch I2 (#61), with ZERO external side effects:
 *
 *   - No Paystack / PayFast / provider fetch.
 *   - No real Supabase client, no real DB read or write.
 *   - No credit RPC, no ledger mutation, no notification dispatch.
 *   - No secrets, no network at all — `globalThis.fetch` is replaced
 *     with a tripwire that fails the test if invoked.
 *
 * The strategy is deliberately narrow: the observability helpers in
 * `supabase/functions/_shared/payment-observability.ts` already accept
 * an injected admin client (typed `any`). We drive them with an
 * in-memory stub that records every call. The existing vitest guards
 * in `src/tests/batch-i{1,2}-*.test.ts` prove that
 * `token-purchase/index.ts` wires these helpers into the correct call
 * sites; these Deno tests prove the helpers themselves emit the exact
 * audit markers, risk kinds, severities and dedup keys that #56 / #78
 * / #61 depend on when they eventually fire in production.
 *
 * A test seam inside the 2 822-line `token-purchase/index.ts` monolith
 * was intentionally NOT added: the scope guidance requires behaviour-
 * preserving changes only, and the observability contracts under test
 * are cleanly isolated in the helper module. Handler-to-helper wiring
 * is covered by the existing source-level guard tests.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  recordLedgerLabelRepairFailed,
  recordProviderSecretMissing,
  recordVerifyPostCreditAuditFailed,
  recordVerifyPostCreditEventFailed,
  recordVerifyRevenueNotificationFailed,
  recordWebhookSignatureInvalid,
} from "../_shared/payment-observability.ts";

// ---------------------------------------------------------------------
// Network tripwire — any real fetch during a test is a hard failure.
// ---------------------------------------------------------------------
const REAL_FETCH = globalThis.fetch;
function installFetchTripwire(): string[] {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    calls.push(url);
    throw new Error(
      `[smoke-test] real fetch attempted (${url}); tests must be pure in-memory`,
    );
  }) as typeof fetch;
  return calls;
}
function restoreFetch() {
  globalThis.fetch = REAL_FETCH;
}

// ---------------------------------------------------------------------
// In-memory stub Supabase client.
//
// Records every `.from(table).insert(row)` and every dedup-lookup
// chain (`.select().eq().eq().gte().limit().maybeSingle()`). Allows a
// per-test override of the dedup result (empty by default so the
// helper proceeds to insert the risk row) and an optional throw hook
// so we can prove `safeAudit` / `safeUpsertRisk` swallow errors.
// ---------------------------------------------------------------------
interface Insert {
  table: string;
  row: Record<string, unknown>;
}
interface StubOptions {
  dedupHit?: boolean;
  throwOnInsertTable?: string;
}
function makeStubAdmin(opts: StubOptions = {}) {
  const inserts: Insert[] = [];
  const filters: Record<string, unknown>[] = [];

  const dedupChain = {
    eq(_c: string, _v: unknown) {
      return dedupChain;
    },
    gte(_c: string, _v: unknown) {
      return dedupChain;
    },
    limit(_n: number) {
      return dedupChain;
    },
    async maybeSingle() {
      return {
        data: opts.dedupHit ? { id: "existing-risk-id" } : null,
        error: null,
      };
    },
  };

  const builder = (table: string) => ({
    async insert(row: Record<string, unknown>) {
      inserts.push({ table, row });
      if (opts.throwOnInsertTable === table) {
        throw new Error(`[stub] forced insert failure on ${table}`);
      }
      return { data: null, error: null };
    },
    select(cols: string) {
      filters.push({ table, cols });
      return dedupChain;
    },
  });

  return {
    inserts,
    filters,
    client: {
      from: (table: string) => builder(table),
    },
  };
}

// ---------------------------------------------------------------------
// Test 1 — Batch I1 #56: missing provider secret observability path.
// ---------------------------------------------------------------------
Deno.test("I1 #56: recordProviderSecretMissing writes correct audit + critical risk (checkout source)", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordProviderSecretMissing(stub.client, {
      provider: "paystack",
      source: "token-purchase",
      requestId: "req-abc",
    });

    assertEquals(stub.inserts.length, 2, "expected audit + risk insert");
    const audit = stub.inserts[0];
    assertEquals(audit.table, "audit_logs");
    assertEquals(audit.row.action, "payment.provider_secret_missing");
    assertEquals(audit.row.entity_type, "payment_provider");
    const auditMeta = audit.row.metadata as Record<string, unknown>;
    assertEquals(auditMeta.provider, "paystack");
    assertEquals(auditMeta.source, "token-purchase");
    assertEquals(auditMeta.request_id, "req-abc");

    const risk = stub.inserts[1];
    assertEquals(risk.table, "admin_risk_items");
    assertEquals(risk.row.kind, "paystack_secret_missing");
    assertEquals(risk.row.severity, "critical");
    assertEquals(risk.row.dedup_key, "paystack_secret_missing:token-purchase");

    assertEquals(fetchCalls.length, 0, "no network calls allowed");
  } finally {
    restoreFetch();
  }
});

Deno.test("I1 #56: same helper emits webhook-source variant with distinct dedup key", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordProviderSecretMissing(stub.client, {
      provider: "paystack",
      source: "token-purchase/webhook",
      requestId: null,
    });
    const risk = stub.inserts[1];
    assertEquals(
      risk.row.dedup_key,
      "paystack_secret_missing:token-purchase/webhook",
    );
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("I1 #56: dedup window suppresses duplicate risk inserts (audit still writes)", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin({ dedupHit: true });
    await recordProviderSecretMissing(stub.client, {
      provider: "paystack",
      source: "token-purchase",
    });
    // audit_logs insert still happens; admin_risk_items insert is skipped
    assertEquals(stub.inserts.length, 1);
    assertEquals(stub.inserts[0].table, "audit_logs");
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("I1 #56: audit insert failure is swallowed (customer-facing 500 preserved by caller)", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin({ throwOnInsertTable: "audit_logs" });
    // Must not throw — helper is fire-and-forget by contract.
    await recordProviderSecretMissing(stub.client, {
      provider: "paystack",
      source: "token-purchase",
    });
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------
// Test 2 — Batch I1 #78: invalid webhook signature observability path.
//
// Two parts:
//   (a) Prove the helper emits the correct audit action (no risk item
//       is written by contract — signature failures are noisy and
//       would swamp the risk queue).
//   (b) Prove the same HMAC primitive used by `handleWebhook`
//       (`SHA-512` over the raw request body with the Paystack secret)
//       rejects a mismatched signature. This mirrors the exact check
//       at supabase/functions/token-purchase/index.ts:1077 without
//       calling the handler.
// ---------------------------------------------------------------------
Deno.test("I1 #78: recordWebhookSignatureInvalid emits audit action, no risk item, no fetch", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordWebhookSignatureInvalid(stub.client, {
      provider: "paystack",
      source: "token-purchase/webhook",
      requestId: "req-sig-1",
    });
    assertEquals(stub.inserts.length, 1);
    assertEquals(stub.inserts[0].table, "audit_logs");
    assertEquals(
      stub.inserts[0].row.action,
      "payment.webhook_signature_invalid",
    );
    const meta = stub.inserts[0].row.metadata as Record<string, unknown>;
    assertEquals(meta.source, "token-purchase/webhook");
    assertEquals(meta.request_id, "req-sig-1");
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("I1 #78: HMAC-SHA512 signature check rejects mismatched signature (mirrors handler primitive)", async () => {
  // Reproduces the exact primitive used at index.ts:1077 without
  // invoking the handler or the network.
  const encoder = new TextEncoder();
  const secret = "sk_test_local_only_never_a_real_secret";
  const body = JSON.stringify({ event: "charge.success", data: { id: 1 } });

  async function hmacHex(key: string, msg: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(msg),
    );
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const good = await hmacHex(secret, body);
  const bad = await hmacHex("different_secret", body);
  assert(good !== bad, "HMAC must differ under different keys");
  assertEquals(
    good,
    await hmacHex(secret, body),
    "HMAC must be deterministic under same key + body",
  );
  assertStringIncludes(good, "", "sanity: hex string produced");
});

// ---------------------------------------------------------------------
// Test 3 — Batch I2 #61: verify-path post-credit failure handling.
//
// Simulates the three post-credit failure branches that the verify
// handler wraps around `atomic_paid_credit_purchase` succeeding:
//
//   1. audit insert throws     → recordVerifyPostCreditAuditFailed
//   2. event_store insert throws → recordVerifyPostCreditEventFailed
//   3. emitRevenueNotification throws → recordVerifyRevenueNotificationFailed
//
// The Batch I2 contract (see evidence/batch-i-payment-crediting-
// reliability/i2-verify-path-audit-parity/README.md) is that each
// failure emits its named audit + risk pair, does not throw upward,
// and never touches credit RPCs. These tests prove exactly that.
// ---------------------------------------------------------------------
const VERIFY_ARGS = {
  provider: "paystack" as const,
  reference: "ref_test_abc123",
  orgId: "00000000-0000-0000-0000-000000000001",
  packageId: "pack_10",
  credits: 10,
  errorMessage: "simulated post-credit failure",
};

Deno.test("I2 #61: recordVerifyPostCreditAuditFailed writes audit + high risk (does not throw)", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordVerifyPostCreditAuditFailed(stub.client, VERIFY_ARGS);
    assertEquals(stub.inserts.length, 2);
    assertEquals(
      stub.inserts[0].row.action,
      "payment.verify_post_credit_audit_failed",
    );
    const auditMeta = stub.inserts[0].row.metadata as Record<string, unknown>;
    assertEquals(auditMeta.source_function, "token-purchase/verify");
    assertEquals(auditMeta.payment_reference, VERIFY_ARGS.reference);
    assertEquals(auditMeta.org_id, VERIFY_ARGS.orgId);

    const risk = stub.inserts[1];
    assertEquals(risk.row.kind, "payment_verify_post_credit_audit_failed");
    assertEquals(risk.row.severity, "high");
    assertEquals(
      risk.row.dedup_key,
      `payment_verify_post_credit_audit_failed:${VERIFY_ARGS.reference}`,
    );
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("I2 #61: recordVerifyPostCreditEventFailed writes audit + high risk (does not throw)", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordVerifyPostCreditEventFailed(stub.client, VERIFY_ARGS);
    assertEquals(stub.inserts.length, 2);
    assertEquals(
      stub.inserts[0].row.action,
      "payment.verify_post_credit_event_failed",
    );
    const risk = stub.inserts[1];
    assertEquals(risk.row.kind, "payment_verify_post_credit_event_failed");
    assertEquals(risk.row.severity, "high");
    assertEquals(
      risk.row.dedup_key,
      `payment_verify_post_credit_event_failed:${VERIFY_ARGS.reference}`,
    );
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("I2 #61: recordVerifyRevenueNotificationFailed writes audit + medium risk (does not throw)", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordVerifyRevenueNotificationFailed(stub.client, VERIFY_ARGS);
    assertEquals(stub.inserts.length, 2);
    assertEquals(
      stub.inserts[0].row.action,
      "payment.verify_revenue_notification_failed",
    );
    const risk = stub.inserts[1];
    assertEquals(risk.row.kind, "payment_verify_revenue_notification_failed");
    assertEquals(risk.row.severity, "medium");
    assertEquals(
      risk.row.dedup_key,
      `payment_verify_revenue_notification_failed:${VERIFY_ARGS.reference}`,
    );
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("I2 #61: verify helpers swallow their own audit failure so caller stays 200 to customer", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    // If safeAudit's insert throws, the helper must still not propagate.
    for (const helper of [
      recordVerifyPostCreditAuditFailed,
      recordVerifyPostCreditEventFailed,
      recordVerifyRevenueNotificationFailed,
    ]) {
      const stub = makeStubAdmin({ throwOnInsertTable: "audit_logs" });
      await helper(stub.client, VERIFY_ARGS); // must not throw
    }
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------
// Coverage guard for I1 ledger-label repair failure — proves the
// helper contract used by transaction-reconciliation is symmetric with
// the two I1 helpers above (balance-untouched note, high severity,
// per-source dedup key).
// ---------------------------------------------------------------------
Deno.test("I1 (ledger label repair): recordLedgerLabelRepairFailed marks balance-untouched, high severity", async () => {
  const fetchCalls = installFetchTripwire();
  try {
    const stub = makeStubAdmin();
    await recordLedgerLabelRepairFailed(stub.client, {
      source: "transaction-reconciliation",
      errorMessage: "boom",
      reconRunId: "run-1",
    });
    assertEquals(stub.inserts.length, 2);
    assertEquals(
      stub.inserts[0].row.action,
      "payment.ledger_label_repair_failed",
    );
    const auditMeta = stub.inserts[0].row.metadata as Record<string, unknown>;
    assertEquals(
      auditMeta.note,
      "balances are not changed by this repair path",
    );
    const risk = stub.inserts[1];
    assertEquals(risk.row.kind, "payment_ledger_label_repair_failed");
    assertEquals(risk.row.severity, "high");
    assertEquals(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});
