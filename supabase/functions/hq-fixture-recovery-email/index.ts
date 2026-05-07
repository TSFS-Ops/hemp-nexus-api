/**
 * hq-fixture-recovery-email
 *
 * Production-safe operator workflow for Batch A UAT.
 *
 * What it does:
 *   - platform_admin caller triggers a STANDARD Supabase password recovery
 *     email to one of the four hard-coded Batch A fixture inboxes.
 *   - The tester opens the link in their controlled inbox and sets their
 *     own password.
 *
 * What it deliberately does NOT do:
 *   - Generate, set, return, store, or log a password.
 *   - Return or log the recovery link / token.
 *   - Allow any email outside the four-fixture allowlist.
 *   - Touch orgs, roles, billing, matches, engagements, POIs or WaD.
 *
 * Audit:
 *   - One row per request: action = `uat.fixture_recovery_email_sent`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const ALLOWED_EMAILS = new Set<string>([
  "api@izenzo.co.za",
  "trade@izenzo.co.za",
  "test1@izenzo.co.za",
  "test2@izenzo.co.za",
]);

const FIXTURE_LABEL = "Batch A Tests 5 and 6";

function json(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function siteUrl(req: Request): string {
  const explicit = (Deno.env.get("PUBLIC_SITE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  return "https://trade.izenzo.co.za";
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;

  try {
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

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!ALLOWED_EMAILS.has(email)) {
      return json(
        req,
        {
          error: "EMAIL_NOT_ALLOWED",
          message: "Only the four Batch A fixture accounts are permitted.",
        },
        403,
      );
    }

    // Trigger the standard Supabase recovery email. This uses the normal
    // auth recovery flow — the user receives the same templated email any
    // self-service "Forgot password" request would produce. We do NOT
    // capture or log the recovery link.
    const redirectTo = `${siteUrl(req)}/reset-password`;
    const { error: recoveryErr } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (recoveryErr) {
      // Do not echo provider internals to the client; surface a generic error.
      console.error("recovery dispatch failed", { email, code: recoveryErr.status });
      return json(req, { error: "RECOVERY_DISPATCH_FAILED" }, 502);
    }

    // Locate user_id for the audit row (best-effort).
    let targetUserId: string | null = null;
    try {
      const { data: prof } = await admin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      targetUserId = prof?.id ?? null;
    } catch (_) { /* ignore */ }

    // audit_logs.org_id is NOT NULL — scope to the caller's org.
    let actorOrgId: string | null = null;
    try {
      const { data: callerProf } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", caller.id)
        .maybeSingle();
      actorOrgId = callerProf?.org_id ?? null;
    } catch (_) { /* ignore */ }

    const sentAt = new Date().toISOString();

    if (actorOrgId) {
      await admin
        .from("audit_logs")
        .insert({
          org_id: actorOrgId,
          action: "uat.fixture_recovery_email_sent",
          actor_user_id: caller.id,
          entity_type: "auth_user",
          entity_id: targetUserId,
          metadata: {
            email,
            fixture: FIXTURE_LABEL,
            sent_at: sentAt,
            redirect_to: redirectTo,
          },
        })
        .then(() => {}, (e) => {
          console.error("audit insert failed", e);
        });
    } else {
      console.error("audit insert skipped: caller has no org_id", { caller_id: caller.id });
    }

    return json(req, {
      ok: true,
      email,
      fixture: FIXTURE_LABEL,
      sent_at: sentAt,
    });
  } catch (err) {
    console.error("hq-fixture-recovery-email error:", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
