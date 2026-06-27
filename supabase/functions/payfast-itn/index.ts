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

// Read the merchant passphrase ONLY if provided. PayFast accounts that
// have not configured a passphrase sign without one; both branches are
// supported by `verifyPayfastSignature`.
function resolvePassphrase(): string | null {
  const v = Deno.env.get("PAYFAST_PASSPHRASE");
  return v && v.length > 0 ? v : null;
}

// Resolve PayFast source IPs. In Phase 2B we accept a comma-separated
// list from `PAYFAST_ALLOWED_IPS` for sandbox testing. Production
// hardening (DNS lookup of PayFast's published hostnames + caching)
// is a Phase 2C/2D requirement, documented in the report. We never
// implicitly trust the request IP without the allowlist being set.
function resolveAllowedIps(): string[] {
  const raw = Deno.env.get("PAYFAST_ALLOWED_IPS") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Sandbox bypass: explicit, named, and only honoured when both the mode
// is sandbox AND the env flag is set. Production deploys MUST NOT set
// this. The report documents the requirement.
function resolveSandboxBypass(mode: PayfastMode): boolean {
  if (mode !== "sandbox") return false;
  return (Deno.env.get("PAYFAST_SANDBOX_SKIP_IP_CHECK") ?? "").toLowerCase() === "true";
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
  const outcome = await processPayfastItn(
    { method: req.method, rawBody },
    {
      supabase,
      mode,
      passphrase: resolvePassphrase(),
      allowedIps: resolveAllowedIps(),
      remoteIp: clientIp(req),
      sandboxBypassIp: resolveSandboxBypass(mode),
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
