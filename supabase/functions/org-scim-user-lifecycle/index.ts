/**
 * Batch 4 — org-scim-user-lifecycle
 *
 * Admin endpoint that sets a user's SCIM-style state inside an org:
 * invited / active / suspended / deprovisioned. Emits the matching
 * IDENTITY_AUDIT_NAMES audit row. No external SCIM webhook is exposed
 * in Batch 4 — this is structure + audit only.
 *
 * AAL2 required. Org admins are bounded to their own org; platform
 * admins may target any org. Transitions are validated against the
 * SCIM_TRANSITIONS allow-list (mirrored from src/lib/identity/sso-claim.ts).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { writeIdentityAudit, type IdentityAuditName } from "../_shared/identity-audit.ts";
import {
  BodySchema,
  TRANSITIONS,
  auditNameForTransition,
  type ScimState,
} from "./transitions.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
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
      throw new ApiException("FORBIDDEN", "API-key callers cannot manage user lifecycle.", 403);
    }

    const { data: rolesRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", authCtx.userId);
    const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
    const isPlatformAdmin = roles.includes("platform_admin");
    const isOrgAdmin = roles.includes("org_admin");
    if (!isPlatformAdmin && !isOrgAdmin) {
      throw new ApiException(
        "FORBIDDEN",
        "User lifecycle changes are restricted to org_admin or platform_admin.",
        403,
      );
    }

    await assertAal2(req.headers.get("authorization"), {
      adminClient: admin,
      callerUserId: authCtx.userId,
      action: "identity.scim_user_lifecycle",
    });

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiException("VALIDATION_ERROR", "Invalid payload", 400, parsed.error.flatten());
    }
    const { org_id, user_id, state, source, external_id, reason } = parsed.data;

    if (!isPlatformAdmin) {
      const { data: prof } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", authCtx.userId)
        .maybeSingle();
      if (!prof?.org_id || prof.org_id !== org_id) {
        throw new ApiException(
          "FORBIDDEN",
          "Org admins may only manage their own organisation's users.",
          403,
        );
      }
    }

    // Target user must belong to the target org (defence-in-depth).
    const { data: targetProf } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", user_id)
      .maybeSingle();
    if (!targetProf || targetProf.org_id !== org_id) {
      throw new ApiException(
        "USER_NOT_IN_ORG",
        "Target user does not belong to the specified organisation.",
        409,
      );
    }

    const { data: existing } = await admin
      .from("org_scim_user_states")
      .select("*")
      .eq("org_id", org_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (existing) {
      const allowed = TRANSITIONS[existing.state as ScimState] ?? [];
      if (existing.state === state) {
        throw new ApiException(
          "NO_OP_TRANSITION",
          `User is already in state '${state}'.`,
          409,
        );
      }
      if (!allowed.includes(state)) {
        throw new ApiException(
          "INVALID_TRANSITION",
          `Cannot transition from '${existing.state}' to '${state}'.`,
          409,
        );
      }
    }

    const writeRow: Record<string, unknown> = {
      org_id,
      user_id,
      state,
      source: source ?? existing?.source ?? "manual",
      external_id: external_id ?? existing?.external_id ?? null,
      last_state_change_reason: reason,
    };

    const { data: saved, error: upsertErr } = await admin
      .from("org_scim_user_states")
      .upsert(writeRow, { onConflict: "org_id,user_id" })
      .select()
      .single();
    if (upsertErr) handleDatabaseError(upsertErr, requestId);

    const action = auditNameForTransition(state);
    if (action) {
      await writeIdentityAudit(admin, action as never, {
        org_id,
        actor_user_id: authCtx.userId,
        entity_id: saved.id,
        metadata: {
          request_id: requestId,
          previous_state: existing?.state ?? null,
          new_state: state,
          source: writeRow.source,
          reason,
          target_user_id: user_id,
        },
      });
    }

    return new Response(JSON.stringify({ row: saved }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
      requestId,
      headers,
    );
  }
});
