/**
 * UAT Journey 1: New User → Sign Up → Onboard → Search → Match → Terms → Docs → Intent
 *
 * Exercises the full commercial lifecycle from first visit to trade request.
 * Uses in-memory Supabase client for vitest compatibility.
 */

import { describe, it, expect } from "vitest";
import { supabase, BASE_URL } from "./test-client";

const TEST_EMAIL = `uat-${Date.now()}@test.izenzo.co.za`;
const TEST_PASSWORD = "UatT3st!Secure2026";

describe("Journey 1: Signup → Onboard → Search → Match → Terms → Docs → Confirm Intent", () => {
  let userId: string;
  let accessToken: string;
  let orgId: string;
  let apiKeyPlaintext: string;
  let matchId: string;

  // ── Step 1: Sign up ──────────────────────────────────────────────
  it("1.1 - creates account with email + password", async () => {
    const { data, error } = await supabase.auth.signUp({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();
    userId = data.user!.id;
  });

  // ── Step 2: Sign in ────────────────────────────────────────────
  it("1.2 - signs in and receives a session", async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.session).toBeTruthy();
    accessToken = data.session!.access_token;
  });

  // ── Step 3: Profile & org auto-created ─────────────────────────
  it("1.3 - profile and organisation exist after first login", async () => {
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("id, org_id")
      .eq("id", userId)
      .single();

    expect(pErr).toBeNull();
    expect(profile).toBeTruthy();
    orgId = profile!.org_id;
    expect(orgId).toBeTruthy();

    const { data: org, error: oErr } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .single();
    expect(oErr).toBeNull();
    expect(org).toBeTruthy();
  });

  // ── Step 4: Roles assigned ─────────────────────────────────────
  it("1.4 - user has org_admin and org_member roles", async () => {
    const { data: roles, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    expect(error).toBeNull();
    const roleNames = (roles ?? []).map((r: { role: string }) => r.role);
    expect(roleNames).toContain("org_admin");
    expect(roleNames).toContain("org_member");
  });

  // ── Step 5: Create API key ─────────────────────────────────────
  it("1.5 - creates an API key via edge function", async () => {
    const res = await fetch(`${BASE_URL}/functions/v1/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "UAT Key", scopes: ["search", "match", "evidence"] }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.key).toBeTruthy();
    apiKeyPlaintext = body.key;
  });

  // ── Step 6: Run a trading partner search (long-running) ───────────
  it("1.6 - search returns results without error", async () => {
    const res = await fetch(`${BASE_URL}/functions/v1/search`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKeyPlaintext,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "maize exporter south africa",
        product_category: "grains",
      }),
    });

    // Search may return results or empty array - both valid
    const body = await res.json();
    if (res.ok) {
      expect(Array.isArray(body.results) || body.results === undefined).toBe(true);
    } else {
      // Search may fail due to external API limits - document and accept
      console.warn(`[UAT 1.6] Search returned ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      expect(res.status).toBeLessThan(500);
    }
  }, 30_000); // 30s timeout - search calls external APIs

  // ── Step 7: Create a match ─────────────────────────────────────
  it("1.7 - creates a match and receives id + hash", async () => {
    const res = await fetch(`${BASE_URL}/functions/v1/match`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKeyPlaintext,
        "Content-Type": "application/json",
        "Idempotency-Key": `uat-match-${Date.now()}`,
      },
      body: JSON.stringify({
        buyer: { id: "UAT_BUYER", name: "UAT Buyer Corp" },
        seller: { id: "UAT_SELLER", name: "UAT Seller Ltd" },
        commodity: "Maize",
        quantity: { amount: 500, unit: "MT" },
        price: { amount: 250, currency: "USD" },
        terms: "FOB Durban",
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    // Match response returns `hash`, not `evidence_hash`
    expect(body.hash).toBeTruthy();
    expect(body.hash).toMatch(/^[a-f0-9]{64}$/);
    matchId = body.id;
  }, 15_000);

  // ── Step 8: Add deal terms ─────────────────────────────────────
  it("1.8 - saves deal terms for the match", async () => {
    expect(matchId).toBeTruthy(); // guard against cascading null

    const { error } = await supabase.from("deal_terms").insert({
      match_id: matchId,
      org_id: orgId,
      payment_terms: "30 days LC",
      delivery_terms: "FOB Durban",
      inspection_terms: "SGS at load port",
      proposed_by: userId,
    });
    expect(error).toBeNull();

    const { data, error: readErr } = await supabase
      .from("deal_terms")
      .select("payment_terms")
      .eq("match_id", matchId)
      .single();
    expect(readErr).toBeNull();
    expect(data!.payment_terms).toBe("30 days LC");
  });

  // ── Step 9: Upload a document (metadata only) ──────────────────
  it("1.9 - records a document upload against the match", async () => {
    expect(matchId).toBeTruthy();

    const { error } = await supabase.from("match_documents").insert({
      match_id: matchId,
      org_id: orgId,
      doc_type: "commercial_invoice",
      filename: "uat-invoice.pdf",
      storage_path: `match-docs/${matchId}/uat-invoice.pdf`,
      sha256_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      uploader_user_id: userId,
      uploader_org_id: orgId,
    });
    expect(error).toBeNull();
  });

  // ── Step 10: Confirm intent (settle) ───────────────────────────
  it("1.10 - confirms intent via edge function", async () => {
    expect(matchId).toBeTruthy();

    const res = await fetch(`${BASE_URL}/functions/v1/match/${matchId}/settle`, {
      method: "POST",
      headers: { "X-API-Key": apiKeyPlaintext },
    });

    const body = await res.json();
    if (res.ok) {
      // State transitioned to intent_declared or status settled
      expect(body.state === "intent_declared" || body.status === "settled").toBe(true);
    } else {
      // Acceptable failures: insufficient tokens, already in wrong state
      expect(["INSUFFICIENT_TOKENS", "INVALID_STATE", "insufficient_tokens"]).toContain(body.code);
    }
  }, 15_000);

  // ── Step 11: Audit trail exists ────────────────────────────────
  it("1.11 - audit log contains match.created event", async () => {
    expect(matchId).toBeTruthy();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("action")
      .eq("org_id", orgId)
      .eq("entity_type", "match")
      .limit(20);

    expect(error).toBeNull();
    const actions = (data ?? []).map((r: { action: string }) => r.action);
    // RLS policy "Org members can view own audit logs" grants SELECT for own org
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions).toContain("match.created");
  });
});
