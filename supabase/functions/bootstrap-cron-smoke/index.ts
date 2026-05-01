// One-shot smoke-test proxy: invokes engagement-reminder using the server-side INTERNAL_CRON_KEY.
// Returns only the upstream status + small response excerpt.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("INTERNAL_CRON_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "INTERNAL_CRON_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const target = "https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/engagement-reminder";
  const r = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": key,
    },
    body: "{}",
  });
  const text = await r.text();
  return new Response(JSON.stringify({
    upstream_status: r.status,
    upstream_excerpt: text.slice(0, 800),
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
