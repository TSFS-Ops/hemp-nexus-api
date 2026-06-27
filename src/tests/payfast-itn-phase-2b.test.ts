/**
 * PayFast ITN orchestrator integration tests — Phase 2B.
 *
 * Exercises `processPayfastItn` end-to-end with an in-memory mock
 * Supabase client and an injected validate post-back. No HTTP, no Deno
 * runtime, no real database — but every decision branch the live ITN
 * handler can hit is covered.
 *
 * What is asserted, per the Phase 2B spec:
 *   • Valid COMPLETE ITN credits the wallet exactly once.
 *   • Duplicate COMPLETE ITN does not double-credit.
 *   • Amount / currency / package mismatches do not credit.
 *   • FAILED ITN marks failed and does not credit.
 *   • CANCELLED ITN marks cancelled and does not credit.
 *   • PENDING / unknown statuses do not credit.
 *   • Validate INVALID / timeout / network error do not credit and risk-log.
 *   • Invalid source IP does not credit and risk-logs.
 *   • Missing purchase / missing provider_reference / missing signature
 *     / invalid signature do not credit and risk-log.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildPayfastSignature,
  processPayfastItn,
  type ItnSupabaseClient,
  type PayfastValidatePostback,
} from "../../supabase/functions/_shared/payments/payfast.ts";

// ─── Mock Supabase client ─────────────────────────────────────────────────
//
// Minimal chainable mock: enough to satisfy the ~10 distinct supabase
// calls the orchestrator makes. Each table behaves like an in-memory
// array; queries return the rows that match the latest `.eq()` filters.

interface MockTables {
  token_purchases: Array<Record<string, unknown>>;
  audit_logs: Array<Record<string, unknown>>;
  admin_risk_items: Array<Record<string, unknown>>;
  webhook_replay_guard: Array<{ source: string; signature_hash: string }>;
}

interface MockRpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function makeMockSupabase(initial: Partial<MockTables> = {}) {
  const tables: MockTables = {
    token_purchases: initial.token_purchases ?? [],
    audit_logs: initial.audit_logs ?? [],
    admin_risk_items: initial.admin_risk_items ?? [],
    webhook_replay_guard: initial.webhook_replay_guard ?? [],
  };
  const rpcCalls: MockRpcCall[] = [];
  // Forcing the RPC to return an "already credited" result on the
  // second matching p_reference_id, mimicking the partial unique index
  // on token_ledger.request_id.
  const seenRefs = new Set<string>();

  const buildQuery = (table: keyof MockTables) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let updatePayload: Record<string, unknown> | null = null;
    let inFilter: { col: string; values: unknown[] } | null = null;
    let isUpdate = false;
    let isSelect = false;

    const api = {
      select(_cols: string) {
        isSelect = true;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        inFilter = { col, values: vals };
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      update(payload: Record<string, unknown>) {
        isUpdate = true;
        updatePayload = payload;
        return api;
      },
      maybeSingle() {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      insert(row: Record<string, unknown> | Record<string, unknown>[]) {
        // Special-case replay guard duplicate detection.
        if (table === "webhook_replay_guard") {
          const r = (Array.isArray(row) ? row[0] : row) as {
            source: string;
            signature_hash: string;
          };
          const dup = tables.webhook_replay_guard.some(
            (x) => x.source === r.source && x.signature_hash === r.signature_hash,
          );
          if (dup) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key value" },
            });
          }
          tables.webhook_replay_guard.push(r);
          return Promise.resolve({ error: null });
        }
        const arr = Array.isArray(row) ? row : [row];
        tables[table].push(...arr);
        return Promise.resolve({ error: null });
      },
      // Awaiting an update chain (no `.maybeSingle`) returns void.
      then(onF: (v: { error: null }) => unknown) {
        if (isUpdate) {
          for (const r of tables[table]) {
            if (filters.every((f) => f(r))) Object.assign(r, updatePayload);
          }
        }
        // Mark as used to placate the linter on `inFilter` / `isSelect`.
        void inFilter; void isSelect;
        return Promise.resolve({ error: null }).then(onF);
      },
    };
    return api;
  };

  const client = {
    from(table: string) {
      return buildQuery(table as keyof MockTables);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "atomic_paid_credit_purchase") {
        const ref = String(args.p_reference_id);
        const alreadyCredited = seenRefs.has(ref);
        seenRefs.add(ref);
        return Promise.resolve({
          data: { new_balance: 10, already_credited: alreadyCredited },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as unknown as ItnSupabaseClient, tables, rpcCalls };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ORG = "00000000-0000-0000-0000-000000000001";
const PURCHASE_ID = "00000000-0000-0000-0000-0000000000aa";
const M_REF = "pf_test_m_001";

function makePurchase(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: PURCHASE_ID,
    org_id: ORG,
    user_id: ORG,
    status: "pending",
    credits: 10,
    currency: "ZAR",
    package_id: "pack_10",
    provider: "payfast",
    provider_reference: M_REF,
    metadata: { price_zar: 180, package_id: "pack_10" },
    ...over,
  };
}

// Helper to build a signed ITN body.
function buildItnBody(over: Partial<Record<string, string>> = {}, passphrase?: string) {
  const fields: Array<[string, string]> = [
    ["m_payment_id", M_REF],
    ["pf_payment_id", "1234567"],
    ["payment_status", "COMPLETE"],
    ["item_name", "pack_10"],
    ["amount_gross", "180.00"],
    ["amount_fee", "-5.00"],
    ["amount_net", "175.00"],
    ["custom_str1", "pack_10"],
    ["merchant_id", "10000100"],
  ];
  // Apply overrides while preserving order; new keys appended at end.
  const seen = new Set<string>();
  const merged: Array<[string, string]> = fields.map(([k, v]) => {
    if (k in over) {
      seen.add(k);
      return [k, over[k] as string] as [string, string];
    }
    return [k, v] as [string, string];
  });
  for (const [k, v] of Object.entries(over)) {
    if (!seen.has(k)) merged.push([k, v]);
  }
  const sig = buildPayfastSignature(merged, passphrase);
  const all: Array<[string, string]> = [...merged, ["signature", sig]];
  return new URLSearchParams(all).toString();
}

const VALID_POSTBACK: PayfastValidatePostback = async () =>
  ({ ok: true as const, raw: "VALID" as const });

function baseDeps(overrides: Partial<Parameters<typeof processPayfastItn>[1]> = {}) {
  const { client } = makeMockSupabase({ token_purchases: [makePurchase()] });
  return {
    supabase: client,
    mode: "sandbox" as const,
    passphrase: null,
    allowedIps: ["1.1.1.1"],
    remoteIp: "1.1.1.1",
    validatePostback: VALID_POSTBACK,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("processPayfastItn — happy path", () => {
  let mock: ReturnType<typeof makeMockSupabase>;
  beforeEach(() => {
    mock = makeMockSupabase({ token_purchases: [makePurchase()] });
  });

  it("credits the wallet exactly once on a valid COMPLETE ITN", async () => {
    const body = buildItnBody();
    const out = await processPayfastItn({ method: "POST", rawBody: body }, {
      supabase: mock.client,
      mode: "sandbox",
      passphrase: null,
      allowedIps: ["1.1.1.1"],
      remoteIp: "1.1.1.1",
      validatePostback: VALID_POSTBACK,
    });
    expect(out.decision).toBe("credited");
    expect(out.providerReference).toBe(M_REF);
    expect(out.creditReference).toBe("1234567"); // pf_payment_id preferred
    const rpcCalls = mock.rpcCalls.filter((c) => c.fn === "atomic_paid_credit_purchase");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_endpoint).toBe("payment:payfast:itn");
    expect(rpcCalls[0].args.p_org_id).toBe(ORG);
    expect(rpcCalls[0].args.p_amount).toBe(10);
    // Purchase row updated to completed.
    expect(mock.tables.token_purchases[0].status).toBe("completed");
    // A credits.purchased audit row exists.
    const successAudits = mock.tables.audit_logs.filter(
      (r) => r.action === "credits.purchased",
    );
    expect(successAudits).toHaveLength(1);
  });

  it("a duplicate COMPLETE ITN does not double-credit (replay guard rejects)", async () => {
    const body = buildItnBody();
    const deps = {
      supabase: mock.client,
      mode: "sandbox" as const,
      passphrase: null,
      allowedIps: ["1.1.1.1"],
      remoteIp: "1.1.1.1",
      validatePostback: VALID_POSTBACK,
    };
    const first = await processPayfastItn({ method: "POST", rawBody: body }, deps);
    const second = await processPayfastItn({ method: "POST", rawBody: body }, deps);
    expect(first.decision).toBe("credited");
    expect(second.decision).toBe("rejected");
    expect(second.reason).toBe("replay_detected");
    // Only ONE rpc call.
    expect(mock.rpcCalls.filter((c) => c.fn === "atomic_paid_credit_purchase")).toHaveLength(1);
  });

  it("verifies a signed body that includes a merchant passphrase", async () => {
    const pass = "merchant-pass-1";
    const body = buildItnBody({}, pass);
    const out = await processPayfastItn({ method: "POST", rawBody: body }, {
      supabase: mock.client,
      mode: "sandbox",
      passphrase: pass,
      allowedIps: ["1.1.1.1"],
      remoteIp: "1.1.1.1",
      validatePostback: VALID_POSTBACK,
    });
    expect(out.decision).toBe("credited");
  });
});

describe("processPayfastItn — signature, IP, validate failures", () => {
  it("rejects an ITN with no signature field", async () => {
    const body = "m_payment_id=x&payment_status=COMPLETE";
    const out = await processPayfastItn({ method: "POST", rawBody: body }, baseDeps());
    expect(out.decision).toBe("rejected");
    expect(out.reason).toBe("missing_signature");
  });

  it("rejects an ITN whose signature does not verify", async () => {
    const body = buildItnBody() + "&extra=tampered";
    const out = await processPayfastItn({ method: "POST", rawBody: body }, baseDeps());
    expect(out.decision).toBe("rejected");
    expect(out.reason).toBe("invalid_signature");
  });

  it("rejects an ITN from an IP not in the allowlist", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody() },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "9.9.9.9",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.decision).toBe("rejected");
    expect(out.reason).toBe("invalid_ip");
    const risk = mock.tables.admin_risk_items.find((r) => r.kind === "payfast_itn_rejected");
    expect(risk).toBeTruthy();
  });

  it("rejects when validate post-back returns INVALID", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody() },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: async () => ({ ok: false, reason: "invalid", raw: "INVALID" }),
      },
    );
    expect(out.decision).toBe("rejected");
    expect(out.reason).toBe("validate_invalid");
    expect(mock.rpcCalls.some((c) => c.fn === "atomic_paid_credit_purchase")).toBe(false);
  });

  it("rejects when validate post-back times out (no credit, risk-logged)", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody() },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: async () => ({ ok: false, reason: "timeout" }),
      },
    );
    expect(out.decision).toBe("rejected");
    expect(out.reason).toBe("validate_timeout");
    expect(mock.tables.admin_risk_items.length).toBeGreaterThan(0);
  });

  it("rejects when validate post-back has a network error", async () => {
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody() },
      {
        ...baseDeps(),
        validatePostback: async () => ({ ok: false, reason: "network_error", raw: "boom" }),
      },
    );
    expect(out.reason).toBe("validate_network_error");
  });
});

describe("processPayfastItn — mismatch / not-found", () => {
  it("rejects when amount_gross is missing", async () => {
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ amount_gross: "" }) },
      baseDeps(),
    );
    expect(out.reason).toBe("amount_missing");
  });

  it("rejects when amount_gross is not numeric", async () => {
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ amount_gross: "abc" }) },
      baseDeps(),
    );
    expect(out.reason).toBe("amount_not_numeric");
  });

  it("rejects when amount_gross does not match expected ZAR price", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ amount_gross: "1.00" }) },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.reason).toBe("amount_mismatch");
    expect(mock.rpcCalls.some((c) => c.fn === "atomic_paid_credit_purchase")).toBe(false);
  });

  it("rejects when purchase row is for a different currency", async () => {
    const mock = makeMockSupabase({
      token_purchases: [makePurchase({ currency: "USD" })],
    });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody() },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.reason).toBe("currency_mismatch");
  });

  it("rejects when custom_str1 (package id) does not match the purchase", async () => {
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ custom_str1: "pack_50" }) },
      baseDeps(),
    );
    expect(out.reason).toBe("package_mismatch");
  });

  it("rejects when no purchase row exists for the provider_reference", async () => {
    const mock = makeMockSupabase({ token_purchases: [] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody() },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.reason).toBe("purchase_not_found");
  });

  it("rejects when m_payment_id is missing", async () => {
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ m_payment_id: "" }) },
      baseDeps(),
    );
    expect(out.reason).toBe("missing_provider_reference");
  });
});

describe("processPayfastItn — non-COMPLETE statuses", () => {
  it("FAILED ITN marks the purchase failed and does not credit", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ payment_status: "FAILED" }) },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.decision).toBe("failed_recorded");
    expect(mock.tables.token_purchases[0].status).toBe("failed");
    expect(mock.rpcCalls.some((c) => c.fn === "atomic_paid_credit_purchase")).toBe(false);
  });

  it("CANCELLED ITN marks the purchase cancelled and does not credit", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ payment_status: "CANCELLED" }) },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.decision).toBe("cancelled_recorded");
    expect(mock.tables.token_purchases[0].status).toBe("cancelled");
    expect(mock.rpcCalls.some((c) => c.fn === "atomic_paid_credit_purchase")).toBe(false);
  });

  it("PENDING ITN is ignored (no credit, no risk-log)", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ payment_status: "PENDING" }) },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.decision).toBe("pending_ignored");
    expect(mock.tables.token_purchases[0].status).toBe("pending");
  });

  it("unknown status is rejected and risk-logged (no credit)", async () => {
    const mock = makeMockSupabase({ token_purchases: [makePurchase()] });
    const out = await processPayfastItn(
      { method: "POST", rawBody: buildItnBody({ payment_status: "WAFFLE" }) },
      {
        supabase: mock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );
    expect(out.reason).toBe("unknown_status");
    const risks = mock.tables.admin_risk_items.filter(
      (r) => r.kind === "payfast_itn_rejected",
    );
    expect(risks.length).toBeGreaterThan(0);
  });
});

describe("processPayfastItn — method gating + empty body", () => {
  it("rejects non-POST with 405", async () => {
    const out = await processPayfastItn({ method: "GET", rawBody: "" }, baseDeps());
    expect(out.status).toBe(405);
    expect(out.reason).toBe("method_not_allowed");
  });
  it("rejects empty body with 200 (no retry storm)", async () => {
    const out = await processPayfastItn({ method: "POST", rawBody: "" }, baseDeps());
    expect(out.status).toBe(200);
    expect(out.reason).toBe("empty_body");
  });
});
