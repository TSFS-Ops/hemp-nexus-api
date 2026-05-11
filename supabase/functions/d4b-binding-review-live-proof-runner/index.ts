/**
 * Trampoline: invokes d4b-binding-review-live-proof using the
 * server-side INTERNAL_CRON_KEY env var so operators (and CI) can
 * fire the harness without holding the raw secret. Returns the
 * harness JSON verbatim.
 *
 * Out of scope: D4c, Batch C, ratings, MT-009, legacy disputes,
 * payments, compliance, public status, UI/routes/RLS, external
 * notifications.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const upstream = await fetch(
    `${SUPABASE_URL}/functions/v1/d4b-binding-review-live-proof`,
    {
      method: "POST",
      headers: {
        "x-internal-key": INTERNAL_CRON_KEY,
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm: "RUN_D4B_BINDING_REVIEW_LIVE_PROOF" }),
    },
  );

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: cors,
  });
});
