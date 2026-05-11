// Temporary invoker for D4c-3c live-proof. Deleted immediately after.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  if (!KEY) return new Response(JSON.stringify({ error: "NO_INTERNAL_KEY" }), { status: 500 });
  const r = await fetch(
    `${SUPABASE_URL}/functions/v1/d4c-late-acceptance-reconfirmation-live-proof`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": KEY },
      body: JSON.stringify({ confirm: "RUN_D4C_LATE_ACCEPTANCE_LIVE_PROOF" }),
    },
  );
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
});
