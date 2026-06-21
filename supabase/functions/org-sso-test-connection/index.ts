/**
 * Batch 4 — org-sso-test-connection
 *
 * The ONLY path that may promote an org_sso_configs row to status='live'.
 * Behaviour:
 *  1. Resolve target org from `org_id` param (org_admin defaults to own).
 *  2. Refuse unless the row already has `supabase_sso_provider_id` set
 *     (i.e. supabase--configure_saml_sso has actually been invoked).
 *  3. Verify the supplied provider id maps to an active Supabase native
 *     SSO provider via the Supabase admin SSO API. We treat HTTP 200
 *     with a non-disabled provider record as a "pass".
 *  4. Record last_tested_at / last_test_result and — on pass — promote
 *     status to 'live'. On fail, status moves to 'failed'.
 *  5. Emit IDENTITY_AUDIT_NAMES.sso_connection_tested + one of
 *     sso_enabled / sso_failed.
 *
 * AAL2 is required (this is a status-change action).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { IDENTITY_AUDIT_NAMES, writeIdentityAudit } from "../_shared/identity-audit.ts";
import { BodySchema } from "./validation.ts";

interface ProviderRecord {
  id: string;
  disabled?: boolean | null;
  saml?: unknown;
}

async function verifySupabaseSsoProvider(
  providerId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ pass: boolean; reason?: string }> {
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/admin/sso/providers/${providerId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    });
    if (resp.status === 404) {
      await resp.text().catch(() => "");
      return { pass: false, reason: "provider_not_found" };
    }
    if (!resp.ok) {
      await resp.text().catch(() => "");
      return { pass: false, reason: `provider_lookup_http_${resp.status}` };
    }
    const body = (await resp.json().catch(() => null)) as ProviderRecord | null;
    if (!body || !body.id) return { pass: false, reason: "provider_payload_invalid" };
    if (body.disabled) return { pass: false, reason: "provider_disabled" };
    return { pass: true };
  } catch (e) {
    return { pass: false, reason: `provider_lookup_threw:${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const cors = handleCors(req, allowedOrigins);
    if (cors) return cors;
    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    if (authCtx.isApiKey) {
      throw new ApiException("FORBIDDEN", "API-key callers cannot test SSO.", 403);
    }

    const { data: rolesRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", authCtx.userId);
    const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
    const isPlatformAdmin = roles.includes("platform_admin");
    const isOrgAdmin = roles.includes("org_admin");
    if (!isPlatformAdmin && !isOrgAdmin) {
      throw new ApiException("FORBIDDEN", "SSO connection test is restricted to org_admin or platform_admin.", 403);
    }

    await assertAal2(req.headers.get("authorization"), {
      adminClient: admin,
      callerUserId: authCtx.userId,
      action: "identity.sso_test_connection",
    });

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiException("VALIDATION_ERROR", "Invalid payload", 400, parsed.error.flatten());
    }

    let targetOrgId = parsed.data.org_id ?? null;
    if (!targetOrgId || !isPlatformAdmin) {
      const { data: prof } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", authCtx.userId)
        .maybeSingle();
      if (!isPlatformAdmin && (!prof?.org_id || (targetOrgId && prof.org_id !== targetOrgId))) {
        throw new ApiException("FORBIDDEN", "Org admins may only test their own organisation's SSO.", 403);
      }
      if (!targetOrgId) targetOrgId = prof?.org_id ?? null;
    }
    if (!targetOrgId) {
      throw new ApiException("VALIDATION_ERROR", "Could not resolve target organisation.", 400);
    }

    const { data: cfg, error: cfgErr } = await admin
      .from("org_sso_configs")
      .select("*")
      .eq("org_id", targetOrgId)
      .maybeSingle();
    if (cfgErr) handleDatabaseError(cfgErr, requestId);
    if (!cfg) {
      throw new ApiException(
        "SSO_NOT_CONFIGURED",
        "No SSO configuration exists for this organisation.",
        409,
      );
    }
    if (!cfg.supabase_sso_provider_id) {
      throw new ApiException(
        "SSO_PROVIDER_MISSING",
        "supabase_sso_provider_id is not set. Configure the Supabase native SAML provider first.",
        409,
      );
    }

    const verdict = await verifySupabaseSsoProvider(
      cfg.supabase_sso_provider_id,
      supabaseUrl,
      supabaseKey,
    );

    const now = new Date().toISOString();
    const updateRow: Record<string, unknown> = {
      last_tested_at: now,
      last_test_result: verdict.pass ? "pass" : "fail",
      failure_reason: verdict.pass ? null : (verdict.reason ?? "unknown_failure"),
      status: verdict.pass ? "live" : "failed",
    };

    const { data: saved, error: updateErr } = await admin
      .from("org_sso_configs")
      .update(updateRow)
      .eq("org_id", targetOrgId)
      .select()
      .single();
    if (updateErr) handleDatabaseError(updateErr, requestId);

    const auditBase = {
      org_id: targetOrgId,
      actor_user_id: authCtx.userId,
      entity_id: saved.id,
    };

    await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_connection_tested, {
      ...auditBase,
      metadata: {
        request_id: requestId,
        result: verdict.pass ? "pass" : "fail",
        reason: verdict.reason ?? null,
        supabase_sso_provider_id: cfg.supabase_sso_provider_id,
      },
    });
    if (verdict.pass) {
      await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_enabled, {
        ...auditBase,
        metadata: { request_id: requestId, last_tested_at: now },
      });
    } else {
      await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_failed, {
        ...auditBase,
        metadata: { request_id: requestId, reason: verdict.reason ?? null },
      });
    }

    return new Response(
      JSON.stringify({
        config: saved,
        test: { pass: verdict.pass, reason: verdict.reason ?? null },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
      requestId,
      headers,
    );
  }
});
