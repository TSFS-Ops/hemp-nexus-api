/**
 * UAT Journey 3: Dispute Raised → Reviewed → Resolved → Status Reflected
 *
 * Verifies the dispute lifecycle against the match state machine.
 */

import { describe, it, expect } from "vitest";
import { UAT_PROVISIONING_ENABLED, UAT_SKIP_REASON } from "./_ci-gate";
import { supabase, BASE_URL, signUpTestUser } from "./test-client";

const TEST_EMAIL = `uat-dispute-${Date.now()}@test.izenzo.co.za`;
const PASSWORD = "UatT3st!Secure2026";

describe.skipIf(!UAT_PROVISIONING_ENABLED)("Journey 3: Dispute lifecycle - raise → review → resolve", () => {
  let userId: string;
  let orgId: string;
  let accessToken: string;
  let apiKey: string;
  let matchId: string;
  let disputeId: string;

  // ── Setup: account + match ─────────────────────────────────────
  it("3.1 - setup: creates account, API key, and match", async () => {
    const result = await signUpTestUser(supabase, TEST_EMAIL, PASSWORD);
    userId = result.userId;
    accessToken = result.accessToken;
    orgId = result.orgId;

    // Create API key
    const keyRes = await fetch(`${BASE_URL}/functions/v1/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `uat-j3-apikey-${Date.now()}`,
      },
      body: JSON.stringify({ name: "Production Key", scopes: ["search", "match"] }),
    });
    if (!keyRes.ok) {
      const errBody = await keyRes.text();
      throw new Error(`api-keys POST failed: ${keyRes.status} ${errBody}`);
    }
    const keyBody = await keyRes.json();
    apiKey = keyBody.key;
    expect(apiKey).toBeTruthy();

    // Create match
    const matchRes = await fetch(`${BASE_URL}/functions/v1/match`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": `uat-dispute-match-${Date.now()}`,
      },
      body: JSON.stringify({
        buyer: { id: "DISPUTE_BUYER", name: "Dispute Buyer" },
        seller: { id: "DISPUTE_SELLER", name: "Dispute Seller" },
        commodity: "Copper Cathodes",
        quantity: { amount: 100, unit: "MT" },
        price: { amount: 8500, currency: "USD" },
        terms: "CIF Shanghai",
      }),
    });
    const matchBody = await matchRes.json();
    matchId = matchBody.id;
    expect(matchId).toBeTruthy();
  }, 15_000);

  // ── Step 1: Raise dispute ──────────────────────────────────────
  it("3.2 - raises a dispute against the match", async () => {
    expect(matchId).toBeTruthy();

    const { data, error } = await supabase.from("disputes").insert({
      match_id: matchId,
      raised_by_org_id: orgId,
      raised_by_user_id: userId,
      reason: "Counterparty failed to provide shipping documents within agreed timeframe",
    }).select("id, status").single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.status).toBe("open");
    disputeId = data!.id;
  });

  // ── Step 2: Settle blocked during open dispute ─────────────────
  it("3.3 - settle is blocked by backend when an open dispute exists", async () => {
    expect(matchId).toBeTruthy();

    const res = await fetch(`${BASE_URL}/functions/v1/match/${matchId}/settle`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Idempotency-Key": `uat-j3-settle-${Date.now()}`,
      },
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const body = await res.json();
    expect(["DISPUTE_ACTIVE", "INVALID_STATE", "EVIDENCE_WAIVER_REQUIRED"]).toContain(body.code);
  }, 15_000);

  // ── Step 3: Resolve the dispute ────────────────────────────────
  it("3.4 - resolves the dispute with outcome", async () => {
    expect(disputeId).toBeTruthy();

    const { error } = await supabase
      .from("disputes")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_outcome: "Documents provided late; parties agreed to proceed with amended timeline.",
      })
      .eq("id", disputeId);

    expect(error).toBeNull();

    const { data } = await supabase
      .from("disputes")
      .select("status, resolution_outcome")
      .eq("id", disputeId)
      .single();
    expect(data!.status).toBe("resolved");
    expect(data!.resolution_outcome).toContain("amended timeline");
  });

  // ── Step 4: Dispute has audit trail ────────────────────────────
  it("3.5 - audit log records dispute lifecycle events", async () => {
    expect(matchId).toBeTruthy();

    // The dispute creation trigger inserts into audit_logs
    const { data: logs, error } = await supabase
      .from("audit_logs")
      .select("action")
      .eq("org_id", orgId)
      .limit(20);

    expect(error).toBeNull();
    // RLS policy "Org members can view own audit logs" grants SELECT for own org
    // audit_dispute_creation trigger writes dispute.raised to audit_logs
    const actions = (logs ?? []).map((r: { action: string }) => r.action);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions).toContain("dispute.raised");
  });
});
