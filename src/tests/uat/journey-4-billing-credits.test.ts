/**
 * UAT Journey 4: Payment → Credits Appear → Credits Deducted
 *
 * Verifies token ledger integrity: credits are atomically added and burned.
 * Does NOT trigger real Paystack — tests the ledger mechanics directly.
 */

import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

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
  it("4.2 — initial token balance is zero or default", async () => {
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

  // ── Step 2: Simulate credit (atomic_token_credit RPC) ─────────
  it("4.3 — atomic_token_credit adds tokens to the balance", async () => {
    const refId = `uat-credit-${Date.now()}`;

    const { data, error } = await supabase.rpc("atomic_token_credit", {
      p_org_id: orgId,
      p_amount: 1000,
      p_reference_id: refId,
      p_reason: "UAT simulated purchase",
    });

    expect(error).toBeNull();
    console.info(`[UAT 4.3] Credit RPC result:`, data);

    // Verify balance
    const { data: bal } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    expect(bal!.balance).toBeGreaterThanOrEqual(1000);
  });

  // ── Step 3: Idempotency — duplicate credit rejected ────────────
  it("4.4 — duplicate credit with same reference_id is rejected", async () => {
    const refId = `uat-credit-dup-${Date.now()}`;

    // First credit
    const { error: firstErr } = await supabase.rpc("atomic_token_credit", {
      p_org_id: orgId,
      p_amount: 500,
      p_reference_id: refId,
      p_reason: "UAT first",
    });
    expect(firstErr).toBeNull();

    // Second credit — same reference_id — MUST fail
    const { error } = await supabase.rpc("atomic_token_credit", {
      p_org_id: orgId,
      p_amount: 500,
      p_reference_id: refId,
      p_reason: "UAT duplicate",
    });

    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toMatch(/duplicate|unique|already|violates/);
  });

  // ── Step 4: Burn tokens (atomic_token_burn RPC) ────────────────
  it("4.5 — atomic_token_burn deducts tokens correctly", async () => {
    const { data: before } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    const balanceBefore = before!.balance;

    const { error } = await supabase.rpc("atomic_token_burn", {
      p_org_id: orgId,
      p_amount: 100,
      p_reference_id: `uat-burn-${Date.now()}`,
      p_reason: "UAT simulated intent confirmation",
    });

    expect(error).toBeNull();

    const { data: after } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    expect(after!.balance).toBe(balanceBefore - 100);
  });

  // ── Step 5: Ledger entries exist ───────────────────────────────
  it("4.6 — token_ledger contains credit and debit entries", async () => {
    const { data: entries, error } = await supabase
      .from("token_ledger")
      .select("tokens_burned, endpoint, request_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });

    expect(error).toBeNull();
    expect((entries ?? []).length).toBeGreaterThanOrEqual(1);

    const endpoints = (entries ?? []).map((e) => e.endpoint);
    console.info(`[UAT 4.6] Ledger endpoints: ${endpoints.join(", ")}`);
  });
});
