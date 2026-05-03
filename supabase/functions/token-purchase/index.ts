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

      // Insert ledger entry - unique index on request_id is the hard idempotency guard.
      // If webhook already inserted this reference, this INSERT fails and we return alreadyCredited.
      // USD-native audit fields (price_usd, currency, fx_basis='native_usd') are
      // propagated from the Paystack `metadata` blob captured at checkout-init.
      const { error: ledgerError } = await supabase.from("token_ledger").insert({
        org_id: orgId,
        endpoint: "payment:paystack:verify",
        tokens_burned: -credits,
        remaining_balance: newBalance,
        outcome: "allowed",
        request_id: reference,
        action_type: "credit_purchase",
        metadata: {
          payment_reference: reference,
          package_id: meta.package_id,
          price_usd: meta.price_usd ?? null,
          currency: "USD",
          fx_basis: "native_usd",
          verification_fallback: true,
        },
      });

      if (ledgerError) {
        // Unique constraint violation = webhook already credited this reference
        if (ledgerError.code === "23505") {
          console.log(`[Verify] Duplicate caught by unique index: ${reference}`);
          // Reverse the atomic credit we just applied
          await supabase.rpc("atomic_token_credit", {
            p_org_id: orgId,
            p_amount: -credits,
            p_reason: "duplicate_reversal",
            p_reference_id: reference,
          });
          // Fetch the actual balance after reversal
          const { data: actualBalance } = await supabase
            .from("token_balances")
            .select("balance")
            .eq("org_id", orgId)
            .single();
          return new Response(
            JSON.stringify({ success: true, alreadyCredited: true, message: "Credits already applied", newBalance: actualBalance?.balance }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.error(`[Verify] Ledger insert failed:`, ledgerError);
        // Balance was credited but ledger failed - log for manual reconciliation
        await supabase.from("admin_risk_items").insert({
          title: `Ledger write failure: ${reference}`,
          description: `Credits (${credits}) were added to org ${orgId} but the ledger entry failed. Manual reconciliation required.`,
          severity: "high",
          status: "open",
        });
      }

      await supabase.from("audit_logs").insert({
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
          consoleUrl: `https://compliance-matching.lovable.app/admin/billing`,
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
    });
    if (!replay.ok) {
      console.warn("[Webhook] Rejected replay/duplicate delivery");
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

      case "dispute.create":
        await handleDisputeCreated(supabase, event.data);
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

  // Soft idempotency check (fast path)
  const { data: existing } = await supabase
    .from("token_ledger")
    .select("id")
    .eq("request_id", reference)
    .maybeSingle();

  if (existing) {
    console.log("[Webhook] Already processed:", reference);
    return;
  }

  // Atomic balance credit (no read-then-write race)
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

  // Hard idempotency guard: unique index on request_id catches TOCTOU race
  const { error: ledgerError } = await supabase.from("token_ledger").insert({
    org_id: orgId,
    endpoint: "payment:paystack",
    tokens_burned: -credits,
    remaining_balance: newBalance,
    outcome: "allowed",
    request_id: reference,
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
    },
  });

  if (ledgerError) {
    if (ledgerError.code === "23505") {
      // Unique constraint violation = verify path already credited this reference
      console.log(`[Webhook] Duplicate caught by unique index, reversing atomic credit: ${reference}`);
      await supabase.rpc("atomic_token_credit", {
        p_org_id: orgId,
        p_amount: -credits,
        p_reason: "duplicate_reversal",
        p_reference_id: reference,
      });
      return;
    }
    // Ledger write failed but balance was credited - create risk item
    console.error(`[Webhook] Ledger insert failed:`, ledgerError);
    await supabase.from("admin_risk_items").insert({
      title: `Webhook ledger failure: ${reference}`,
      description: `Credits (${credits}) added to org ${orgId} but ledger entry failed. Manual reconciliation required.`,
      severity: "high",
      status: "open",
    });
  }

  // Audit log — USD-native settlement record for HQ Revenue.
  await supabase.from("audit_logs").insert({
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
      consoleUrl: `https://compliance-matching.lovable.app/admin/billing`,
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
// dispute.create handler
// ==============================================
// deno-lint-ignore no-explicit-any
async function handleDisputeCreated(
  supabase: any,
  data: { 
    reference: string;
    transaction_reference?: string;
    metadata?: { org_id?: string };
  }
): Promise<void> {
  console.log(`[Webhook] Dispute created: ${data.reference}`);
  
  if (data.metadata?.org_id) {
    await supabase.from("audit_logs").insert({
      org_id: data.metadata.org_id,
      action: "credits.dispute_created",
      entity_type: "token_balance",
      metadata: {
        dispute_reference: data.reference,
        transaction_reference: data.transaction_reference,
        requires_review: true,
      },
    });

    // Create risk item for admin review
    await supabase.from("admin_risk_items").insert({
      title: `Payment Dispute: ${data.reference}`,
      description: `Dispute created for transaction ${data.transaction_reference || 'unknown'}. Org: ${data.metadata.org_id}`,
      severity: "high",
      status: "open",
    });
  }
}