/**
 * provision-test-user — Test-only edge function that creates an already-confirmed
 * user via the GoTrue admin API, bypassing email signup rate limits entirely.
 *
 * SECURITY:
 *   - Only accepts emails matching *@test.izenzo.co.za
 *   - Uses service_role to call auth.admin.createUser({ email_confirm: true })
 *   - Idempotent: if the user already exists, returns the existing id
 *   - Never sends a confirmation email (no GoTrue email quota consumed)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const TEST_EMAIL_SUFFIX = "@test.izenzo.co.za";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, password, user_metadata } = await req.json();

    if (!email || typeof email !== "string") {
      return json({ error: "email required" }, 400);
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return json({ error: "password required (min 8 chars)" }, 400);
    }
    if (!email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) {
      return json(
        { error: `Only ${TEST_EMAIL_SUFFIX} addresses can be provisioned` },
        403,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Idempotency: if a user with this email already exists, reuse it.
    // GoTrue admin API doesn't expose a direct lookup-by-email, so we page.
    let existingId: string | null = null;
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) break;
      const hit = data.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      if (hit) {
        existingId = hit.id;
        break;
      }
      if (data.users.length < 1000) break;
    }

    if (existingId) {
      // Make sure the password matches what the caller expects, and confirm.
      const { error: updErr } = await admin.auth.admin.updateUserById(
        existingId,
        { password, email_confirm: true },
      );
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ user_id: existingId, created: false });
    }

    const { data: created, error: createErr } = await admin.auth.admin
      .createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: user_metadata ?? {},
      });

    if (createErr || !created.user) {
      return json(
        { error: createErr?.message ?? "Failed to create user" },
        500,
      );
    }

    return json({ user_id: created.user.id, created: true });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
