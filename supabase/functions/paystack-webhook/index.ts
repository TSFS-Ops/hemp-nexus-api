/**
 * paystack-webhook — clean, dedicated entry point for Paystack webhook
 * deliveries (D-01).
 *
 * Why this exists
 * ───────────────
 * The historical Paystack webhook URL is `…/functions/v1/token-purchase/webhook`.
 * That continues to work and is still the source of truth for the handler
 * logic. This file exposes a separate, dedicated function path
 * (`…/functions/v1/paystack-webhook`) so:
 *
 *   1. Operators can register a clean URL in the Paystack dashboard that
 *      matches the provider name, without coupling to the internal
 *      `token-purchase` function name.
 *   2. `verify_jwt = false` is scoped to ONE function whose only job is
 *      receiving signed webhooks — reducing the auth-bypass blast radius
 *      compared to the polymorphic `token-purchase` function which also
 *      serves authenticated checkout-init traffic.
 *   3. Future Paystack-only changes (rate-limits, IP allow-lists, replay
 *      tuning) can be made here without touching the checkout flow.
 *
 * This handler intentionally re-uses the EXACT same security primitives
 * as the legacy webhook path:
 *
 *   - HMAC-SHA512 signature verification using `PAYSTACK_SECRET_KEY`
 *   - `webhook_replay_guard` body-level replay protection (D-01)
 *   - `token_ledger.request_id` UNIQUE INDEX as the hard idempotency guard
 *   - `atomic_token_credit()` RPC for balance mutation (no read-then-write)
 *
 * It dispatches charge.success / charge.failed / refund.processed /
 * dispute.create by forwarding to the legacy `token-purchase/webhook`
 * function URL with the original signature header preserved. This keeps
 * a SINGLE handler implementation while exposing two URLs — eliminating
 * the risk of behavioural drift between them.
 *
 * Auth: `verify_jwt = false` (set in supabase/config.toml). Signature is
 * the only trust boundary.
 */
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";
import { createClient as _createDemoAdmin } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req: Request): Promise<Response> => {
  // OPS-010: demo orgs must never reach Paystack. Best-effort short-circuit
  // (the inbound webhook normally carries no demo org id, so this is a
  // defence-in-depth shim; the canonical block is in token-purchase).
  try {
    const _demoAdmin = _createDemoAdmin(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "paystack-webhook", artefact: false });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort */ }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!PAYSTACK_SECRET_KEY) {
    console.error("[paystack-webhook] PAYSTACK_SECRET_KEY not configured");
    return new Response("Not configured", { status: 500 });
  }

  const signature = req.headers.get("x-paystack-signature");
  if (!signature) {
    console.warn("[paystack-webhook] Missing x-paystack-signature header");
    return new Response("Missing signature", { status: 400 });
  }

  // Read body ONCE — we need it for both signature verification and the
  // forward call. Using .text() preserves the exact bytes Paystack signed.
  const body = await req.text();

  // Verify HMAC-SHA512 BEFORE doing anything else. We do not even forward
  // unauthenticated requests to the shared handler.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (signature !== expected) {
    console.error("[paystack-webhook] Invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  // Forward to the canonical handler (signature already verified, but the
  // downstream re-verifies as defence-in-depth and applies the
  // webhook_replay_guard + initiation-validation pipeline).
  const forwardUrl = `${SUPABASE_URL}/functions/v1/token-purchase/webhook`;
  const forwarded = await fetch(forwardUrl, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      "x-paystack-signature": signature,
      // Threading the original request id helps trace through both functions.
      "x-request-id": req.headers.get("x-request-id") ?? crypto.randomUUID(),
      // Tag the forward so logs in the canonical handler show this came via
      // the dedicated paystack-webhook entry point.
      "x-paystack-source": "paystack-webhook",
    },
    body,
  });

  // Pass through status + body verbatim so Paystack's retry semantics
  // remain unchanged.
  const respText = await forwarded.text();
  return new Response(respText, {
    status: forwarded.status,
    headers: { "Content-Type": "application/json" },
  });
});
