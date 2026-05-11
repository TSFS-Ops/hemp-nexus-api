// Temporary invoker for D4c-3a live proof. Uses INTERNAL_CRON_KEY from env
// to call the live-proof harness and returns its JSON verbatim.
// Safe to delete after closeout.
Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const res = await fetch(`${url}/functions/v1/d4c-cancelled-email-change-live-proof`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": key,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify({ confirm: "RUN_D4C_CANCELLED_EMAIL_CHANGE_LIVE_PROOF" }),
  });
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: safeParse(text) }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
function safeParse(t: string) { try { return JSON.parse(t); } catch { return t; } }
