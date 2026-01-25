import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Token packages from Price List
const TOKEN_PACKAGES: Record<string, { tokens: number; price_ngn: number; price_usd: number; label: string }> = {
  starter: { tokens: 10000, price_ngn: 400000, price_usd: 500, label: "Starter" },
  growth: { tokens: 50000, price_ngn: 1800000, price_usd: 2250, label: "Growth" },
  scale: { tokens: 100000, price_ngn: 3200000, price_usd: 4000, label: "Scale" },
  enterprise: { tokens: 500000, price_ngn: 14000000, price_usd: 17500, label: "Enterprise" },
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const isWebhook = url.pathname.endsWith("/webhook");

  try {
    if (isWebhook) {
      return await handleWebhook(req);
    }

    // Regular checkout flow - requires authentication
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
    const { packageId } = body;

    const pkg = TOKEN_PACKAGES[packageId];
    if (!pkg) {
      return new Response(
        JSON.stringify({ error: "Invalid package" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Paystack transaction
    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: profile.email || userData.user.email,
        amount: pkg.price_ngn * 100, // Paystack uses kobo (1 NGN = 100 kobo)
        currency: "NGN",
        callback_url: `${req.headers.get("origin")}/billing?status=success`,
        metadata: {
          org_id: profile.org_id,
          user_id: userData.user.id,
          package_id: packageId,
          tokens: pkg.tokens,
          price_usd: pkg.price_usd,
          custom_fields: [
            { display_name: "Package", variable_name: "package", value: pkg.label },
            { display_name: "Tokens", variable_name: "tokens", value: pkg.tokens.toString() },
          ],
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackData.status) {
      console.error("Paystack error:", paystackData);
      return new Response(
        JSON.stringify({ error: "Payment initialisation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the pending transaction
    await supabase.from("audit_logs").insert({
      org_id: profile.org_id,
      actor_user_id: userData.user.id,
      action: "token_purchase.initiated",
      entity_type: "token_purchase",
      metadata: {
        package_id: packageId,
        tokens: pkg.tokens,
        amount_ngn: pkg.price_ngn,
        reference: paystackData.data.reference,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
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

async function handleWebhook(req: Request): Promise<Response> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
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
    console.log("Paystack webhook event:", event.event);

    if (event.event === "charge.success") {
      const { metadata, reference, amount } = event.data;
      const orgId = metadata?.org_id;
      const tokens = metadata?.tokens;
      const userId = metadata?.user_id;
      const packageId = metadata?.package_id;

      if (!orgId || !tokens) {
        console.error("Missing metadata in webhook:", metadata);
        return new Response("Missing metadata", { status: 400 });
      }

      // Check if already processed (idempotency)
      const { data: existing } = await supabase
        .from("token_ledger")
        .select("id")
        .eq("request_id", reference)
        .single();

      if (existing) {
        console.log("Already processed:", reference);
        return new Response("Already processed", { status: 200 });
      }

      // Credit tokens to org
      const { data: balance, error: balanceError } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", orgId)
        .single();

      if (balanceError) {
        console.error("Failed to fetch balance:", balanceError);
        return new Response("Balance fetch failed", { status: 500 });
      }

      const newBalance = (balance?.balance || 0) + tokens;

      await supabase
        .from("token_balances")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("org_id", orgId);

      // Record in ledger
      await supabase.from("token_ledger").insert({
        org_id: orgId,
        endpoint: "token-purchase",
        tokens_burned: -tokens, // Negative = credit
        remaining_balance: newBalance,
        outcome: "purchased",
        action_type: "token_purchase",
        request_id: reference,
        metadata: {
          package_id: packageId,
          amount_kobo: amount,
          payment_reference: reference,
        },
      });

      // Audit log
      await supabase.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: userId,
        action: "token_purchase.completed",
        entity_type: "token_purchase",
        metadata: {
          package_id: packageId,
          tokens_credited: tokens,
          amount_kobo: amount,
          reference,
          new_balance: newBalance,
        },
      });

      console.log(`Credited ${tokens} tokens to org ${orgId}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Webhook error", { status: 500 });
  }
}
