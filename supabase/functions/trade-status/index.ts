import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Trade Status endpoint — returns only approval outcome, not sensitive KYC data.
 * Accessible by any authenticated user.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorised" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorised" }, 401);

    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id");

    if (!orgId) return json({ error: "org_id query parameter is required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin
      .from("trade_approvals")
      .select("status, approved_at, risk_band, valid_until")
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);

    return json({
      org_id: orgId,
      approved_to_trade: data?.status === "approved",
      trade_status: data?.status || "not_approved",
      approved_at: data?.approved_at || null,
      risk_band: data?.risk_band || null,
      valid_until: data?.valid_until || null,
    });
  } catch (err) {
    console.error("Trade status error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
