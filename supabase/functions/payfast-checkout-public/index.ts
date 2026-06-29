// supabase/functions/payfast-checkout-public/index.ts
//
// PayFast LIVE customer-facing checkout — Phase 2J.
//
// This route is LIVE-only and customer-facing (any authenticated user
// with an org). It is gated by PAYFAST_PUBLIC_ENABLED so PayFast can
// be turned off instantly without code changes.
//
// Gating (ALL must pass):
//   • PAYFAST_PUBLIC_ENABLED env flag == "true"
//   • PAYFAST_MODE env == "live"
//   • request body provider == "payfast"
//   • request body mode     == "live"
//   • request body packageId is one of the customer packs
//
// A GET request returns an availability probe (returns only boolean
// flags + the resolved global mode — no secrets, no side effects).
// The UI uses this to decide whether to render the PayFast option.
//
// This function NEVER reads PayFast sandbox secrets and NEVER imports
// the legacy `_shared/fx.ts`.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildPayfastPublicCheckout } from "../_shared/payments/payfast-public-checkout.ts";
import type { PayfastMode } from "../_shared/payments/payfast.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function envBool(name: string): boolean {
  return (Deno.env.get(name) ?? "").toLowerCase() === "true";
}

function resolveGlobalMode(): PayfastMode {
  const raw = (Deno.env.get("PAYFAST_MODE") ?? "sandbox").toLowerCase();
  return raw === "live" ? "live" : "sandbox";
}

function projectFunctionsBase(): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1`;
}

function firstNonEmpty(...names: string[]): string {
  for (const n of names) {
    const v = (Deno.env.get(n) ?? "").trim();
    if (v) return v;
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth required for both probe and checkout — this is a customer
  // surface but anonymous users have no org.
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
  const userId = userData.user.id;

  const globalMode = resolveGlobalMode();
  const publicEnabled = envBool("PAYFAST_PUBLIC_ENABLED");

  // GET = availability probe. No secrets, no side effects.
  if (req.method === "GET") {
    const merchantConfigured =
      !!firstNonEmpty("PAYFAST_MERCHANT_ID_LIVE") &&
      !!firstNonEmpty("PAYFAST_MERCHANT_KEY_LIVE") &&
      !!firstNonEmpty("PAYFAST_PASSPHRASE_LIVE");
    const urlsConfigured =
      !!firstNonEmpty("PAYFAST_NOTIFY_URL_LIVE") &&
      !!firstNonEmpty("PAYFAST_RETURN_URL_LIVE") &&
      !!firstNonEmpty("PAYFAST_CANCEL_URL_LIVE");
    const available =
      publicEnabled && globalMode === "live" && merchantConfigured && urlsConfigured;
    return new Response(
      JSON.stringify({
        ok: true,
        available,
        publicEnabled,
        globalMode,
        merchantConfigured,
        urlsConfigured,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: profile } = await service
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle();
  const orgId = (profile?.org_id as string | undefined) ?? null;

  // LIVE secrets only. No sandbox fallback — by design.
  const merchantIdLive = firstNonEmpty("PAYFAST_MERCHANT_ID_LIVE");
  const merchantKeyLive = firstNonEmpty("PAYFAST_MERCHANT_KEY_LIVE");
  const passphraseLive = firstNonEmpty("PAYFAST_PASSPHRASE_LIVE") || null;

  const notifyUrlLive =
    firstNonEmpty("PAYFAST_NOTIFY_URL_LIVE") || `${projectFunctionsBase()}/payfast-itn`;
  const defaultReturnUrlLive = firstNonEmpty("PAYFAST_RETURN_URL_LIVE");
  const defaultCancelUrlLive = firstNonEmpty("PAYFAST_CANCEL_URL_LIVE");

  const outcome = await buildPayfastPublicCheckout(
    {
      provider: String((body as { provider?: unknown }).provider ?? ""),
      mode: String((body as { mode?: unknown }).mode ?? ""),
      packageId: typeof body.packageId === "string" ? (body.packageId as string) : undefined,
      callbackUrl: typeof body.callbackUrl === "string" ? (body.callbackUrl as string) : null,
      cancelUrl: typeof body.cancelUrl === "string" ? (body.cancelUrl as string) : null,
    },
    {
      supabase: service,
      userId,
      orgId,
      publicEnabled,
      globalMode,
      merchantIdLive,
      merchantKeyLive,
      passphraseLive,
      notifyUrlLive,
      defaultReturnUrlLive,
      defaultCancelUrlLive,
    },
  );

  return new Response(JSON.stringify(outcome), {
    status: outcome.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
