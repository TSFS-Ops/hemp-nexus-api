// D-08 regression-test trigger. Invokes account-deletion-sweeper using the
// project's service-role key (available only inside edge functions) so the
// destructive staging test can run without leaking INTERNAL_CRON_KEY to the
// outside world. Restricted to the deny-list of test emails by callers via
// max_rows=1 + the sweeper's own platform_admin/POI/dispute guards.
//
// Auth: requires the platform anon key in Authorization (default verify_jwt
// off via supabase/config.toml fallback). Body is forwarded verbatim to the
// sweeper.
import { webhookCorsHeaders } from "../_shared/cors.ts";

const corsHeaders = { ...webhookCorsHeaders() };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text();
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/account-deletion-sweeper`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: body || "{}",
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
