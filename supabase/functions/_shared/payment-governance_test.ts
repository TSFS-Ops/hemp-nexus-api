/**
 * payment-governance_test.ts — proves the Phase 2 wiring for Paystack
 * webhook exception paths.
 *
 * Coverage:
 *   1. recordPaymentGovernanceEventBestEffort writes one
 *      `payment.event_created` row per call into an in-memory event_store.
 *   2. Idempotency: same provider_event_id + event_subtype within the
 *      writer's window dedupes (the writer's UNIQUE / idempotency check
 *      is applied via the derived key).
 *   3. Unattributed events return ok:false without touching event_store.
 *   4. On governance failure, recordPaymentGovernanceOrEscalate opens an
 *      admin_risk_items row and writes a billing.governance_write_failed
 *      audit row (best-effort escalation).
 *   5. Adoption grep tests on token-purchase/index.ts: every exception
 *      path (charge.failed, refund.processed, refund.rejected x2,
 *      refund.partial, dispute.create, dispute.resolve, chargeback.won,
 *      chargeback.lost) has at least one canonical writer call site.
 *   6. Redaction still applies (defence-in-depth via the underlying
 *      writer): secrets passed in metadata are stripped before persistence.
 */

import { assertEquals, assertStringIncludes, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  recordPaymentGovernanceEventBestEffort,
  recordPaymentGovernanceOrEscalate,
} from "./payment-governance.ts";

// ── In-memory fake admin client ─────────────────────────────────────────
// Mirrors the minimal surface used by governance-audit.ts +
// payment-governance.ts.

interface FakeRow {
  table: string;
  row: Record<string, unknown>;
}

function makeFakeAdmin(opts: { failEventStoreInsert?: boolean } = {}): {
  admin: any;
  rows: FakeRow[];
} {
  const rows: FakeRow[] = [];
  let counter = 0;
  const admin = {
    from(table: string) {
      const ctx: { filter: Record<string, unknown>; since: string | null } = {
        filter: {},
        since: null,
      };
      const query: any = {
        select(_c?: string) { return this; },
        eq(col: string, v: unknown) { ctx.filter[col] = v; return this; },
        gte(_c: string, v: string) { ctx.since = v; return this; },
        order(_c: string, _o: unknown) { return this; },
        limit(_n: number) {
          const matched = rows
            .filter((r) => r.table === table)
            .map((r) => r.row)
            .filter((r) => Object.entries(ctx.filter).every(([k, v]) => (r as any)[k] === v))
            .filter((r) => ctx.since ? String((r as any).occurred_at) >= ctx.since : true);
          return Promise.resolve({ data: matched, error: null });
        },
      };
      return {
        select: (_c?: string) => query,
        insert(row: any) {
          const failNow = opts.failEventStoreInsert && table === "event_store";
          return {
            select(_c?: string) {
              return {
                async single() {
                  if (failNow) {
                    return { data: null, error: { message: "simulated event_store failure" } };
                  }
                  const id = `row_${++counter}`;
                  const stored = { id, ...row };
                  rows.push({ table, row: stored });
                  return { data: { id }, error: null };
                },
              };
            },
            // Plain insert (no .select) — used by admin_risk_items / audit_logs.
            then(onF: any, onR: any) {
              if (failNow) return onR ? onR({ data: null, error: { message: "simulated failure" } }) : undefined;
              const id = `row_${++counter}`;
              rows.push({ table, row: { id, ...row } });
              return onF({ data: { id }, error: null });
            },
          };
        },
      } as any;
    },
  };
  return { admin, rows };
}

const ORG = "11111111-1111-1111-1111-111111111111";

Deno.test("recordPaymentGovernanceEventBestEffort writes one payment.event_created row", async () => {
  const { admin, rows } = makeFakeAdmin();
  const res = await recordPaymentGovernanceEventBestEffort(admin, {
    event_subtype: "charge.failed",
    payment_reference: "ref_abc",
    provider_event_id: "evt_1",
    org_id: ORG,
    source_function: "token-purchase/webhook:charge.failed",
    payment_status: "failed",
    allowed_or_blocked: "blocked",
    reason_code: "charge.failed",
    policy_version: null,
  });
  assertEquals(res.ok, true);
  const ev = rows.filter((r) => r.table === "event_store");
  assertEquals(ev.length, 1);
  assertEquals(ev[0].row.event_type, "payment.event_created");
  assertEquals(ev[0].row.aggregate_type, "payment");
  assertEquals(ev[0].row.aggregate_id, "ref_abc");
});

Deno.test("refund.processed emits payment.event_created", async () => {
  const { admin, rows } = makeFakeAdmin();
  const res = await recordPaymentGovernanceEventBestEffort(admin, {
    event_subtype: "refund.processed",
    payment_reference: "ref_orig",
    provider_event_id: "rfd_99",
    org_id: ORG,
    source_function: "token-purchase/webhook:refund.processed",
    payment_status: "refunded",
    allowed_or_blocked: "allowed",
    reason_code: "refund.processed",
    amount: 10,
    currency: "USD",
    policy_version: null,
  });
  assertEquals(res.ok, true);
  const ev = rows.find((r) => r.table === "event_store")!;
  assertEquals(ev.row.event_type, "payment.event_created");
  const payload = ev.row.payload as Record<string, unknown>;
  const metadata = payload.metadata as Record<string, unknown>;
  assertEquals(metadata.event_subtype, "refund.processed");
});

