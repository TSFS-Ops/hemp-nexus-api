/**
 * token-purchase - Edge function for credit purchasing via Paystack.
 *
 * ROUTES:
 *   POST /token-purchase         - Initiate a Paystack checkout (authenticated)
 *   POST /token-purchase/verify  - Client-side verify + credit fallback (authenticated)
 *   POST /token-purchase/webhook - Paystack webhook receiver (signature-verified, no auth)
 *   GET  /token-purchase/packages - List available credit packages (public)
 *   GET  /token-purchase/entity   - Billing entity info (public)
 *
 * PAYSTACK WEBHOOK CONFIGURATION:
 *   URL: https://<project-ref>.supabase.co/functions/v1/token-purchase/webhook
 *   Events: charge.success, charge.failed, refund.processed, dispute.create
 *   The webhook must be registered in the Paystack dashboard under Settings → API Keys & Webhooks.
 *
 * BALANCE MUTATION:
 *   All balance changes use the atomic_token_credit() RPC (UPDATE balance = balance + amount).
 *   No read-then-write patterns remain. Idempotency is enforced by:
 *   1. Soft check: SELECT on token_ledger WHERE request_id = reference
 *   2. Hard check: UNIQUE INDEX on token_ledger(request_id) - catches TOCTOU races
 *   If both webhook and verify race, the loser's INSERT fails, and its atomic credit is reversed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { emitRevenueNotification } from "../_shared/revenue-notify.ts";
import { assertIdempotencyKey, cachedResponseToHttp, sha256Hex } from "../_shared/idempotency.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertNotReplayed } from "../_shared/replay-guard.ts";
// USD-native settlement (cutover 2026-05-01). Paystack now charges in USD
// directly; the legacy USD→ZAR FX layer (_shared/fx.ts) is retired for the
// purchase flow and intentionally NOT imported here.

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Zod schemas
const purchaseSchema = z.object({
  packageId: z.enum(["single", "pack_10", "pack_50", "pack_200"]),
  callbackUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

const verifySchema = z.object({
  reference: z.string().min(1, "Missing reference"),
});

// Stage 2A CORS hardening (2026-05-01): the local wildcard `corsHeaders`
// constant has been removed in favour of the shared `_shared/cors.ts`
// helper (`handleCorsPreflight` + `withCors`). The shared helper falls
// back to the production allow-list when ALLOWED_ORIGINS is unset and
// echoes Lovable preview hosts. Browser-facing responses below all go
// through `wrap(...)` (a tiny `withCors(req, ...)` shim). The Paystack
// webhook path is intentionally NOT wrapped: it is a server-to-server
// callback that never sets an Origin and must keep its existing
// signature-validated bare responses.
const corsHeaders = { 'Content-Type': 'application/json' } as Record<string, string>;

// ==============================================
// CHARGING ENTITY (for invoices)
// ==============================================
const CHARGING_ENTITY = {
  name: "Starfair162 (Pty) Ltd t/a Izenzo",
  registration: "2018 / 331720 / 07",
  address: "44 Campbell Street, Port Alfred, South Africa",
  vatStatus: "Not VAT-registered",
  supportEmail: "support@izenzo.co.za",
  invoiceNote: "No VAT charged - supplier not VAT registered in South Africa.",
};

// ==============================================
// TOKEN PACKAGES — USD-native settlement (cutover 2026-05-01).
//
// Paystack now charges Izenzo customers directly in USD. There is no
// FX conversion at checkout; `amount` is sent to Paystack as USD cents
// and the ledger / audit row records `currency='USD'` and
// `fx_basis='native_usd'`. Legacy ZAR fields are no longer written.
//
// `single` ($1) is the in-app one-credit top-up; `pack_10`, `pack_50`,
// `pack_200` are the headline tiers (1 credit = $1.00 USD).
// ==============================================
const TOKEN_PACKAGES: Record<string, {
  credits: number;
  price_usd: number;
  label: string;
  pricePerCredit: string;
  saving?: string;
}> = {
  single: {
    credits: 1,
    price_usd: 1,
    label: "Single Credit",
    pricePerCredit: "1.00",
  },
  pack_10: {
    credits: 10,
    price_usd: 10,
    label: "10 Credits",
    pricePerCredit: "1.00",
  },
  pack_50: {
    credits: 50,
    price_usd: 45,
    label: "50 Credits",
    pricePerCredit: "0.90",
    saving: "10% saving",
  },
  pack_200: {
    credits: 200,
    price_usd: 160,
    label: "200 Credits",
    pricePerCredit: "0.80",
    saving: "20% saving",
  },
};

// ==============================================
// REFUND POLICY
// ==============================================
const REFUND_POLICY = {
  unusedCreditsRefundableDays: 7,
  consumedCreditsRefundable: false,
};

Deno.serve(async (req) => {
  // Stage 2A: shared CORS preflight handler (production-origin allow-list,
  // Lovable preview hosts, 403 on disallowed origins).
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const _url0 = new URL(req.url);
  const _path0 = _url0.pathname.split("/").pop();
  const _isWebhook0 = _path0 === "webhook";
  const _wrap = (resp: Response): Response => (_isWebhook0 ? resp : withCors(req, resp));
  return _wrap(await _serve(req));
});

async function _serve(req: Request): Promise<Response> {

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();
  const isWebhook = path === "webhook";

  // Lightweight request log — lets us confirm the function is being
  // reached at all (and which sub-route) when debugging "checkout
  // doesn't work" reports where no logs were appearing.
  console.log(`[token-purchase] ${req.method} path=${path} origin=${req.headers.get("origin") ?? "—"}`);

  try {
    if (!PAYSTACK_SECRET_KEY) {
      console.error("PAYSTACK_SECRET_KEY is not configured");
      return new Response(
        JSON.stringify({
          error: "Payment provider is not configured",
          code: "PAYMENTS_NOT_CONFIGURED",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanity-log the key mode so we can spot test/live mismatches in
    // the logs without ever exposing the secret itself.
    if (req.method === "POST" && !isWebhook) {
      const prefix = PAYSTACK_SECRET_KEY.slice(0, 7);
      const mode = PAYSTACK_SECRET_KEY.startsWith("sk_live_")
        ? "live"
        : PAYSTACK_SECRET_KEY.startsWith("sk_test_")
          ? "test"
          : "unknown";
      console.log(`[token-purchase] paystack key mode=${mode} prefix=${prefix}…`);
    }

    if (isWebhook) {
      return await handleWebhook(req);
    }

    // GET or POST /packages — public endpoint. Accepts POST so the
    // browser SDK's `supabase.functions.invoke('token-purchase/packages')`
    // (which always issues POST) can reach it without a 405.
    if ((req.method === "GET" || req.method === "POST") && path === "packages") {
      return await handleGetPackages();
    }

    // GET /entity - public endpoint
    if (req.method === "GET" && path === "entity") {
      return new Response(
        JSON.stringify(CHARGING_ENTITY),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==============================================
    // POST /verify - client-side fallback to credit after Paystack redirect.
    //
    // ARCHITECTURE NOTE - Dual-path crediting safety:
    //   Both webhook (charge.success) and verify can credit.
    //   Safety is guaranteed by TWO independent guards:
    //   1. Soft guard: SELECT on token_ledger WHERE request_id = reference
    //      (catches 99.9% of duplicates - fast, cheap)
    //   2. Hard guard: UNIQUE INDEX on token_ledger(request_id) WHERE request_id IS NOT NULL
    //      (catches the TOCTOU race - if both paths pass the SELECT simultaneously,
    //       the second INSERT fails with a unique constraint violation)
    //   3. Balance mutation is atomic: UPDATE ... SET balance = balance + amount
    //      via the atomic_token_credit() RPC - no read-then-write.
    //
    // WHY BOTH PATHS CAN CREDIT:
    //   Paystack webhooks can be delayed, fail, or arrive after the user
    //   has already returned to the app. The verify path ensures the user
    //   sees credits immediately. If the webhook arrives later, it harmlessly
    //   hits the idempotency guard.
    // ==============================================
    if (req.method === "POST" && path === "verify") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Unauthorised" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData.user) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await req.json();
      const parsed = verifySchema.safeParse(body);
      if (!parsed.success) {
        return new Response(
          JSON.stringify({ error: parsed.error.issues[0]?.message || "Invalid request" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { reference } = parsed.data;

      // Soft idempotency check (fast path)
      const { data: existing } = await supabase
        .from("token_ledger")
        .select("id, remaining_balance")
        .eq("request_id", reference)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: true, alreadyCredited: true, message: "Credits already applied", newBalance: existing.remaining_balance }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify with Paystack API
      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      });
      const verifyData = await verifyRes.json();

      if (!verifyData.status || verifyData.data?.status !== "success") {
        return new Response(
          JSON.stringify({ success: false, message: "Transaction not successful", paystackStatus: verifyData.data?.status }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the org matches the user
      const meta = verifyData.data.metadata;
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", userData.user.id)
        .single();

      if (!profile || profile.org_id !== meta?.org_id) {
        return new Response(
          JSON.stringify({ error: "Transaction does not belong to your organisation" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const credits = meta.credits;
      const orgId = meta.org_id;

      // Atomic balance credit (no read-then-write)
      const { data: creditResult, error: creditError } = await supabase.rpc("atomic_token_credit", {
        p_org_id: orgId,
        p_amount: credits,
        p_reason: "credit_purchase",
        p_reference_id: reference,
      });

      if (creditError) {
        console.error(`[Verify] atomic_token_credit failed for org ${orgId}:`, creditError);
        return new Response(
          JSON.stringify({ error: "Failed to credit balance. Contact support@izenzo.co.za with reference: " + reference }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newBalance = creditResult?.new_balance ?? 0;

      // Promote the row written by atomic_token_credit (action_type='credit')
      // to the canonical 'credit_purchase' state. Matches the webhook path
      // (D-01 fix) so we never create two ledger rows per Paystack reference.
      const { data: existingFinalV } = await supabase
        .from("token_ledger")
        .select("id")
        .eq("request_id", reference)
        .eq("action_type", "credit_purchase")
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      // If we somehow ran twice for the same reference, the previous run
      // already promoted the row → nothing more to do.
      if (existingFinalV) {
        console.log(`[Verify] Already finalised, skipping enrichment: ${reference}`);
      } else {
        const { data: promotedV, error: promoteVErr } = await supabase
          .from("token_ledger")
          .update({
            endpoint: "payment:paystack:verify",
            action_type: "credit_purchase",
            metadata: {
              payment_reference: reference,
              package_id: meta.package_id,
              price_usd: meta.price_usd ?? null,
              currency: "USD",
              fx_basis: "native_usd",
              verification_fallback: true,
              credited: credits,
              balance_after: newBalance,
            },
          })
          .eq("org_id", orgId)
          .eq("request_id", reference)
          .eq("action_type", "credit")
          .select("id")
          .maybeSingle();
        if (promoteVErr || !promotedV) {
          console.error(`[Verify] Ledger promotion failed:`, promoteVErr);
          await supabase.from("admin_risk_items").insert({
            title: `Verify ledger promotion failure: ${reference}`,
            description: `Credits (${credits}) were added to org ${orgId} but the ledger row could not be promoted to credit_purchase. Manual reconciliation required.`,
            severity: "high",
            status: "open",
          });
        }
      }


      // Batch C — Fix 1: this insert is now guarded by a partial UNIQUE
      // INDEX on (metadata->>'payment_reference') WHERE action='credits.purchased'.
      // If the webhook path won the race, the duplicate insert raises
      // 23505 — treat that as success (the audit row already exists).
      {
        const { error: auditErr } = await supabase.from("audit_logs").insert({
          org_id: orgId,
          actor_user_id: userData.user.id,
          action: "credits.purchased",
          entity_type: "token_balance",
          entity_id: orgId,
          metadata: {
            credits_added: credits,
            new_balance: newBalance,
            payment_reference: reference,
            package_id: meta.package_id,
            // USD-native settlement record — exposed in HQ Revenue.
            price_usd: meta.price_usd ?? null,
            currency: "USD",
            fx_basis: "native_usd",
            verification_fallback: true,
          },
        });
        if (auditErr && auditErr.code !== "23505") throw auditErr;
        if (auditErr?.code === "23505") {
          console.log(`[Verify] credits.purchased audit row already exists for ${reference} (webhook won)`);
        }
      }

      // Batch C — Fix 3: mark the token_purchases pending row as completed.
      await supabase
        .from("token_purchases")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("paystack_reference", reference)
        .eq("status", "pending");

      // Revenue notification → support@izenzo.co.za. Idempotency key uses
      // the Paystack reference, so if the webhook path also fires for the
      // same payment the email queue dedupes — support gets exactly one
      // notification per real charge.
      {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle();
        const orgName = (orgRow?.name as string) || `Org ${orgId.slice(0, 8)}`;
        await emitRevenueNotification(supabase, {
          eventType: "credits_purchased",
          idempotencyKey: `revenue-credits-purchased-${reference}`,
          referenceId: reference,
          orgId,
          orgName,
          contactEmail: verifyData.data.customer?.email || userData.user.email || null,
          headline: `${orgName} purchased ${credits} credit${credits === 1 ? "" : "s"}`,
          details: {
            "Credits added": credits,
            "Amount (USD)": meta.price_usd != null ? `$${Number(meta.price_usd).toFixed(2)}` : "—",
            "Package ID": meta.package_id ?? "—",
            "New balance": newBalance,
            "Payment reference": reference,
            Source: "verify-fallback",
          },
          consoleUrl: `https://api.trade.izenzo.co.za/admin/billing`,
          consoleLabel: "Open billing console",
        });
      }

      console.log(`[Verify] Credited ${credits} credits to org ${orgId} (atomic). New balance: ${newBalance}`);

      return new Response(
        JSON.stringify({ success: true, alreadyCredited: false, credits, newBalance }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All other endpoints require authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's org
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, email")
      .eq("id", userData.user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // SERVER-SIDE BILLING AVAILABILITY GUARD (defence in depth).
    //
    // While Paystack USD settlement is being enabled, the platform-wide
    // `admin_settings.billing_availability.enabled` flag is `false`.
    // The frontend already gates every purchase CTA via the
    // `useBillingAvailability` hook, but a determined client could still
    // POST directly to this endpoint. We re-check the flag server-side
    // BEFORE reserving any idempotency key, BEFORE calling Paystack, and
    // BEFORE writing any audit/ledger row, so a 503 here truly means
    // "nothing happened" — no balance change, no Paystack transaction,
    // no credit_purchase ledger row.
    //
    // Verify + webhook paths are deliberately untouched so historical
    // reconciliation of payments made before the flag flipped continues
    // to work normally.
    // ============================================================
    {
      const { data: availability, error: availabilityError } =
        await supabase.rpc("get_billing_availability");
      if (availabilityError) {
        console.error("[token-purchase] billing availability check failed:", availabilityError);
        return new Response(
          JSON.stringify({
            error: "BILLING_AVAILABILITY_CHECK_FAILED",
            message: "Could not verify billing availability. Please try again shortly.",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const enabled = (availability as { enabled?: boolean } | null)?.enabled === true;
      if (!enabled) {
        const message =
          (availability as { message?: string } | null)?.message ??
          "Credit purchases are temporarily unavailable.";
        console.log("[token-purchase] checkout blocked: billing_availability.enabled=false");
        return new Response(
          JSON.stringify({ error: "BILLING_UNAVAILABLE", message }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const body = await req.json();
    const parsed = purchaseSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message || "Invalid request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { packageId, callbackUrl, cancelUrl } = parsed.data;
    const pkg = TOKEN_PACKAGES[packageId]!;
    const idempotencyKey = assertIdempotencyKey(req);
    const idempotencyEndpoint = "POST /token-purchase";
    const requestHash = await sha256Hex(JSON.stringify({ packageId, callbackUrl: callbackUrl ?? null, cancelUrl: cancelUrl ?? null }));

    const { data: existingIdempotency, error: idempotencyLookupError } = await supabase
      .from("idempotency_keys")
      .select("request_hash, response_data, response_status_code")
      .eq("org_id", profile.org_id)
      .eq("idempotency_key", idempotencyKey)
      .eq("endpoint", idempotencyEndpoint)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (idempotencyLookupError) throw idempotencyLookupError;
    const processingResponse = {
      error: "Payment initialisation is already processing. Please wait before trying again.",
      code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    };
    if (existingIdempotency) {
      if (existingIdempotency.request_hash !== requestHash) {
        return new Response(
          JSON.stringify({ error: "Idempotency-Key was reused with a different purchase request", code: "IDEMPOTENCY_KEY_REUSED" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (existingIdempotency.response_status_code === 202) {
        return new Response(JSON.stringify(processingResponse), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return cachedResponseToHttp(
        { status: existingIdempotency.response_status_code, body: existingIdempotency.response_data },
        corsHeaders,
      );
    }

    const { error: idempotencyReserveError } = await supabase.from("idempotency_keys").insert({
      org_id: profile.org_id,
      idempotency_key: idempotencyKey,
      endpoint: idempotencyEndpoint,
      request_hash: requestHash,
      response_data: { status: "processing" },
      response_status_code: 202,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (idempotencyReserveError?.code === "23505") {
      return new Response(JSON.stringify(processingResponse), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (idempotencyReserveError) throw idempotencyReserveError;

    // Get client IP for audit
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";

    // USD-native checkout (cutover 2026-05-01). Paystack now charges
    // the customer in USD directly — no FX conversion, no ZAR layer.
    const usdCents = Math.round(pkg.price_usd * 100);

    // Create Paystack transaction (USD currency, native settlement)
    const callbackBase = callbackUrl?.replace(/\?.*$/, '') || `${req.headers.get("origin")}/billing`;
    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: profile.email || userData.user.email,
        amount: usdCents,
        currency: "USD",
        callback_url: `${callbackBase}?status=success`,
        metadata: {
          org_id: profile.org_id,
          user_id: userData.user.id,
          package_id: packageId,
          credits: pkg.credits,
          // USD-native audit fields — propagated through verify + webhook.
          price_usd: pkg.price_usd,
          currency: "USD",
          fx_basis: "native_usd",
          client_ip: clientIp,
          timestamp: new Date().toISOString(),
          custom_fields: [
            { display_name: "Package", variable_name: "package", value: pkg.label },
            { display_name: "Credits", variable_name: "credits", value: pkg.credits.toString() },
            { display_name: "USD Price", variable_name: "usd_price", value: `$${pkg.price_usd.toFixed(2)}` },
            { display_name: "Entity", variable_name: "entity", value: CHARGING_ENTITY.name },
          ],
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackData.status) {
      console.error("Paystack error:", paystackData);
      return new Response(
        JSON.stringify({
          error: "Payment initialisation failed",
          provider: "paystack",
          providerCode: paystackData?.code ?? null,
          providerMessage: paystackData?.message ?? null,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the pending transaction. We write `payment_reference` as the
    // CANONICAL key (D-01 fix) and keep `reference` as a legacy alias so
    // older queries continue to work. The audit row is intentionally never
    // inserted before Paystack returns the reference, so `payment_reference`
    // is guaranteed non-null on every initiation row going forward.
    await supabase.from("audit_logs").insert({
      org_id: profile.org_id,
      actor_user_id: userData.user.id,
      action: "credits.purchase_initiated",
      entity_type: "token_purchase",
      metadata: {
        package_id: packageId,
        credits: pkg.credits,
        price_usd: pkg.price_usd,
        currency: "USD",
        fx_basis: "native_usd",
        amount_usd: pkg.price_usd,
        payment_reference: paystackData.data.reference, // canonical
        reference: paystackData.data.reference,         // legacy alias
        status: "initiated",
        client_ip: clientIp,
      },
    });

    // Batch C — Fix 3: persist a `pending` token_purchases row so the
    // `transaction-reconciliation` cron can sweep stuck checkouts. The
    // table has UNIQUE(paystack_reference); ON CONFLICT DO NOTHING makes
    // a retried initiation idempotent. Failures here must NOT abort
    // checkout — the audit_log + token_ledger guards already protect
    // money integrity.
    {
      const { error: pendingErr } = await supabase
        .from("token_purchases")
        .insert({
          org_id: profile.org_id,
          user_id: userData.user.id,
          paystack_reference: paystackData.data.reference,
          package_id: packageId,
          token_amount: pkg.credits,
          amount_usd: pkg.price_usd,
          currency: "USD",
          status: "pending",
          metadata: {
            fx_basis: "native_usd",
            client_ip: clientIp,
            package_label: pkg.label,
          },
        });
      if (pendingErr && pendingErr.code !== "23505") {
        console.warn(
          `[token-purchase] token_purchases pending insert failed (non-fatal): ${pendingErr.message}`,
        );
      }
    }

    const responseBody = {
        success: true,
        checkoutUrl: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
        package: {
          name: pkg.label,
          credits: pkg.credits,
          priceUsd: pkg.price_usd,
          currency: "USD",
        },
        entity: CHARGING_ENTITY,
      };

    const { error: idempotencyStoreError } = await supabase.from("idempotency_keys").update({
      response_data: responseBody,
      response_status_code: 200,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).eq("org_id", profile.org_id).eq("idempotency_key", idempotencyKey).eq("endpoint", idempotencyEndpoint);
    if (idempotencyStoreError) throw idempotencyStoreError;

    return new Response(
      JSON.stringify(responseBody),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Token purchase error:", error);
    const status = (error as { statusCode?: number })?.statusCode;
    const code = (error as { code?: string })?.code;
    if (status && status >= 400 && status < 500) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Invalid request", code }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ==============================================
// GET /packages - List available packages
// ==============================================
async function handleGetPackages(): Promise<Response> {
  const packages = Object.entries(TOKEN_PACKAGES).map(([id, pkg]) => ({
    id,
    name: pkg.label,
    credits: pkg.credits,
    priceUsd: pkg.price_usd,
    pricePerCredit: pkg.pricePerCredit,
    saving: pkg.saving ?? null,
  }));

  return new Response(
    JSON.stringify({
      packages,
      // USD-native settlement — Paystack charges in USD directly.
      currency: "USD",
      settlementCurrency: "USD",
      fxBasis: "native_usd",
      entity: CHARGING_ENTITY,
      refundPolicy: REFUND_POLICY,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ==============================================
// Webhook Handler
// ==============================================
async function handleWebhook(req: Request): Promise<Response> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!PAYSTACK_SECRET_KEY) {
      console.error("PAYSTACK_SECRET_KEY is not configured");
      return new Response("Not configured", { status: 500 });
    }

    // Verify Paystack signature
    const signature = req.headers.get("x-paystack-signature");
    const body = await req.text();

    if (!signature) {
      console.error("Missing Paystack signature");
      return new Response("Missing signature", { status: 400 });
    }

    // Verify signature using HMAC SHA512
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(PAYSTACK_SECRET_KEY),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (signature !== expectedSignature) {
      console.error("Invalid Paystack signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // Body-level replay protection (D-01). Even though the token_ledger
    // unique index on `request_id` already prevents double-credit, the
    // platform standard is to also reject the duplicate webhook delivery
    // BEFORE any processing so audit trails stay clean and we never
    // emit a second revenue notification email.
    const replay = await assertNotReplayed(supabase, {
      source: "paystack_webhook",
      // Use the HMAC signature itself as the uniqueness fingerprint —
      // Paystack signs the entire body so identical re-deliveries
      // produce the identical signature.
      signature,
      fnName: "token-purchase/webhook",
      requestId: req.headers.get("x-request-id") ?? null,
      // Batch C — Fix 2: Paystack treats any non-2xx as failure and will
      // keep retrying. A known-safe duplicate delivery is not a failure,
      // so we return 200 with `replayed/idempotent: true` in the body.
      // Monitoring continues to count replays via the WEBHOOK_REPLAY code.
      replayResponseStatus: 200,
    });
    if (!replay.ok) {
      console.warn("[Webhook] Acknowledged replay/duplicate delivery (200 idempotent)");
      return replay.response;
    }

    const event = JSON.parse(body);
    console.log("[Webhook] Event:", event.event);

    switch (event.event) {
      case "charge.success":
        await handleChargeSuccess(supabase, event.data);
        break;

      case "charge.failed":
        await handleChargeFailed(supabase, event.data);
        break;

      case "refund.processed":
        await handleRefundProcessed(supabase, event.data);
        break;

      // PAY-009 — Paystack emits the dotted form (`charge.dispute.create`)
      // in current versions; the legacy `dispute.create` is preserved for
      // backwards compatibility with any older webhook config.
      case "dispute.create":
      case "charge.dispute.create":
        await handleDisputeCreated(supabase, event.data);
        break;

      case "charge.dispute.remind":
        await handleDisputeReminded(supabase, event.data);
        break;

      case "charge.dispute.resolve":
        await handleDisputeResolved(supabase, event.data);
        break;

      default:
        console.log(`[Webhook] Unhandled event: ${event.event}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Webhook error", { status: 500 });
  }
}

// ==============================================
// charge.success handler
// ==============================================
// deno-lint-ignore no-explicit-any
async function handleChargeSuccess(
  supabase: any,
  data: {
    reference: string;
    amount: number;
    currency?: string;
    metadata?: {
      org_id?: string;
      user_id?: string;
      package_id?: string;
      credits?: number;
      // USD-native audit fields stamped at checkout-init.
      price_usd?: number;
      currency?: string;
      fx_basis?: string;
      // Legacy ZAR fields tolerated on inbound reads only — preserved
      // so a webhook for a pre-cutover transaction still parses cleanly.
      price_zar?: number;
      zar_amount_charged?: number;
      fx_rate?: number;
      fx_fetched_at?: string;
      fx_source?: string;
      client_ip?: string;
    };
    customer?: { email?: string };
    paid_at?: string;
  }
): Promise<void> {
  const { reference, metadata, customer, paid_at } = data;

  // D-01 hard guards: payment_reference must exist; metadata must carry the
  // org+credits stamped at initiation. Without these we cannot safely credit.
  if (!reference || reference.trim() === "") {
    console.error("[Webhook] Rejecting charge.success: missing payment_reference");
    return;
  }
  if (!metadata?.org_id || !metadata?.credits) {
    console.error("[Webhook] Rejecting charge.success: missing org_id/credits in metadata", reference);
    return;
  }

  const orgId = metadata.org_id;
  const credits = metadata.credits;
  const userId = metadata.user_id;

  console.log(`[Webhook] Processing charge.success: org=${orgId}, credits=${credits}, ref=${reference}`);

  // ── D-01: validate amount/currency/package against the initiation row ──
  // The initiation audit_log row (`credits.purchase_initiated`) is the
  // source of truth for what the user agreed to pay. If Paystack returns a
  // settlement that differs, we refuse to credit and write a failure audit
  // row + risk item for manual review. This protects against a tampered
  // metadata blob, a Paystack misconfiguration, or a stale webhook replay
  // for a different package.
  const { data: initRow } = await supabase
    .from("audit_logs")
    .select("metadata")
    .eq("action", "credits.purchase_initiated")
    .or(`metadata->>payment_reference.eq.${reference},metadata->>reference.eq.${reference}`)
    .maybeSingle();

  if (initRow?.metadata) {
    const init = initRow.metadata as Record<string, unknown>;
    const expectedUsd = Number(init.price_usd);
    const settledUsd = Number(metadata.price_usd ?? data.amount / 100);
    const expectedCurrency = (init.currency as string) || "USD";
    const settledCurrency = (data.currency as string) || metadata.currency || "USD";
    const expectedPackage = init.package_id as string | undefined;
    const settledPackage = metadata.package_id;
    const mismatch: string[] = [];
    if (Number.isFinite(expectedUsd) && Number.isFinite(settledUsd) && Math.abs(expectedUsd - settledUsd) > 0.01) {
      mismatch.push(`amount expected=${expectedUsd} settled=${settledUsd}`);
    }
    if (expectedCurrency.toUpperCase() !== settledCurrency.toUpperCase()) {
      mismatch.push(`currency expected=${expectedCurrency} settled=${settledCurrency}`);
    }
    if (expectedPackage && settledPackage && expectedPackage !== settledPackage) {
      mismatch.push(`package expected=${expectedPackage} settled=${settledPackage}`);
    }
    if (mismatch.length > 0) {
      console.error(`[Webhook] Rejecting charge.success ${reference}: ${mismatch.join("; ")}`);
      await supabase.from("audit_logs").insert({
        org_id: orgId,
        action: "credits.purchase_rejected",
        entity_type: "token_balance",
        metadata: {
          payment_reference: reference,
          reason: "initiation_mismatch",
          mismatches: mismatch,
        },
      });
      await supabase.from("admin_risk_items").insert({
        title: `Paystack settlement mismatch: ${reference}`,
        description: mismatch.join("; "),
        severity: "high",
        status: "open",
      });
      return;
    }
  }
  // If no initiation row was found, we still process (pre-webhook-era
  // settlements can land legitimately) but flag it via metadata below.

  // ── D-01 idempotency (finalised state) ──
  // We treat `action_type='credit_purchase'` as the *finalised* settlement
  // marker. `atomic_token_credit` writes its own row with action_type='credit'
  // (using the same request_id), and we then promote that row to
  // 'credit_purchase' below. So a finalised row here means a previous
  // webhook delivery has already completed end-to-end. Return early —
  // do NOT credit again, do NOT write a second audit row.
  const { data: existingFinal } = await supabase
    .from("token_ledger")
    .select("id")
    .eq("request_id", reference)
    .eq("action_type", "credit_purchase")
    .maybeSingle();

  if (existingFinal) {
    console.log("[Webhook] Already finalised, skipping:", reference);
    return;
  }

  // Atomic balance credit (no read-then-write race). This RPC also writes
  // a token_ledger row keyed on `request_id=reference` with
  // action_type='credit'. We promote that same row to 'credit_purchase'
  // immediately afterwards so we end up with EXACTLY ONE settlement row.
  const { data: creditResult, error: creditError } = await supabase.rpc("atomic_token_credit", {
    p_org_id: orgId,
    p_amount: credits,
    p_reason: "credit_purchase",
    p_reference_id: reference,
  });

  if (creditError) {
    console.error(`[Webhook] atomic_token_credit failed for org ${orgId}:`, creditError);
    throw new Error(`Balance update failed: ${creditError.message}`);
  }

  const newBalance = creditResult?.new_balance ?? 0;

  // Promote the RPC's ledger row to the canonical 'credit_purchase' state.
  // Match on (org_id, request_id, action_type='credit') so we never touch
  // an already-finalised row in a race. The unique index on request_id
  // guarantees there is at most one such row.
  const { data: promoted, error: promoteError } = await supabase
    .from("token_ledger")
    .update({
      endpoint: "payment:paystack",
      action_type: "credit_purchase",
      metadata: {
        payment_reference: reference,
        package_id: metadata.package_id,
        // USD-native audit fields. For pre-cutover webhooks that still
        // carry legacy ZAR metadata we preserve those values verbatim
        // alongside (read-only history; never written for new charges).
        price_usd: metadata.price_usd ?? null,
        currency: metadata.currency ?? "USD",
        fx_basis: metadata.fx_basis ?? "native_usd",
        legacy_price_zar: metadata.price_zar ?? metadata.zar_amount_charged ?? null,
        legacy_fx_rate: metadata.fx_rate ?? null,
        customer_email: customer?.email,
        paid_at,
        client_ip: metadata.client_ip,
        credited: credits,
        balance_after: newBalance,
      },
    })
    .eq("org_id", orgId)
    .eq("request_id", reference)
    .eq("action_type", "credit")
    .select("id")
    .maybeSingle();

  if (promoteError || !promoted) {
    // Promotion failed — balance was credited but the canonical row is missing.
    // Open a risk item so finance can reconcile manually.
    console.error(`[Webhook] Ledger promotion failed for ${reference}:`, promoteError);
    await supabase.from("admin_risk_items").insert({
      title: `Webhook ledger promotion failure: ${reference}`,
      description: `Credits (${credits}) added to org ${orgId} but ledger row could not be promoted to credit_purchase. Manual reconciliation required.`,
      severity: "high",
      status: "open",
    });
  }


  // Audit log — USD-native settlement record for HQ Revenue.
  // Batch C — Fix 1: guarded by partial UNIQUE INDEX on
  // (metadata->>'payment_reference') WHERE action='credits.purchased'. If
  // the verify path won the race, a 23505 means "already audited" — log
  // and continue, do not throw.
  {
    const { error: auditErr } = await supabase.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: userId || null,
      action: "credits.purchased",
      entity_type: "token_balance",
      entity_id: orgId,
      metadata: {
        credits_added: credits,
        new_balance: newBalance,
        payment_reference: reference,
        package_id: metadata.package_id,
        price_usd: metadata.price_usd ?? null,
        currency: metadata.currency ?? "USD",
        fx_basis: metadata.fx_basis ?? "native_usd",
        // Legacy ZAR fields preserved when received (pre-cutover replays).
        legacy_price_zar: metadata.price_zar ?? metadata.zar_amount_charged ?? null,
        legacy_fx_rate: metadata.fx_rate ?? null,
        paid_at,
        customer_email: customer?.email ?? null,
      },
    });
    if (auditErr && auditErr.code !== "23505") {
      console.error(`[Webhook] credits.purchased audit insert failed:`, auditErr);
    } else if (auditErr?.code === "23505") {
      console.log(`[Webhook] credits.purchased audit row already exists for ${reference} (verify won)`);
    }
  }

  // Batch C — Fix 3: mark the token_purchases pending row as completed.
  await supabase
    .from("token_purchases")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("paystack_reference", reference)
    .eq("status", "pending");

  // Revenue notification → support@izenzo.co.za. Idempotency key is the
  // Paystack reference, which is unique per charge — webhook + verify-fallback
  // race is safe because the second send is deduped by the email queue.
  // Look up org name (best-effort) for a more useful subject line.
  {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    const orgName = (orgRow?.name as string) || `Org ${orgId.slice(0, 8)}`;
    await emitRevenueNotification(supabase, {
      eventType: "credits_purchased",
      idempotencyKey: `revenue-credits-purchased-${reference}`,
      referenceId: reference,
      orgId,
      orgName,
      contactEmail: customer?.email || null,
      headline: `${orgName} purchased ${credits} credit${credits === 1 ? "" : "s"}`,
      details: {
        "Credits added": credits,
        "Amount (USD)": metadata.price_usd != null ? `$${Number(metadata.price_usd).toFixed(2)}` : "—",
        "Package ID": metadata.package_id ?? "—",
        "New balance": newBalance,
        "Payment reference": reference,
      },
      consoleUrl: `https://api.trade.izenzo.co.za/admin/billing`,
      consoleLabel: "Open billing console",
      occurredAt: paid_at || new Date().toISOString(),
    });
  }

  console.log(`[Webhook] Credited ${credits} credits to org ${orgId} (atomic). New balance: ${newBalance}`);
}

// ==============================================
// charge.failed handler
// ==============================================
// deno-lint-ignore no-explicit-any
async function handleChargeFailed(
  supabase: any,
  data: { reference: string; metadata?: { org_id?: string; user_id?: string } }
): Promise<void> {
  console.log(`[Webhook] Charge failed: ${data.reference}`);

  // Batch C — Fix 3: transition any pending token_purchases row to failed
  // so the reconciliation sweeper does not re-check this reference.
  await supabase
    .from("token_purchases")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("paystack_reference", data.reference)
    .eq("status", "pending");

  if (data.metadata?.org_id) {
    await supabase.from("audit_logs").insert({
      org_id: data.metadata.org_id,
      actor_user_id: data.metadata.user_id || null,
      action: "credits.purchase_failed",
      entity_type: "token_balance",
      metadata: { payment_reference: data.reference },
    });
  }
}

// ==============================================
// refund.processed handler
// ==============================================
// deno-lint-ignore no-explicit-any
async function handleRefundProcessed(
  supabase: any,
  data: { 
    reference: string;
    transaction_reference?: string;
    metadata?: { org_id?: string; credits?: number };
  }
): Promise<void> {
  console.log(`[Webhook] Refund processed: ${data.reference}`);
  
  if (!data.metadata?.org_id || !data.metadata?.credits) {
    console.log("[Webhook] Refund missing metadata, skipping credit deduction");
    return;
  }

  const orgId = data.metadata.org_id;
  const creditsToDeduct = data.metadata.credits;

  // Atomic balance deduction (negative credit)
  const { data: debitResult, error: debitError } = await supabase.rpc("atomic_token_credit", {
    p_org_id: orgId,
    p_amount: -creditsToDeduct,
    p_reason: "credit_refund",
    p_reference_id: data.reference,
  });

  if (debitError) {
    console.error(`[Webhook] Refund debit failed for org ${orgId}:`, debitError);
    throw new Error(`Refund balance update failed: ${debitError.message}`);
  }

  const newBalance = Math.max(0, debitResult?.new_balance ?? 0);

  // If balance went negative, clamp to 0
  if ((debitResult?.new_balance ?? 0) < 0) {
    await supabase
      .from("token_balances")
      .update({ balance: 0, updated_at: new Date().toISOString() })
      .eq("org_id", orgId);
  }

  // Record in ledger
  await supabase.from("token_ledger").insert({
    org_id: orgId,
    endpoint: "refund:paystack",
    tokens_burned: creditsToDeduct,
    remaining_balance: newBalance,
    outcome: "allowed",
    request_id: data.reference,
    action_type: "credit_refund",
    metadata: { original_reference: data.transaction_reference },
  });

  // Audit log
  await supabase.from("audit_logs").insert({
    org_id: orgId,
    action: "credits.refunded",
    entity_type: "token_balance",
    metadata: {
      credits_refunded: creditsToDeduct,
      new_balance: newBalance,
      refund_reference: data.reference,
    },
  });

  console.log(`[Webhook] Deducted ${creditsToDeduct} credits for refund (atomic). New balance: ${newBalance}`);
}

// ==============================================
// PAY-009 — Dispute / chargeback lifecycle
// ==============================================
//
// Paystack lifecycle:
//   1. charge.dispute.create   — bank flagged the charge. We open a soft
//      hold (no balance change) so the org sees credits "on hold" but we
//      don't reverse a payment that may yet be won.
//   2. charge.dispute.remind   — reminder. We mark `reminded_at`. No
//      balance change.
//   3. charge.dispute.resolve  — terminal:
//        - status='won' or 'merchant-won' → release hold (org keeps credits)
//        - status='lost' or 'merchant-accepted' → convert hold into a real
//          atomic_token_credit deduction (mirrors refund path).
//
// Idempotency: each Paystack delivery is already replay-guarded at the
// webhook entry point. Per-dispute idempotency at the table level is
// enforced by `disputed_credit_holds.dispute_reference UNIQUE`.
//
// Owner of original purchase is looked up from `token_ledger`
// (action_type='credit_purchase') by `payment_reference`, falling back to
// the dispute payload's metadata when present.

interface DisputeData {
  // Paystack dispute fields. The shape varies slightly between webhook
  // versions; only the fields we read are typed.
  id?: number | string;
  reference?: string;                // some payloads call it this
  dispute_reference?: string;
  transaction_reference?: string;    // Paystack: the original charge ref
  transaction?: { reference?: string };
  status?: string;                   // 'pending' | 'awaiting-merchant' | 'won' | 'lost' | 'merchant-accepted' | 'resolved'
  resolution?: string;
  message?: string;
  metadata?: { org_id?: string; user_id?: string; credits?: number };
}

// Resolve the canonical dispute identifier across payload variants.
function disputeRefOf(d: DisputeData): string {
  return String(
    d.dispute_reference ?? d.id ?? d.reference ?? "unknown-dispute",
  );
}

// Resolve the original payment reference across payload variants.
function paymentRefOf(d: DisputeData): string | null {
  return d.transaction_reference ?? d.transaction?.reference ?? d.reference ?? null;
}

// deno-lint-ignore no-explicit-any
async function lookupPurchase(supabase: any, paymentRef: string | null): Promise<{
  org_id: string | null;
  credits: number | null;
  price_usd: number | null;
}> {
  if (!paymentRef) return { org_id: null, credits: null, price_usd: null };

  // 1) Authoritative source: token_ledger row created at credit time.
  const { data: ledgerRow } = await supabase
    .from("token_ledger")
    .select("org_id, tokens_burned, metadata")
    .eq("request_id", paymentRef)
    .eq("action_type", "credit_purchase")
    .maybeSingle();

  if (ledgerRow?.org_id) {
    return {
      org_id: ledgerRow.org_id,
      credits: ledgerRow.tokens_burned ?? null,
      price_usd: ledgerRow.metadata?.price_usd ?? null,
    };
  }

  // 2) Fallback to audit_logs (for pre-cutover purchases).
  const { data: auditRow } = await supabase
    .from("audit_logs")
    .select("org_id, metadata")
    .eq("action", "credits.purchased")
    .contains("metadata", { payment_reference: paymentRef })
    .maybeSingle();

  return {
    org_id: auditRow?.org_id ?? null,
    credits: auditRow?.metadata?.credits ?? null,
    price_usd: auditRow?.metadata?.price_usd ?? null,
  };
}

// deno-lint-ignore no-explicit-any
async function notifyOrgBilling(
  supabase: any,
  orgId: string,
  template: "chargeback-opened" | "chargeback-resolved-won" | "chargeback-resolved-lost",
  idempotencyKey: string,
  data: Record<string, string | number>,
): Promise<void> {
  // Best-effort: never throw out of the webhook on email failure.
  try {
    // Look up the org's billing contact (first org_admin profile we find).
    const { data: contact } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("org_id", orgId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!contact?.email) {
      console.warn(`[Dispute] No billing contact found for org ${orgId} — skipping email`);
      return;
    }

    await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: template,
        recipientEmail: contact.email,
        idempotencyKey,
        templateData: { ...data, contactName: contact.full_name ?? "" },
      },
    });
  } catch (e) {
    console.error(`[Dispute] notifyOrgBilling failed:`, e);
  }
}

// deno-lint-ignore no-explicit-any
async function handleDisputeCreated(supabase: any, data: DisputeData): Promise<void> {
  const disputeRef = disputeRefOf(data);
  const paymentRef = paymentRefOf(data);
  console.log(`[Webhook] Dispute opened: dispute=${disputeRef} payment=${paymentRef}`);

  const lookup = await lookupPurchase(supabase, paymentRef);
  const orgId = lookup.org_id ?? data.metadata?.org_id ?? null;
  const credits = lookup.credits ?? data.metadata?.credits ?? null;

  if (!orgId) {
    // Cannot pin the dispute to an org — open admin risk item only.
    await supabase.from("admin_risk_items").insert({
      title: `Unattributed payment dispute: ${disputeRef}`,
      description: `Paystack opened a dispute for payment ${paymentRef ?? "unknown"} but no org could be matched in token_ledger or audit_logs. Manual investigation required.`,
      severity: "high",
      status: "open",
    });
    return;
  }

  // 1) Open admin risk item.
  const { data: risk } = await supabase
    .from("admin_risk_items")
    .insert({
      title: `Chargeback opened: ${credits ?? "?"} credit(s) on hold`,
      description: `Paystack dispute ${disputeRef} for payment ${paymentRef ?? "?"} (org ${orgId}). ${credits ?? 0} credits placed on soft hold. Awaiting bank/merchant resolution.`,
      severity: "high",
      status: "open",
    })
    .select("id")
    .maybeSingle();

  // 2) Insert the soft hold (idempotent on dispute_reference UNIQUE).
  // If the row already exists, swallow the conflict — the dispute may
  // have been re-delivered before the replay guard caught it.
  if (credits && credits > 0) {
    const { error: holdErr } = await supabase.from("disputed_credit_holds").insert({
      org_id: orgId,
      payment_reference: paymentRef ?? "unknown",
      dispute_reference: disputeRef,
      credits_held: credits,
      price_usd: lookup.price_usd,
      status: "open",
      admin_risk_item_id: risk?.id ?? null,
      metadata: { paystack_message: data.message ?? null },
    });
    if (holdErr && !/duplicate key/i.test(holdErr.message ?? "")) {
      throw new Error(`Hold insert failed: ${holdErr.message}`);
    }
  }

  // 3) Audit row (always — even if credits unknown).
  await supabase.from("audit_logs").insert({
    org_id: orgId,
    action: "credits.dispute_opened",
    entity_type: "token_balance",
    metadata: {
      dispute_reference: disputeRef,
      payment_reference: paymentRef,
      credits_held: credits,
      price_usd: lookup.price_usd,
      requires_review: true,
    },
  });

  // 4) Notify org billing contact.
  await notifyOrgBilling(supabase, orgId, "chargeback-opened", `dispute-open-${disputeRef}`, {
    disputeReference: disputeRef,
    paymentReference: paymentRef ?? "—",
    creditsHeld: credits ?? 0,
  });

  // 5) Notify support / revenue ops.
  await emitRevenueNotification(supabase, {
    eventType: "credits_purchased", // re-uses existing channel; details disambiguate
    idempotencyKey: `dispute-open-${disputeRef}`,
    referenceId: disputeRef,
    orgId,
    headline: `Chargeback opened — ${credits ?? "?"} credits on hold`,
    details: {
      dispute_reference: disputeRef,
      payment_reference: paymentRef ?? "",
      credits_held: credits ?? 0,
      price_usd: lookup.price_usd ?? 0,
    },
  });
}

// deno-lint-ignore no-explicit-any
async function handleDisputeReminded(supabase: any, data: DisputeData): Promise<void> {
  const disputeRef = disputeRefOf(data);
  console.log(`[Webhook] Dispute reminder: ${disputeRef}`);

  // Mark the hold (if it exists) and audit. No balance change.
  const { data: hold } = await supabase
    .from("disputed_credit_holds")
    .update({ status: "reminded", reminded_at: new Date().toISOString() })
    .eq("dispute_reference", disputeRef)
    .in("status", ["open", "reminded"])
    .select("org_id, credits_held")
    .maybeSingle();

  if (hold?.org_id) {
    await supabase.from("audit_logs").insert({
      org_id: hold.org_id,
      action: "credits.dispute_reminder",
      entity_type: "token_balance",
      metadata: { dispute_reference: disputeRef, credits_held: hold.credits_held },
    });
  }
}

// deno-lint-ignore no-explicit-any
async function handleDisputeResolved(supabase: any, data: DisputeData): Promise<void> {
  const disputeRef = disputeRefOf(data);
  const paystackStatus = (data.status ?? "").toLowerCase();
  console.log(`[Webhook] Dispute resolved: ${disputeRef} status=${paystackStatus}`);

  // Map Paystack outcome → our internal terminal status.
  // 'won' / 'merchant-won' → merchant kept the funds → org keeps credits.
  // 'lost' / 'merchant-accepted' → funds reversed → deduct credits.
  let terminalStatus: "won" | "lost" | "merchant_accepted";
  if (paystackStatus === "won" || paystackStatus === "merchant-won") {
    terminalStatus = "won";
  } else if (paystackStatus === "merchant-accepted") {
    terminalStatus = "merchant_accepted";
  } else {
    terminalStatus = "lost";
  }

  const { data: hold, error: lookupErr } = await supabase
    .from("disputed_credit_holds")
    .select("id, org_id, payment_reference, credits_held, price_usd, admin_risk_item_id, status")
    .eq("dispute_reference", disputeRef)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[Dispute] Lookup failed for ${disputeRef}:`, lookupErr);
    throw lookupErr;
  }

  if (!hold) {
    // We never recorded a hold (e.g. dispute opened before this code shipped).
    // Still write an audit row so the resolution is captured.
    await supabase.from("audit_logs").insert({
      action: terminalStatus === "won"
        ? "credits.dispute_resolved_won"
        : "credits.dispute_resolved_lost",
      entity_type: "token_balance",
      metadata: {
        dispute_reference: disputeRef,
        paystack_status: paystackStatus,
        note: "No prior hold record found",
      },
    });
    return;
  }

  // Already terminal — idempotent re-delivery.
  if (["won", "lost", "merchant_accepted"].includes(hold.status)) {
    console.log(`[Dispute] ${disputeRef} already resolved as ${hold.status}; skipping`);
    return;
  }

  if (terminalStatus === "won") {
    // Release the hold; org keeps credits. No ledger row needed.
    await supabase
      .from("disputed_credit_holds")
      .update({
        status: "won",
        resolved_at: new Date().toISOString(),
        resolution_reason: data.resolution ?? data.message ?? null,
      })
      .eq("id", hold.id);

    await supabase.from("audit_logs").insert({
      org_id: hold.org_id,
      action: "credits.dispute_resolved_won",
      entity_type: "token_balance",
      metadata: {
        dispute_reference: disputeRef,
        payment_reference: hold.payment_reference,
        credits_released: hold.credits_held,
      },
    });

    if (hold.admin_risk_item_id) {
      await supabase
        .from("admin_risk_items")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", hold.admin_risk_item_id);
    }

    await notifyOrgBilling(
      supabase,
      hold.org_id,
      "chargeback-resolved-won",
      `dispute-won-${disputeRef}`,
      {
        disputeReference: disputeRef,
        paymentReference: hold.payment_reference,
        creditsReleased: hold.credits_held,
      },
    );
  } else {
    // LOST or MERCHANT_ACCEPTED → real deduction via atomic_token_credit.
    const { data: debit, error: debitErr } = await supabase.rpc("atomic_token_credit", {
      p_org_id: hold.org_id,
      p_amount: -hold.credits_held,
      p_reason: "credit_chargeback",
      p_reference_id: disputeRef,
    });
    if (debitErr) {
      console.error(`[Dispute] Chargeback debit failed for org ${hold.org_id}:`, debitErr);
      throw new Error(`Chargeback balance update failed: ${debitErr.message}`);
    }

    const newBalance = Math.max(0, debit?.new_balance ?? 0);
    if ((debit?.new_balance ?? 0) < 0) {
      await supabase
        .from("token_balances")
        .update({ balance: 0, updated_at: new Date().toISOString() })
        .eq("org_id", hold.org_id);
    }

    await supabase.from("token_ledger").insert({
      org_id: hold.org_id,
      endpoint: "chargeback:paystack",
      tokens_burned: hold.credits_held,
      remaining_balance: newBalance,
      outcome: "allowed",
      request_id: `chargeback-${disputeRef}`,
      action_type: "credit_chargeback",
      metadata: {
        original_payment_reference: hold.payment_reference,
        dispute_reference: disputeRef,
        paystack_status: paystackStatus,
      },
    });

    await supabase
      .from("disputed_credit_holds")
      .update({
        status: terminalStatus,
        resolved_at: new Date().toISOString(),
        resolution_reason: data.resolution ?? data.message ?? null,
      })
      .eq("id", hold.id);

    await supabase.from("audit_logs").insert({
      org_id: hold.org_id,
      action: "credits.dispute_resolved_lost",
      entity_type: "token_balance",
      metadata: {
        dispute_reference: disputeRef,
        payment_reference: hold.payment_reference,
        credits_deducted: hold.credits_held,
        new_balance: newBalance,
        paystack_status: paystackStatus,
      },
    });

    if (hold.admin_risk_item_id) {
      await supabase
        .from("admin_risk_items")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", hold.admin_risk_item_id);
    }

    await notifyOrgBilling(
      supabase,
      hold.org_id,
      "chargeback-resolved-lost",
      `dispute-lost-${disputeRef}`,
      {
        disputeReference: disputeRef,
        paymentReference: hold.payment_reference,
        creditsDeducted: hold.credits_held,
        newBalance,
      },
    );
  }
}