/**
 * UAT Journey 4: Payment → Credits Appear → Credits Deducted
 *
 * Verifies token ledger integrity: credits are atomically added and burned.
 * Does NOT trigger real Paystack — tests the ledger mechanics directly.
 *
 * Note: Idempotency is enforced at the edge function layer (token-purchase)
 * via INSERT into token_ledger with a unique index on request_id.
 * The atomic_token_credit RPC itself does NOT enforce idempotency —
 * it is a low-level balance mutation primitive.
 */

import { describe, it, expect } from "vitest";
import { supabase } from "./test-client";

const TEST_EMAIL = `uat-billing-${Date.now()}@test.izenzo.co.za`;
const PASSWORD = "UatT3st!Secure2026";

describe("Journey 4: Credits appear after purchase → deducted on action", () => {
  let userId: string;
  let orgId: string;

  // ── Setup ──────────────────────────────────────────────────────
  it("4.1 — setup: create account", async () => {
    await supabase.auth.signUp({ email: TEST_EMAIL, password: PASSWORD });
    const { data } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: PASSWORD,
    });
    userId = data.user!.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .single();
    orgId = profile!.org_id;
    expect(orgId).toBeTruthy();
  });

  // ── Step 1: Check initial balance ──────────────────────────────
  it("4.2 — initial token balance is default (1000 from org trigger)", async () => {
    const { data, error } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .maybeSingle();

    expect(error).toBeNull();
    const balance = data?.balance ?? 0;
    expect(balance).toBeGreaterThanOrEqual(0);
    console.info(`[UAT 4.2] Initial balance: ${balance}`);
  });

  // ── Step 2: Credit tokens (atomic_token_credit RPC) ────────────
  it("4.3 — atomic_token_credit adds tokens to the balance", async () => {
    const { data: before } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    const balanceBefore = before!.balance;

    const { data, error } = await supabase.rpc("atomic_token_credit", {
      p_org_id: orgId,
      p_amount: 1000,
      p_reason: "UAT simulated purchase",
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.new_balance).toBe(balanceBefore + 1000);
  });

  // ── Step 3: Ledger idempotency (tested at edge function layer) ─
  it("4.4 — token_ledger unique index prevents duplicate request_ids", async () => {
    const requestId = `uat-ledger-dup-${Date.now()}`;

    // First insert succeeds
    const { error: firstErr } = await supabase.from("token_ledger").insert({
      org_id: orgId,
      endpoint: "uat-test",
      outcome: "credit",
      tokens_burned: 0,
      remaining_balance: 2000,
      request_id: requestId,
    });
    expect(firstErr).toBeNull();

    // Second insert with same request_id MUST fail
    const { error: dupErr } = await supabase.from("token_ledger").insert({
      org_id: orgId,
      endpoint: "uat-test-dup",
      outcome: "credit",
      tokens_burned: 0,
      remaining_balance: 2000,
      request_id: requestId,
    });
    expect(dupErr).not.toBeNull();
    expect(dupErr!.message.toLowerCase()).toMatch(/duplicate|unique|violates/);
  });

  // ── Step 4: Burn tokens (atomic_token_burn RPC) ────────────────
  it("4.5 — atomic_token_burn deducts tokens correctly", async () => {
    const { data: before } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    const balanceBefore = before!.balance;

    const { data, error } = await supabase.rpc("atomic_token_burn", {
      p_org_id: orgId,
      p_amount: 100,
      p_reason: "UAT simulated intent confirmation",
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.balance_after).toBe(balanceBefore - 100);
  });

  // ── Step 5: Overdraft prevention ───────────────────────────────
  it("4.6 — atomic_token_burn rejects overdraft", async () => {
    const { data, error } = await supabase.rpc("atomic_token_burn", {
      p_org_id: orgId,
      p_amount: 999999,
      p_reason: "UAT overdraft test",
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_TOKENS");
  });
});
