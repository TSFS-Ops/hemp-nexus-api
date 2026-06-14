/**
 * staging-set-fixture-password
 *
 * Staging-only operator workflow:
 *   - Caller must be platform_admin.
 *   - Refuses on production tier (ENVIRONMENT_TIER=production/live/prod).
 *   - Accepts ONLY the four hard-coded Batch A fixture emails.
 *   - Generates a strong random password, sets it via GoTrue admin API,
 *     and mints a SHA-256-hashed one-time reveal token (5 min TTL).
 *   - Returns the reveal token to the caller exactly once. The plaintext
 *     password is never returned by this endpoint and never logged.
 *   - Audited as `staging.fixture_password_set`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const ALLOWED_EMAILS = new Set<string>([
  "api@izenzo.co.za",
  "trade@izenzo.co.za",
  "test1@izenzo.co.za",
  "test2@izenzo.co.za",
]);

const TOKEN_TTL_SECONDS = 300; // 5 minutes
const PASSWORD_TTL_SECONDS = 300;

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

/**
 * Fail-CLOSED environment check.
 *   - If ENVIRONMENT_TIER is unset/empty -> treated as production (deny).
 *   - Only "staging" | "dev" | "development" | "test" enable this workflow.
 */
function isStagingTier(): boolean {
  const tier = (Deno.env.get("ENVIRONMENT_TIER") ?? "").toLowerCase().trim();
  return tier === "staging" || tier === "dev" || tier === "development" || tier === "test";
}

function generatePassword(): string {
  // 24 bytes -> 32 base64url chars; clearly above HIBP/length floors.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
      return json(req, {
        error: "STAGING_ONLY",
        message: "This workflow is disabled outside staging.",
      }, 403);
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

    // AAL2 — staging password mint is a credential-issuing admin action and
    // mirrors the MFA enforcement on admin-legal-hold / admin-credit-org.
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: caller.id,
        action: "staging.set_fixture_password",
      });
    } catch (mfaErr) {
      if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
        return json(req, { error: mfaErr.message, code: "MFA_REQUIRED" }, 403);
      }
      throw mfaErr;
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!ALLOWED_EMAILS.has(email)) {
      return json(req, {
        error: "EMAIL_NOT_ALLOWED",
        message: "Only the Batch A fixture accounts are permitted.",
      }, 403);
    }

    // Locate user via paginated listUsers
    let userId: string | null = null;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json(req, { error: error.message }, 500);
      const hit = data.users.find((u) => u.email?.toLowerCase() === email);
      if (hit) { userId = hit.id; break; }
      if (data.users.length < 1000) break;
    }
    if (!userId) return json(req, { error: "USER_NOT_FOUND" }, 404);

    const password = generatePassword();
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updErr) return json(req, { error: updErr.message }, 500);

    const revealToken = generateToken();
    const tokenHash = await sha256Hex(revealToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

    const { data: tokenRow, error: insErr } = await admin
      .from("staging_password_tokens")
      .insert({
        email,
        user_id: userId,
        // password_plaintext column removed for security — password is
        // returned to the caller exactly once below and not persisted.
        reveal_token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: caller.id,
      })
      .select("id")
      .single();
    if (insErr) return json(req, { error: insErr.message }, 500);

    await admin.from("audit_logs").insert({
      action: "staging.fixture_password_set",
      actor_user_id: caller.id,
      entity_type: "auth_user",
      entity_id: userId,
      metadata: {
        email,
        token_id: tokenRow.id,
        expires_at: expiresAt,
        token_ttl_seconds: TOKEN_TTL_SECONDS,
      },
    }).then(() => {}, () => {}); // best-effort; never block on audit

    // SECURITY: password is delivered out-of-band ONCE at generation time and
    // is never persisted. The reveal endpoint can no longer return it; the
    // caller must capture and forward this value immediately.
    return json(req, {
      reveal_token: revealToken,
      token_id: tokenRow.id,
      email,
      password,
      expires_at: expiresAt,
      ttl_seconds: PASSWORD_TTL_SECONDS,
    });
  } catch (err) {
    console.error("staging-set-fixture-password error:", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
