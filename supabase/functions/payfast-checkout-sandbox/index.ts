// supabase/functions/payfast-checkout-sandbox/index.ts
//
// PayFast sandbox checkout initiation — Phase 2C.
//
// This route is sandbox-only and admin-only. It is the ONLY surface
// in the build that can create a PayFast `token_purchases` row and
// return a signed PayFast form payload. No customer-facing button
// links to it. The Paystack flow (`token-purchase`) is untouched.
//
// Gating (all four must pass):
//   • PAYFAST_SANDBOX_CHECKOUT_ENABLED env flag == "true"
//   • caller has the platform_admin role
//   • request body provider == "payfast"
//   • request body mode     == "sandbox"
//
// If any gate fails, the function returns a structured rejection and
// does NOT insert a `token_purchases` row.
//
// `verify_jwt = false` is the platform default; this function performs
// its own JWT + role check via the service-role client.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildPayfastSandboxCheckout } from "../_shared/payments/payfast-checkout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function envBool(name: string): boolean {
  return (Deno.env.get(name) ?? "").toLowerCase() === "true";
}

function projectFunctionsBase(): string {
  // e.g. https://<ref>.supabase.co  →  https://<ref>.supabase.co/functions/v1
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Parse body defensively.
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Resolve caller identity. We require an Authorization header so we
  // can call `auth.getUser` even though `verify_jwt=false`.
  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: accessToken ? `Bearer ${accessToken}` : "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthenticated" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve role + org context via service client.
  const userId = userData.user.id;
  const { data: roleRow } = await service.rpc("has_role", {
    _user_id: userId,
    _role: "platform_admin",
  });
  const isPlatformAdmin = roleRow === true;

  const { data: profile } = await service
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle();
  const orgId = (profile?.org_id as string | undefined) ?? null;

  // Secret-name reconciliation (Phase 2F unblocker):
  // Stored secrets use the `*_SANDBOX` suffix and unsuffixed URL names.
  // Read those first; keep the legacy `PAYFAST_SANDBOX_*` names as a
  // fallback so either naming style works without re-storing values.
  const firstNonEmpty = (...names: string[]): string => {
    for (const n of names) {
      const v = (Deno.env.get(n) ?? "").trim();
      if (v) return v;
    }
    return "";
  };
  const merchantId = firstNonEmpty("PAYFAST_MERCHANT_ID_SANDBOX", "PAYFAST_SANDBOX_MERCHANT_ID");
  const merchantKey = firstNonEmpty("PAYFAST_MERCHANT_KEY_SANDBOX", "PAYFAST_SANDBOX_MERCHANT_KEY");
  const passphraseRaw =
    Deno.env.get("PAYFAST_PASSPHRASE_SANDBOX") ??
    Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") ??
    null;
  const passphrase = passphraseRaw && passphraseRaw.trim() ? passphraseRaw : null;

  const origin = req.headers.get("origin") ?? "";
  const defaultReturnUrl =
    firstNonEmpty("PAYFAST_RETURN_URL", "PAYFAST_SANDBOX_RETURN_URL") ||
    (origin ? `${origin}/desk/billing?payfast=return` : "https://example.invalid/return");
  const defaultCancelUrl =
    firstNonEmpty("PAYFAST_CANCEL_URL", "PAYFAST_SANDBOX_CANCEL_URL") ||
    (origin ? `${origin}/desk/billing?payfast=cancel` : "https://example.invalid/cancel");
  const notifyUrl =
    firstNonEmpty("PAYFAST_NOTIFY_URL", "PAYFAST_SANDBOX_NOTIFY_URL") ||
    `${projectFunctionsBase()}/payfast-itn`;
  // Optional override for the PayFast SANDBOX process URL.
  const processUrlSandbox =
    firstNonEmpty("PAYFAST_PROCESS_URL_SANDBOX", "PAYFAST_SANDBOX_PROCESS_URL") || undefined;

  const outcome = await buildPayfastSandboxCheckout(
    {
      provider: String((body as { provider?: unknown }).provider ?? ""),
      mode: String((body as { mode?: unknown }).mode ?? ""),
      packageId: String((body as { packageId?: unknown }).packageId ?? ""),
      callbackUrl: typeof body.callbackUrl === "string" ? (body.callbackUrl as string) : null,
      cancelUrl: typeof body.cancelUrl === "string" ? (body.cancelUrl as string) : null,
    },
    {
      supabase: service,
      userId,
      orgId,
      isPlatformAdmin,
      gateEnabled: envBool("PAYFAST_SANDBOX_CHECKOUT_ENABLED"),
      merchantId,
      merchantKey,
      passphrase,
      notifyUrl,
      defaultReturnUrl,
      defaultCancelUrl,
      processUrl: processUrlSandbox,
    },
  );

  return new Response(JSON.stringify(outcome), {
    status: outcome.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
