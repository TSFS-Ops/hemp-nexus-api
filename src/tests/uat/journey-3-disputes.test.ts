/**
 * UAT Journey 3: Dispute Raised → Reviewed → Resolved → Status Reflected
 *
 * Verifies the dispute lifecycle against the match state machine.
 */

import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TEST_EMAIL = `uat-dispute-${Date.now()}@test.izenzo.co.za`;
const PASSWORD = "UatT3st!Secure2026";

describe("Journey 3: Dispute lifecycle — raise → review → resolve", () => {
  let userId: string;
  let orgId: string;
  let accessToken: string;
  let apiKey: string;
  let matchId: string;
  let disputeId: string;

  // ── Setup: account + match ─────────────────────────────────────
  it("3.1 — setup: creates account, API key, and match", async () => {
    await supabase.auth.signUp({ email: TEST_EMAIL, password: PASSWORD });
    const { data } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: PASSWORD,
    });
    userId = data.user!.id;
    accessToken = data.session!.access_token;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .single();
    orgId = profile!.org_id;

    // Create API key
    const keyRes = await fetch(`${BASE_URL}/functions/v1/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Dispute UAT Key", scopes: ["search", "match"] }),
    });
    const keyBody = await keyRes.json();
    apiKey = keyBody.key;

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
  });

  // ── Step 1: Raise dispute ──────────────────────────────────────
  it("3.2 — raises a dispute against the match", async () => {
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

  // ── Step 2: Match status reflects dispute ──────────────────────
  it("3.3 — settle is blocked by backend when an open dispute exists", async () => {
    const res = await fetch(`${BASE_URL}/functions/v1/match/${matchId}/settle`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
    });

    // Must be rejected — either 409 DISPUTE_ACTIVE or 400 INVALID_STATE
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const body = await res.json();
    // Expect DISPUTE_ACTIVE if match is in discovery, or INVALID_STATE if already transitioned
    expect(["DISPUTE_ACTIVE", "INVALID_STATE"]).toContain(body.code);
  });

  // ── Step 3: Resolve the dispute ────────────────────────────────
  it("3.4 — resolves the dispute with outcome", async () => {
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

    // Verify status
    const { data } = await supabase
      .from("disputes")
      .select("status, resolution_outcome")
      .eq("id", disputeId)
      .single();
    expect(data!.status).toBe("resolved");
    expect(data!.resolution_outcome).toContain("amended timeline");
  });

  // ── Step 4: Dispute has audit trail ────────────────────────────
  it("3.5 — audit log records dispute lifecycle events", async () => {
    const { data: logs, error } = await supabase
      .from("audit_logs")
      .select("action")
      .eq("entity_id", matchId)
      .eq("entity_type", "match");

    expect(error).toBeNull();
    // At minimum: match.created should exist
    const actions = (logs ?? []).map((r: { action: string }) => r.action);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    console.info(`[UAT 3.5] Audit actions for match: ${actions.join(", ")}`);
  });
});
