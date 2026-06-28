// supabase/functions/payfast-itn/index.ts
//
// PayFast ITN receiver — Phase 2B (sandbox foundation).
//
// This file is the THIN Deno entry point. All decision logic lives in
// `supabase/functions/_shared/payments/payfast.ts` (`processPayfastItn`),
// which is fully unit-tested under Vitest. This wrapper only:
//   • parses the request,
//   • assembles the real Supabase service-role client,
//   • assembles the IP allowlist (sandbox passthrough until Phase 2C
//     ships a resolved set),
//   • injects the real `defaultPayfastValidatePostback`,
//   • returns HTTP 200 to PayFast unconditionally (the body carries
//     the decision) so PayFast does not retry-storm. The orchestrator
//     itself never throws.
//
// LIVE STATUS: This route is sandbox-only. There is NO customer-facing
// PayFast checkout button in this build. The route exists so PayFast
// sandbox ITNs can be exercised end-to-end during Phase 2B sign-off.
// `verify_jwt = false` is the platform default; no override is set.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  defaultPayfastValidatePostback,
  processPayfastItn,
  type PayfastMode,
} from "../_shared/payments/payfast.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Mode is sandbox-only in Phase 2B. Toggling to "live" is intentionally
// gated on a future Phase that wires checkout initiation, secrets and
// real source-IP enforcement. We default to "sandbox" hard.
function resolveMode(): PayfastMode {
  const raw = (Deno.env.get("PAYFAST_MODE") ?? "sandbox").toLowerCase();
  return raw === "live" ? "live" : "sandbox";
}

// Read the merchant passphrase. Supports both the sandbox-specific name
// (set by the Phase 2F unblocker) and the legacy generic name.
function resolvePassphrase(mode: PayfastMode): string | null {
  const candidates =
    mode === "sandbox"
      ? ["PAYFAST_PASSPHRASE_SANDBOX", "PAYFAST_PASSPHRASE"]
      : ["PAYFAST_PASSPHRASE", "PAYFAST_PASSPHRASE_LIVE"];
  for (const name of candidates) {
    const v = Deno.env.get(name);
    if (v && v.length > 0) return v;
  }
  return null;
}

function resolveAllowedIps(): string[] {
  const raw = Deno.env.get("PAYFAST_ALLOWED_IPS") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Sandbox bypass: honoured only when mode === "sandbox". Either the
// explicit env flag is set, OR no allowlist has been configured yet
// (Phase 2F sandbox foundation — production hardening adds the
// resolved IP set in a later phase). Live mode NEVER bypasses.
function resolveSandboxBypass(mode: PayfastMode, allowedIps: string[]): boolean {
  if (mode !== "sandbox") return false;
  if ((Deno.env.get("PAYFAST_SANDBOX_SKIP_IP_CHECK") ?? "").toLowerCase() === "true") return true;
  return allowedIps.length === 0;
}


function clientIp(req: Request): string | null {
  // Supabase edge gateway forwards origin IP via x-forwarded-for.
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // We always read the body up-front. PayFast ITNs are
  // application/x-www-form-urlencoded.
  const rawBody = req.method === "POST" ? await req.text() : "";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const mode = resolveMode();
  const allowedIps = resolveAllowedIps();
  const outcome = await processPayfastItn(
    { method: req.method, rawBody },
    {
      supabase,
      mode,
      passphrase: resolvePassphrase(mode),
      allowedIps,
      remoteIp: clientIp(req),
      sandboxBypassIp: resolveSandboxBypass(mode, allowedIps),
      validatePostback: defaultPayfastValidatePostback,
    },
  );


  // Always 200 to PayFast (except hard method-not-allowed). The body
  // is for our own observability — PayFast itself only inspects the
  // status code.
  const status = outcome.status === 405 ? 405 : 200;
  return new Response(
    JSON.stringify({
      ok: outcome.decision === "credited" || outcome.decision === "already_credited",
      decision: outcome.decision,
      reason: outcome.reason ?? null,
      provider: "payfast",
      mode,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
