/**
 * confirm-test-user - Test-only edge function that confirms a user's email.
 * 
 * SECURITY: Only confirms emails matching the test pattern (*@test.izenzo.co.za).
 * Uses service_role to call auth.admin.updateUserById.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

function isStagingTier(): boolean {
  const tier = (Deno.env.get("ENVIRONMENT_TIER") ?? "").toLowerCase().trim();
  return tier === "staging" || tier === "dev" || tier === "development" || tier === "test";
}

async function isPlatformAdminJwt(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return false;
  const token = authHeader.slice(7);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) return false;
    const { data: hasRole } = await admin.rpc("has_role", {
      _user_id: user.id,
      _role: "platform_admin",
    });
    return hasRole === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Fail-closed auth: staging tier OR INTERNAL_CRON_KEY OR platform_admin JWT
    const internalKey = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
    const providedKey = req.headers.get("x-internal-key") ?? "";
    const hasInternalKey = internalKey.length > 0 && providedKey === internalKey;
    const stagingOk = isStagingTier();
    const adminOk = !stagingOk && !hasInternalKey ? await isPlatformAdminJwt(req) : false;
    if (!stagingOk && !hasInternalKey && !adminOk) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Verify user has a test email
    const { data: user, error: getUserErr } = await admin.auth.admin.getUserById(user_id);
    if (getUserErr || !user?.user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!user.user.email?.endsWith("@test.izenzo.co.za")) {
      return new Response(JSON.stringify({ error: "Only test accounts can be confirmed via this endpoint" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: confirmErr } = await admin.auth.admin.updateUserById(user_id, {
      email_confirm: true,
    });

    if (confirmErr) {
      return new Response(JSON.stringify({ error: confirmErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ confirmed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
