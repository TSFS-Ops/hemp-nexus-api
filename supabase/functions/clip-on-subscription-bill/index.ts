// clip-on-subscription-bill
// Daily cron — bills the monthly clip-on subscription fee for every
// organisation that has `clip_on_always_on = true`. Idempotent via
// the unique (org_id, period_month) constraint on
// `clip_on_subscription_charges`. Auth: INTERNAL_CRON_KEY header or
// service-role JWT — same pattern as lifecycle-scheduler.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
    const providedKey = req.headers.get("x-internal-key");
    const authHeader = req.headers.get("authorization") || "";
    const isServiceRole = authHeader.includes(
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "NEVER_MATCH",
    );

    if (internalKey && providedKey !== internalKey && !isServiceRole) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin.rpc("bill_clip_on_subscriptions_monthly");

    if (error) {
      console.error("[clip-on-subscription-bill] RPC failed", error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, result: data }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[clip-on-subscription-bill] unhandled", e);
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
