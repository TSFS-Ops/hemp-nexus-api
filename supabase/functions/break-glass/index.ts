import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { extractClientIp, extractUserAgent } from "../_shared/security-audit.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);

    // Verify Director role
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", authCtx.userId);

    const userRoles = (roles || []).map((r: { role: string }) => r.role);
    const isDirector = userRoles.includes("director") || userRoles.includes("platform_admin");

    if (req.method === "GET") {
      // Anyone with admin/director/auditor can view break-glass history
      const canView = isDirector || userRoles.includes("platform_admin") || userRoles.includes("auditor");
      if (!canView) throw new ApiException("FORBIDDEN", "Insufficient permissions", 403);

      const { data: actions, error } = await adminClient
        .from("break_glass_actions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Also fetch current freeze states
      const { data: freezeSetting } = await adminClient
        .from("admin_settings")
        .select("value")
        .eq("key", "collapse_freeze")
        .maybeSingle();

      return new Response(JSON.stringify({
        actions: actions || [],
        globalCollapseFrozen: (freezeSetting?.value as any)?.enabled || false,
      }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      assertIdempotencyKey(req);
      if (!isDirector) {
        throw new ApiException("FORBIDDEN", "Break-glass actions require Director role", 403);
      }

      // Batch U AUD-018 — require AAL2 (MFA) in addition to password reauth
      // and the existing reason capture. Fails closed if the JWT is aal1.
      await assertAal2(req.headers.get("authorization"), {
        adminClient,
        callerUserId: authCtx.userId,
        action: "break-glass.post",
        context: { request_id: requestId },
      });

      const body = await req.json();
      const { action_type, reason, target_org_id, reauth_password } = body;

      if (!action_type || !reason) {
        throw new ApiException("VALIDATION_ERROR", "action_type and reason are required", 400);
      }

      if (!reauth_password || typeof reauth_password !== "string" || reauth_password.length < 1) {
        throw new ApiException("REAUTH_REQUIRED", "Password re-verification is required for break-glass actions", 401);
      }

      // Batch U AUD-018 — capture caller IP/UA so the break_glass_actions
      // ledger and the audit_log row both preserve operator context.
      const actorIp = extractClientIp(req);
      const userAgent = extractUserAgent(req);

      // ── Server-side re-authentication ──
      // Verify the caller's password via GoTrue token endpoint.
      // This proves identity server-side — a crafted API call cannot skip this.
      const { data: callerProfile } = await adminClient
        .from("profiles")
        .select("email")
        .eq("id", authCtx.userId)
        .single();

      if (!callerProfile?.email) {
        throw new ApiException("REAUTH_FAILED", "Unable to resolve caller identity for re-authentication", 401);
      }

      const gotrue = `${supabaseUrl}/auth/v1/token?grant_type=password`;
      const reauthRes = await fetch(gotrue, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
        },
        body: JSON.stringify({ email: callerProfile.email, password: reauth_password }),
      });

      if (!reauthRes.ok) {
        // Log failed re-auth attempt
        await adminClient.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: authCtx.userId,
          action: "break-glass.reauth_failed",
          entity_type: "system",
          metadata: { action_type, request_id: requestId },
        });
        throw new ApiException("REAUTH_FAILED", "Password verification failed. Break-glass action denied.", 401);
      }

      const reauthData = await reauthRes.json();
      // Ensure the verified user is the same as the caller (prevent token substitution)
      if (reauthData.user?.id !== authCtx.userId) {
        throw new ApiException("REAUTH_FAILED", "Re-authenticated user does not match caller", 401);
      }

      const validActions = [
        "freeze_org", "freeze_api_keys", "global_collapse_freeze",
        "unfreeze_org", "unfreeze_api_keys", "global_collapse_unfreeze",
      ];
      if (!validActions.includes(action_type)) {
        throw new ApiException("VALIDATION_ERROR", `Invalid action_type. Must be one of: ${validActions.join(", ")}`, 400);
      }

      // Execute the break-glass action
      if (action_type === "freeze_org" || action_type === "unfreeze_org") {
        if (!target_org_id) throw new ApiException("VALIDATION_ERROR", "target_org_id required for org freeze", 400);
        const frozen = action_type === "freeze_org";
        await adminClient
          .from("organizations")
          .update({
            frozen,
            frozen_at: frozen ? new Date().toISOString() : null,
            frozen_by: frozen ? authCtx.userId : null,
            frozen_reason: frozen ? reason : null,
          })
          .eq("id", target_org_id);
      }

      if (action_type === "freeze_api_keys" || action_type === "unfreeze_api_keys") {
        if (!target_org_id) throw new ApiException("VALIDATION_ERROR", "target_org_id required for API key freeze", 400);
        const newStatus = action_type === "freeze_api_keys" ? "frozen" : "active";
        await adminClient
          .from("api_keys")
          .update({ status: newStatus })
          .eq("org_id", target_org_id)
          .eq("status", action_type === "freeze_api_keys" ? "active" : "frozen");
      }

      if (action_type === "global_collapse_freeze" || action_type === "global_collapse_unfreeze") {
        const enabled = action_type === "global_collapse_freeze";
        await adminClient
          .from("admin_settings")
          .update({
            value: {
              enabled,
              frozen_by: enabled ? authCtx.userId : null,
              frozen_at: enabled ? new Date().toISOString() : null,
              reason: enabled ? reason : null,
            },
          })
          .eq("key", "collapse_freeze");
      }

      // Log the break-glass action (append-only)
      await adminClient.from("break_glass_actions").insert({
        actor_user_id: authCtx.userId,
        org_id: authCtx.orgId,
        action_type,
        reason,
        target_org_id: target_org_id || null,
        metadata: {
          request_id: requestId,
          actor_ip: actorIp,
          user_agent: userAgent,
          aal: "aal2",
        },
      });

      // Audit log
      await adminClient.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        action: `break-glass.${action_type}`,
        entity_type: "system",
        entity_id: target_org_id || null,
        metadata: {
          reason,
          action_type,
          request_id: requestId,
          actor_ip: actorIp,
          user_agent: userAgent,
          aal: "aal2",
        },
      });

      return new Response(JSON.stringify({
        success: true,
        action_type,
        message: `Break-glass action '${action_type}' executed successfully`,
        logged_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  } catch (error) {
    console.error(`[${requestId}] Break-glass error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
