/**
 * staging-reveal-fixture-password
 *
 * Validates a one-time reveal token, returns the plaintext password
 * exactly once, then marks the row consumed. Refuses on production tier.
 * Audited as `staging.fixture_password_revealed`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  try {
    if (!isStagingTier()) {
      return json(req, { error: "STAGING_ONLY" }, 403);
    }

    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) return json(req, { error: "Unauthorised" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return json(req, { error: "Invalid token" }, 401);

    const { data: isAdmin } = await admin.rpc("is_admin", { user_id: caller.id });
    if (!isAdmin) return json(req, { error: "Admin access required" }, 403);

    // AAL2 — revealing a fixture password exposes a usable credential.
    // Mirror the MFA enforcement applied to other sensitive admin endpoints.
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: caller.id,
        action: "staging.reveal_fixture_password",
      });
    } catch (mfaErr) {
      if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
        return json(req, { error: mfaErr.message, code: "MFA_REQUIRED" }, 403);
      }
      throw mfaErr;
    }

    const body = await req.json().catch(() => ({}));
    const revealToken = String(body?.reveal_token ?? "").trim();
    if (!revealToken) return json(req, { error: "reveal_token required" }, 400);

    const tokenHash = await sha256Hex(revealToken);

    const { data: row, error: selErr } = await admin
      .from("staging_password_tokens")
      .select("id, email, password_plaintext, expires_at, consumed_at")
      .eq("reveal_token_hash", tokenHash)
      .maybeSingle();
    if (selErr) return json(req, { error: selErr.message }, 500);
    if (!row) return json(req, { error: "INVALID_TOKEN" }, 404);
    if (row.consumed_at) return json(req, { error: "TOKEN_ALREADY_USED" }, 410);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json(req, { error: "TOKEN_EXPIRED" }, 410);
    }

    // Mark consumed and clear plaintext atomically (single UPDATE).
    const { error: updErr } = await admin
      .from("staging_password_tokens")
      .update({
        consumed_at: new Date().toISOString(),
        password_plaintext: null,
      })
      .eq("id", row.id)
      .is("consumed_at", null);
    if (updErr) return json(req, { error: updErr.message }, 500);

    await admin.from("audit_logs").insert({
      action: "staging.fixture_password_revealed",
      actor_user_id: caller.id,
      metadata: { email: row.email, token_id: row.id },
    }).then(() => {}, () => {});

    return json(req, {
      email: row.email,
      password: row.password_plaintext,
    });
  } catch (err) {
    console.error("staging-reveal-fixture-password error:", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
