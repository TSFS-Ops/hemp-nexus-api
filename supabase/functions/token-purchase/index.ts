import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Zod schemas
const purchaseSchema = z.object({
  packageId: z.enum(["starter", "professional", "enterprise"]),
  callbackUrl: z.string().url().optional(),
});

const verifySchema = z.object({
  reference: z.string().min(1, "Missing reference"),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ==============================================
// CHARGING ENTITY (for invoices)
// ==============================================
const CHARGING_ENTITY = {
  name: "Starfair162 (Pty) Ltd t/a Izenzo",
  registration: "2018 / 331720 / 07",
  address: "44 Campbell Street, Port Alfred, South Africa",
  vatStatus: "Not VAT-registered",
  supportEmail: "support@izenzo.co.za",
  invoiceNote: "No VAT charged — supplier not VAT registered in South Africa.",
};

// ==============================================
// TOKEN PACKAGES (ZAR pricing)
// R1,799 = 20 credits, R6,299 = 100 credits, R26,999 = 500 credits
// ==============================================
const TOKEN_PACKAGES: Record<string, { 
  credits: number; 
  price_zar: number; 
  price_cents: number; 
  label: string;
  pricePerCredit: string;
}> = {
  starter: { 
    credits: 20, 
    price_zar: 1799, 
    price_cents: 179900, 
    label: "Starter",
    pricePerCredit: "89.95",
  },
  professional: { 
    credits: 100, 
    price_zar: 6299, 
    price_cents: 629900, 
    label: "Professional",
    pricePerCredit: "62.99",
  },
  enterprise: { 
    credits: 500, 
    price_zar: 26999, 
    price_cents: 2699900, 
    label: "Enterprise",
    pricePerCredit: "54.00",
  },
};

// ==============================================
// REFUND POLICY
// ==============================================
const REFUND_POLICY = {
  unusedCreditsRefundableDays: 7,
  consumedCreditsRefundable: false,
  poiWadLicencesRefundable: false,
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();
  const isWebhook = path === "webhook";

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

    if (isWebhook) {
      return await handleWebhook(req);
    }

    // GET /packages - public endpoint
    if (req.method === "GET" && path === "packages") {
      return handleGetPackages();
    }

    // GET /entity - public endpoint
    if (req.method === "GET" && path === "entity") {
      return new Response(
        JSON.stringify(CHARGING_ENTITY),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /verify - verify a Paystack transaction and credit if successful
    // This is the fallback for when webhooks fail/are missed
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

      // Check if already credited (idempotency)
      const { data: existing } = await supabase
        .from("token_ledger")
        .select("id")
        .eq("request_id", reference)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: true, alreadyCredited: true, message: "Credits already applied" }),
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

      // Credit the tokens (same logic as webhook handler)
      const credits = meta.credits;
      const orgId = meta.org_id;

      const { data: balanceRow } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", orgId)
        .single();

      const currentBalance = balanceRow?.balance || 0;
      const newBalance = currentBalance + credits;

      await supabase
        .from("token_balances")
        .upsert({ org_id: orgId, balance: newBalance, updated_at: new Date().toISOString() }, { onConflict: "org_id" });

      await supabase.from("token_ledger").insert({
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
          price_zar: meta.price_zar,
          verification_fallback: true,
        },
      });

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
          verification_fallback: true,
        },
      });

      console.log(`[Verify] Credited ${credits} credits to org ${orgId} via verification fallback`);

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

    const body = await req.json();
    const parsed = purchaseSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message || "Invalid request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { packageId, callbackUrl } = parsed.data;
    const pkg = TOKEN_PACKAGES[packageId]!;

    // Get client IP for audit
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";

    // Create Paystack transaction (ZAR currency)
    const callbackBase = callbackUrl?.replace(/\?.*$/, '') || `${req.headers.get("origin")}/billing`;
    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: profile.email || userData.user.email,
        amount: pkg.price_cents, // Paystack uses cents
        currency: "ZAR",
        callback_url: `${callbackBase}?status=success`,
        metadata: {
          org_id: profile.org_id,
          user_id: userData.user.id,
          package_id: packageId,
          credits: pkg.credits,
          price_zar: pkg.price_zar,
          client_ip: clientIp,
          timestamp: new Date().toISOString(),
          custom_fields: [
            { display_name: "Package", variable_name: "package", value: pkg.label },
            { display_name: "Credits", variable_name: "credits", value: pkg.credits.toString() },
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

    // Log the pending transaction
    await supabase.from("audit_logs").insert({
      org_id: profile.org_id,
      actor_user_id: userData.user.id,
      action: "credits.purchase_initiated",
      entity_type: "token_purchase",
      metadata: {
        package_id: packageId,
        credits: pkg.credits,
        amount_zar: pkg.price_zar,
        reference: paystackData.data.reference,
        client_ip: clientIp,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
        package: {
          name: pkg.label,
          credits: pkg.credits,
          priceZar: pkg.price_zar,
        },
        entity: CHARGING_ENTITY,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Token purchase error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ==============================================
// GET /packages - List available packages
// ==============================================
function handleGetPackages(): Response {
  const packages = Object.entries(TOKEN_PACKAGES).map(([id, pkg]) => ({
    id,
    name: pkg.label,
    credits: pkg.credits,
    priceZar: pkg.price_zar,
    pricePerCredit: pkg.pricePerCredit,
  }));

  return new Response(
    JSON.stringify({ 
      packages,
      currency: "ZAR",
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
    metadata?: {
      org_id?: string;
      user_id?: string;
      package_id?: string;
      credits?: number;
      price_zar?: number;
      client_ip?: string;
    };
    customer?: { email?: string };
    paid_at?: string;
  }
): Promise<void> {
  const { reference, metadata, customer, paid_at } = data;
  
  if (!metadata?.org_id || !metadata?.credits) {
    console.error("[Webhook] Missing metadata in charge.success:", reference);
    return;
  }

  const orgId = metadata.org_id;
  const credits = metadata.credits;
  const userId = metadata.user_id;

  console.log(`[Webhook] Processing charge.success: org=${orgId}, credits=${credits}, ref=${reference}`);

  // Check if already processed (idempotency)
  const { data: existing } = await supabase
    .from("token_ledger")
    .select("id")
    .eq("request_id", reference)
    .maybeSingle();

  if (existing) {
    console.log("[Webhook] Already processed:", reference);
    return;
  }

  // Credit tokens to org (atomic upsert to prevent race conditions)
  const { data: balanceRow } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("org_id", orgId)
    .single();

  const currentBalance = balanceRow?.balance || 0;
  const newBalance = currentBalance + credits;

  // Use upsert with the computed balance; the idempotency check above
  // prevents double-credits from concurrent webhook + verify calls.
  const { error: balanceError } = await supabase
    .from("token_balances")
    .upsert({
      org_id: orgId,
      balance: newBalance,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" });

  if (balanceError) {
    console.error(`[Webhook] Balance upsert failed for org ${orgId}:`, balanceError);
    // Don't silently continue — throw to signal retry
    throw new Error(`Balance update failed: ${balanceError.message}`);
  }

  // Record in ledger (credit = negative burn)
  await supabase.from("token_ledger").insert({
    org_id: orgId,
    endpoint: "payment:paystack",
    tokens_burned: -credits, // Negative = credit
    remaining_balance: newBalance,
    outcome: "allowed",
    request_id: reference,
    action_type: "credit_purchase",
    metadata: {
      payment_reference: reference,
      package_id: metadata.package_id,
      price_zar: metadata.price_zar,
      customer_email: customer?.email,
      paid_at,
      client_ip: metadata.client_ip,
    },
  });

  // Audit log
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
      price_zar: metadata.price_zar,
      package_id: metadata.package_id,
    },
  });

  console.log(`[Webhook] Credited ${credits} credits to org ${orgId}`);
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

  // Get current balance
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("org_id", orgId)
    .single();

  const currentBalance = balance?.balance || 0;
  const newBalance = Math.max(0, currentBalance - creditsToDeduct);

  // Update balance
  await supabase
    .from("token_balances")
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq("org_id", orgId);

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

  console.log(`[Webhook] Deducted ${creditsToDeduct} credits for refund`);
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