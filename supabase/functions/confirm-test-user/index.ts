/**
 * confirm-test-user - Test-only edge function that confirms a user's email.
 * 
 * SECURITY: Only confirms emails matching the test pattern (*@test.izenzo.co.za).
 * Uses service_role to call auth.admin.updateUserById.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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
