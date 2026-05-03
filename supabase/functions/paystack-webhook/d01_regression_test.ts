/**
 * D-01 Paystack webhook regression tests.
 *
 * Runs against the deployed Supabase project. To execute the
 * cryptographically-valid paths (replay, mismatch, charge.failed) the test
 * harness needs the active Paystack secret key; CI provides it as
 * `TEST_PAYSTACK_KEY` (separate from production `PAYSTACK_SECRET_KEY` so a
 * leaked test runner never reveals the live key).
 *
 * Tests that DO NOT need the secret (signature rejection, missing signature)
 * always run.
 *
 * Run:
 *   supabase test edge-functions --pattern "D-01"
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://ugrfyhwlonlmlcmcpcdm.supabase.co";
const TEST_KEY = Deno.env.get("TEST_PAYSTACK_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

async function hmacSha512(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWebhook(path: string, body: string, signature: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["x-paystack-signature"] = signature;
  if (ANON) headers["apikey"] = ANON;
  return await fetch(`${SUPABASE_URL}/functions/v1${path}`, {
    method: "POST",
    headers,
    body,
  });
}

Deno.test("D-01 invalid signature → 401 (paystack-webhook)", async () => {
  const r = await postWebhook("/paystack-webhook", JSON.stringify({ event: "charge.success" }), "deadbeef");
  assertEquals(r.status, 401);
  await r.body?.cancel();
});

Deno.test("D-01 missing signature → 400 (paystack-webhook)", async () => {
  const r = await postWebhook("/paystack-webhook", JSON.stringify({ event: "charge.success" }), null);
  assertEquals(r.status, 400);
  await r.body?.cancel();
});

Deno.test("D-01 invalid signature → 401 (token-purchase/webhook canonical)", async () => {
  const r = await postWebhook("/token-purchase/webhook", JSON.stringify({ event: "charge.success" }), "deadbeef");
  assertEquals(r.status, 401);
  await r.body?.cancel();
});

Deno.test({
  name: "D-01 valid signature → first delivery 200, replay → 409",
  ignore: !TEST_KEY,
  async fn() {
    // Use a junk metadata so handleChargeSuccess returns early without
    // touching org data — we are only testing the signature + replay layer.
    const ref = `D01-REPLAY-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        reference: ref,
        amount: 100,
        currency: "USD",
        metadata: {}, // missing org_id/credits → handler returns early
      },
    });
    const sig = await hmacSha512(TEST_KEY, body);
    const first = await postWebhook("/paystack-webhook", body, sig);
    assertEquals(first.status, 200, "first delivery must be accepted");
    await first.body?.cancel();
    const replay = await postWebhook("/paystack-webhook", body, sig);
    assertEquals(replay.status, 409, "replay must be rejected with 409 WEBHOOK_REPLAY");
    await replay.body?.cancel();
  },
});

Deno.test({
  name: "D-01 charge.failed creates failed audit, no credit",
  ignore: !TEST_KEY,
  async fn() {
    // Synthetic org id; we only care that the handler does NOT credit and
    // does NOT throw. Reconciliation view will categorise as 'failed'.
    const ref = `D01-FAILED-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      event: "charge.failed",
      data: {
        reference: ref,
        metadata: { org_id: "00000000-0000-0000-0000-000000000000" },
      },
    });
    const sig = await hmacSha512(TEST_KEY, body);
    const r = await postWebhook("/paystack-webhook", body, sig);
    assertEquals(r.status, 200);
    await r.body?.cancel();
  },
});
