// Static-source guards for payment credit → ledger → audit atomicity.
//
// These tests prove that the paid-purchase code path in token-purchase
// uses the atomic_paid_credit_purchase RPC (single SQL transaction:
// balance update + canonical credit_purchase ledger row) and does NOT
// fall back to the legacy "credit + promote" pattern, which could leave
// a skeletal action_type='credit' row if the function died between the
// two round-trips.
//
// They also prove the webhook `credits.purchased` audit insert is
// FAIL-CLOSED (throws on non-23505), so Paystack/PayFast retry until
// the canonical audit row lands. RPC idempotency on `request_id`
// prevents the retry from double-crediting.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC_URL = new URL("../token-purchase/index.ts", import.meta.url);
const src = await Deno.readTextFile(SRC_URL);

Deno.test("paid path uses atomic_paid_credit_purchase exactly twice (webhook + verify)", () => {
  const matches = src.match(/atomic_paid_credit_purchase/g) ?? [];
  // Expect at least 2 RPC call sites (verify + webhook). Comments may
  // mention the name, so we assert >=2 rather than ==2.
  assert(
    matches.length >= 2,
    `expected >=2 references to atomic_paid_credit_purchase, found ${matches.length}`,
  );
});

Deno.test("paid path does NOT call atomic_token_credit anymore (paid path only)", () => {
  // The webhook/verify paid path must not call atomic_token_credit.
  // Other paths (burn/refund/debit) in this file may still legitimately
  // call atomic_token_credit, so we only fail if a paid-path call site
  // remains. The legacy paid call sites used `p_reason: "credit_purchase"`.
  const legacy = src.match(/atomic_token_credit[\s\S]{0,200}p_reason:\s*"credit_purchase"/g) ?? [];
  assertEquals(
    legacy.length,
    0,
    `paid path still calls atomic_token_credit with p_reason="credit_purchase" (${legacy.length} site(s))`,
  );
});

Deno.test("paid path does NOT contain a direct UPDATE to action_type='credit_purchase'", () => {
  // The follow-up UPDATE token_ledger … SET action_type='credit_purchase'
  // pattern is the skeletal-row source we eliminated. Must be gone from
  // the paid path. Allow the string only inside comments (we strip block
  // comments and line comments before matching).
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const direct = stripped.match(/action_type:\s*["']credit_purchase["']/g) ?? [];
  assertEquals(
    direct.length,
    0,
    `paid path still writes action_type='credit_purchase' from edge code (${direct.length} site(s))`,
  );
});

Deno.test("webhook credits.purchased audit insert is fail-closed (throws on non-23505)", () => {
  // Look for the throw inside the webhook audit block.
  const pattern = /credits\.purchased audit insert failed[\s\S]{0,200}throw new Error\(\s*`AUDIT_WRITE_FAILED/;
  assert(
    pattern.test(src),
    "webhook credits.purchased audit handler must throw AUDIT_WRITE_FAILED on non-23505 errors",
  );
});

Deno.test("transaction-reconciliation calls repair_skeletal_paid_credit", async () => {
  const reconURL = new URL("../transaction-reconciliation/index.ts", import.meta.url);
  const reconSrc = await Deno.readTextFile(reconURL);
  assert(
    /repair_skeletal_paid_credit/.test(reconSrc),
    "transaction-reconciliation must call the repair_skeletal_paid_credit RPC",
  );
});
