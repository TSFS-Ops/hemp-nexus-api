// supabase/functions/payfast-checkout-live/index.ts
//
// PayFast LIVE checkout initiation — Phase 2G smoke test.
//
// This route is LIVE-only and admin-only. It exists ONLY for a tightly
// controlled admin-driven smoke test against PayFast production. It is
// NOT customer-facing. There is no link or button anywhere in the
// build that exposes PayFast live checkout to a normal user.
//
// Gating (ALL must pass):
//   • PAYFAST_LIVE_SMOKE_ENABLED env flag == "true"
//   • PAYFAST_MODE env == "live"
//   • caller has the platform_admin role
//   • request body provider == "payfast"
//   • request body mode     == "live"
//
// A GET request returns an availability probe (admin-only) that the
// admin button uses to decide whether to render itself. The probe
// performs NO side effects, returns NO secrets, and only reports
// boolean flags + the resolved global mode.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildPayfastLiveCheckout } from "../_shared/payments/payfast-live-checkout.ts";
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

  // Auth: required for both probe and checkout.
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
  const { data: roleRow } = await service.rpc("has_role", {
    _user_id: userId,
    _role: "platform_admin",
  });
  const isPlatformAdmin = roleRow === true;
  if (!isPlatformAdmin) {
    return new Response(
      JSON.stringify({ ok: false, error: "forbidden", reason: "not_admin" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const globalMode = resolveGlobalMode();
  const smokeEnabled = envBool("PAYFAST_LIVE_SMOKE_ENABLED");

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
    const available = smokeEnabled && globalMode === "live" && merchantConfigured && urlsConfigured;
    return new Response(
      JSON.stringify({
        ok: true,
        available,
        smokeEnabled,
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

  // Resolve org context for the caller.
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
  // Optional override for the PayFast LIVE process URL.
  const processUrlLive =
    firstNonEmpty("PAYFAST_PROCESS_URL_LIVE", "PAYFAST_PROCESS_URL") || undefined;

  const outcome = await buildPayfastLiveCheckout(
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
      isPlatformAdmin,
      smokeEnabled,
      globalMode,
      merchantIdLive,
      merchantKeyLive,
      passphraseLive,
      notifyUrlLive,
      defaultReturnUrlLive,
      defaultCancelUrlLive,
      processUrl: processUrlLive,
    },
  );

  return new Response(JSON.stringify(outcome), {
    status: outcome.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
