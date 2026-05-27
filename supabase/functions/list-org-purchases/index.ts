// DEC-007 — Read-only listing of the caller's org token purchases plus
// any open (pending) refund requests. Used by the Desk Billing page to
// render the "Request refund" affordance per eligible purchase row.
//
// Read-only. Triggers no provider action. RLS-safe (service-role used
// only after resolving caller -> org_id via profile).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error: uerr } = await userClient.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", u.user.id)
    .maybeSingle();
  const orgId = profile?.org_id;
  if (!orgId) return json({ error: "no_org", code: "NO_ORG" }, 400);

  const { data: purchases, error: pErr } = await admin
    .from("token_purchases")
    .select(
      "id, package_id, token_amount, amount_usd, status, created_at, paystack_reference",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (pErr) {
    console.error("[list-org-purchases] purchases", pErr);
    return json({ error: "query_failed" }, 500);
  }

  const { data: refundRows, error: rErr } = await admin
    .from("refund_requests")
    .select("token_purchase_id, status, created_at")
    .eq("org_id", orgId)
    .in("status", ["pending", "blocked_credits_used", "blocked_expired"])
    .order("created_at", { ascending: false });
  if (rErr) {
    console.error("[list-org-purchases] refunds", rErr);
    return json({ error: "query_failed" }, 500);
  }
  const pendingRefunds = (refundRows ?? []).filter((r) => r.status === "pending");
  // Latest blocked outcome per purchase — UI uses this to suppress the
  // Request refund button and explain why.
  const blockedByPurchase: Record<string, { status: string; created_at: string }> = {};
  for (const row of refundRows ?? []) {
    if (row.status === "pending") continue;
    if (!blockedByPurchase[row.token_purchase_id]) {
      blockedByPurchase[row.token_purchase_id] = {
        status: row.status,
        created_at: row.created_at,
      };
    }
  }
  const blockedRefunds = Object.entries(blockedByPurchase).map(([id, v]) => ({
    token_purchase_id: id,
    status: v.status,
    created_at: v.created_at,
  }));

  return json({
    success: true,
    purchases: purchases ?? [],
    pending_refunds: pendingRefunds,
    blocked_refunds: blockedRefunds,
  });
});