Deno.test("dispute.create + chargeback.won both emit payment.event_created", async () => {
  const { admin, rows } = makeFakeAdmin();
  await recordPaymentGovernanceEventBestEffort(admin, {
    event_subtype: "dispute.create",
    payment_reference: "ref_x",
    provider_event_id: "disp_1",
    org_id: ORG,
    source_function: "token-purchase/webhook:dispute.create",
    payment_status: "disputed",
    allowed_or_blocked: "blocked",
    reason_code: "dispute.create",
    policy_version: null,
  });
  await recordPaymentGovernanceEventBestEffort(admin, {
    event_subtype: "chargeback.won",
    payment_reference: "ref_x",
    provider_event_id: "disp_1",
    org_id: ORG,
    source_function: "token-purchase/webhook:chargeback.won",
    payment_status: "dispute_won",
    allowed_or_blocked: "allowed",
    reason_code: "chargeback.won",
    policy_version: null,
  });
  const ev = rows.filter((r) => r.table === "event_store");
  assertEquals(ev.length, 2);
  for (const e of ev) {
    assertEquals(e.row.event_type, "payment.event_created");
  }
});

Deno.test("idempotency: same provider_event_id + event_subtype + reference dedupes", async () => {
  const { admin, rows } = makeFakeAdmin();
  // Same input fields → derived idempotency_key is identical; underlying
  // writer detects the duplicate within the idempotency window and returns
  // the existing row instead of inserting a new one.
  const input = {
    event_subtype: "charge.failed" as const,
    payment_reference: "ref_dup",
    provider_event_id: "evt_dup_1",
    org_id: ORG,
    source_function: "token-purchase/webhook:charge.failed",
    payment_status: "failed",
    allowed_or_blocked: "blocked" as const,
    reason_code: "charge.failed",
    policy_version: null,
  };
  await recordPaymentGovernanceEventBestEffort(admin, input);
  await recordPaymentGovernanceEventBestEffort(admin, input);
  const ev = rows.filter((r) => r.table === "event_store");
  assertEquals(ev.length, 1, "second call must dedupe via idempotency_key");
});

Deno.test("unattributed payment event (no org_id) is rejected without writing", async () => {
  const { admin, rows } = makeFakeAdmin();
  const res = await recordPaymentGovernanceEventBestEffort(admin, {
    event_subtype: "dispute.create",
    payment_reference: "ref_orphan",
    provider_event_id: "disp_orphan",
    org_id: null,
    source_function: "token-purchase/webhook:dispute.create",
    payment_status: "disputed",
    allowed_or_blocked: "blocked",
    reason_code: "dispute.create",
    policy_version: null,
  });
  assertEquals(res.ok, false);
  assertEquals(rows.filter((r) => r.table === "event_store").length, 0);
});

Deno.test("recordPaymentGovernanceOrEscalate opens risk item + audit row when writer fails", async () => {
  const { admin, rows } = makeFakeAdmin({ failEventStoreInsert: true });
  await recordPaymentGovernanceOrEscalate(admin, {
    event_subtype: "refund.processed",
    payment_reference: "ref_fail",
    provider_event_id: "rfd_fail",
    org_id: ORG,
    source_function: "token-purchase/webhook:refund.processed",
    payment_status: "refunded",
    allowed_or_blocked: "allowed",
    reason_code: "refund.processed",
    policy_version: null,
  });
  const risks = rows.filter((r) => r.table === "admin_risk_items");
  const audits = rows.filter(
    (r) => r.table === "audit_logs" && (r.row as any).action === "billing.governance_write_failed",
  );
  assertEquals(risks.length, 1);
  assertEquals(audits.length, 1);
  assertStringIncludes(String((risks[0].row as any).title), "Governance proof missing for refund.processed");
});

Deno.test("redaction still applies — secret-like keys in metadata are stripped", async () => {
  const { admin, rows } = makeFakeAdmin();
  await recordPaymentGovernanceEventBestEffort(admin, {
    event_subtype: "charge.failed",
    payment_reference: "ref_secret",
    provider_event_id: "evt_secret",
    org_id: ORG,
    source_function: "token-purchase/webhook:charge.failed",
    payment_status: "failed",
    allowed_or_blocked: "blocked",
    reason_code: "charge.failed",
    policy_version: null,
    metadata: {
      api_key: "sk_live_should_be_redacted",
      raw_payload: { card_number: "4111111111111111" },
      safe_field: "ok",
    },
  });
  const ev = rows.find((r) => r.table === "event_store")!;
  const metadata = (ev.row.payload as any).metadata as Record<string, unknown>;
  assertEquals(metadata.api_key, "[redacted]");
  assertEquals(metadata.raw_payload, "[redacted]");
  assertEquals(metadata.safe_field, "ok");
});

// ── Adoption / wiring grep tests ─────────────────────────────────────────
// These guarantee future drift cannot quietly unwire a webhook path.

Deno.test("token-purchase webhook wires payment.event_created for every exception path", async () => {
  const src = await Deno.readTextFile("supabase/functions/token-purchase/index.ts");

  // helper import present
  assertStringIncludes(src, 'from "../_shared/payment-governance.ts"');

  // every required subtype call site
  for (const subtype of [
    "charge.failed",
    "refund.processed",
    "refund.rejected",
    "refund.partial",
    "dispute.create",
    "dispute.resolve",
    "chargeback.won",
    "chargeback.lost",
  ]) {
    assert(
      src.includes(`event_subtype: "${subtype}"`),
      `missing canonical writer call for event_subtype="${subtype}"`,
    );
  }

  // source_function tags must trace to webhook handler paths
  assertStringIncludes(src, 'source_function: "token-purchase/webhook:charge.failed"');
  assertStringIncludes(src, 'source_function: "token-purchase/webhook:refund.processed"');
  assertStringIncludes(src, 'source_function: "token-purchase/webhook:dispute.create"');
  assertStringIncludes(src, 'source_function: "token-purchase/webhook:chargeback.won"');
  assertStringIncludes(src, 'source_function: "token-purchase/webhook:chargeback.lost"');
});
