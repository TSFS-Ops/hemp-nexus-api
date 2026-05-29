/**
 * provision-test-user — Test-only edge function that creates an already-confirmed
 * user via the GoTrue admin API, bypassing email signup rate limits entirely.
 *
 * SECURITY:
 *   - Only accepts emails matching *@test.izenzo.co.za
 *   - Uses service_role to call auth.admin.createUser({ email_confirm: true })
 *   - Idempotent: if the user already exists, password is reset and email confirmed
 *   - Never sends a confirmation email (no GoTrue email quota consumed)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const TEST_EMAIL_SUFFIX = "@test.izenzo.co.za";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

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
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  try {
    // Fail-closed auth: must be staging tier OR have INTERNAL_CRON_KEY OR be platform_admin
    const internalKey = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
    const providedKey = req.headers.get("x-internal-key") ?? "";
    const hasInternalKey = internalKey.length > 0 && providedKey === internalKey;
    const stagingOk = isStagingTier();
    const adminOk = !stagingOk && !hasInternalKey ? await isPlatformAdminJwt(req) : false;
    if (!stagingOk && !hasInternalKey && !adminOk) {
      return json(req, { error: "Unauthorised" }, 401);
    }

    const { email, password, user_metadata } = await req.json();


    if (!email || typeof email !== "string") {
      return json(req, { error: "email required" }, 400);
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return json(req, { error: "password required (min 8 chars)" }, 400);
    }
    if (!email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) {
      return json(req, 
        { error: `Only ${TEST_EMAIL_SUFFIX} addresses can be provisioned` },
        403,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Idempotency: page through users and reuse if email already exists.
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
      // Always (re)confirm. Only reset the password if the caller explicitly
      // asks — avoids tripping HIBP on every idempotent call.
      const update: Record<string, unknown> = { email_confirm: true };
      if (user_metadata?.reset_password === true) {
        update.password = password;
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(
        existingId,
        update,
      );
      if (updErr) return json(req, { error: updErr.message }, 500);
      return json(req, { user_id: existingId, created: false });
    }

    const { data: created, error: createErr } = await admin.auth.admin
      .createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: user_metadata ?? {},
      });

    if (createErr || !created.user) {
      return json(req, 
        { error: createErr?.message ?? "Failed to create user" },
        500,
      );
    }

    return json(req, { user_id: created.user.id, created: true });
  } catch (err) {
    return json(req, { error: (err as Error).message }, 500);
  }
});
