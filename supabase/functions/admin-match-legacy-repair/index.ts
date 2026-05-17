/**
 * Batch O Phase 2b Step 4 — admin-match-legacy-repair
 *
 * Companion to admin-match-legacy-archive. Applies a *bounded* repair
 * patch from a fixed allow-list to an inconsistent legacy match. All
 * real work happens inside the SECURITY DEFINER RPC
 * `public.admin_repair_legacy_match` — this edge function is only the
 * auth + idempotency + validation envelope.
 *
 * Allow-list (must match the RPC):
 *   • clear_stale_settled_at
 *   • restore_poi_state_for_completed
 *   • clear_legacy_repair_marker
 *   • force_terminal_for_orphan_settled  ← accepted but RPC returns
 *     `operation_deferred` until business sign-off names the safe patch.
 *
 * Hard scope:
 *   • Accepts ONLY { match_id, operation, notes } (Zod .strict).
 *   • Requires authenticated platform admin (verified via is_admin RPC).
 *   • Requires Idempotency-Key header (assertIdempotencyKey).
 *   • No notification dispatch, no email helper, no POI / WaD / payment
 *     / credit / token / rating / compliance / public-status / lifecycle
 *     / SLA imports.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  assertIdempotencyKey,
  lookupIdempotentResponse,
  storeIdempotentResponse,
  cachedResponseToHttp,
} from "../_shared/idempotency.ts";
import { assertAal2, readAal } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  writeAdminAudit,
  extractIp,
  extractUserAgent,
  type AdminAuditAal,
} from "../_shared/admin-audit.ts";

const ENDPOINT = "POST /admin-match-legacy-repair";
const ACTION = "admin.match.legacy_repair";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000000";

async function upsertRepairFollowupRiskItem(admin: any, payload: {
  matchId: string;
  operation: string;
  reason: string;
  actorUserId: string;
  requestId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  severity?: "low" | "medium" | "high" | "critical";
}) {
  const dedupKey = `legacy_repair_followup:${payload.matchId}:${payload.operation}:${payload.reason}`;
  try {
    await admin.from("admin_risk_items").upsert(
      {
        title: `Legacy match repair follow-up: ${payload.reason}`,
        description: `Repair operation '${payload.operation}' on match ${payload.matchId} was not completed (${payload.reason}). Admin must follow up.`,
        severity: payload.severity ?? "high",
        status: "open",
        kind: "legacy_repair_followup_required",
        dedup_key: dedupKey,
        metadata: {
          match_id: payload.matchId,
          operation: payload.operation,
          reason: payload.reason,
          actor_user_id: payload.actorUserId,
          request_id: payload.requestId,
          before: payload.before ?? null,
          after: payload.after ?? null,
          detected_at: new Date().toISOString(),
        },
      },
      { onConflict: "dedup_key", ignoreDuplicates: false },
    );
  } catch (err) {
    console.error("[admin-match-legacy-repair] risk item upsert failed:", err);
  }
}

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_OPERATIONS = [
  "clear_stale_settled_at",
  "restore_poi_state_for_completed",
  "clear_legacy_repair_marker",
  "force_terminal_for_orphan_settled",
] as const;

const BodySchema = z
  .object({
    match_id: z.string().uuid(),
    operation: z.enum(ALLOWED_OPERATIONS),
    notes: z.string().trim().min(10).max(2000),
  })
  .strict();

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
    }),
  );
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const requestId = crypto.randomUUID();
  const ip = extractIp(req);
  const userAgent = extractUserAgent(req);

  // Service-role client created up-front so failure-path audits can write.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const auditBase = {
    admin,
    action: ACTION,
    targetType: "match",
    requestId,
    endpoint: ENDPOINT,
    ipAddress: ip,
    userAgent,
  } as const;

  try {
    // 1. Mandatory Idempotency-Key.
    let idempotencyKey: string;
    try {
      idempotencyKey = assertIdempotencyKey(req);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "IDEMPOTENCY_KEY_REQUIRED";
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      await writeAdminAudit({
        ...auditBase,
        status: "denied",
        reason: code,
        aal: { required: true, observed: null, outcome: "not_evaluated" },
      });
      return jsonResponse(req, { error: code, requestId }, status);
    }

    // 2. Auth: caller must be authenticated and is_admin.
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) {
      await writeAdminAudit({
        ...auditBase,
        status: "denied",
        reason: "UNAUTHORISED",
        aal: { required: true, observed: null, outcome: "not_evaluated" },
      });
      return jsonResponse(req, { error: "UNAUTHORISED", requestId }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authError } =
      await admin.auth.getUser(token);
    if (authError || !caller) {
      await writeAdminAudit({
        ...auditBase,
        status: "denied",
        reason: "INVALID_TOKEN",
        aal: { required: true, observed: readAal(authHeader), outcome: "not_evaluated" },
      });
      return jsonResponse(req, { error: "INVALID_TOKEN", requestId }, 401);
    }
    const observedAal = readAal(authHeader);
    const { data: isAdmin } = await admin.rpc("is_admin", {
      user_id: caller.id,
    });
    if (!isAdmin) {
      await writeAdminAudit({
        ...auditBase,
        status: "denied",
        actorUserId: caller.id,
        reason: "FORBIDDEN",
        aal: { required: true, observed: observedAal, outcome: "not_evaluated" },
      });
      return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
    }

    // Batch K Fix 3: AAL2 / MFA required for manual state repair.
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: caller.id,
        action: "admin.match_legacy_repair",
        context: { endpoint: ENDPOINT, request_id: requestId },
      });
    } catch (err) {
      if (err instanceof ApiException) {
        await writeAdminAudit({
          ...auditBase,
          status: "denied",
          actorUserId: caller.id,
          reason: err.code,
          aal: {
            required: true,
            observed: observedAal,
            outcome: "denied",
          },
        });
        return jsonResponse(
          req,
          { error: err.code, message: err.message, requestId, observed_aal: (err as any).details?.observed_aal },
          err.statusCode,
        );
      }
      throw err;
    }

    const aalSatisfied: AdminAuditAal = {
      required: true,
      observed: observedAal,
      outcome: "satisfied",
    };

    // 3. Strict body validation (rejects unknown fields).
    let parsedBody: z.infer<typeof BodySchema>;
    try {
      const raw = await req.json();
      parsedBody = BodySchema.parse(raw);
    } catch (err) {
      const detail =
        err instanceof z.ZodError
          ? err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
          : "Invalid JSON body";
      await writeAdminAudit({
        ...auditBase,
        status: "denied",
        actorUserId: caller.id,
        reason: "VALIDATION_ERROR",
        aal: aalSatisfied,
        extra: { detail },
      });
      return jsonResponse(
        req,
        { error: "VALIDATION_ERROR", message: detail, requestId },
        400,
      );
    }

    // 4. Idempotency cache lookup. Cross-org admin action — scope by
    //    SYSTEM_ORG_ID (matches archive endpoint).
    const cached = await lookupIdempotentResponse({
      supabase: admin,
      orgId: SYSTEM_ORG_ID,
      endpoint: ENDPOINT,
      idempotencyKey,
      required: true,
      requestId,
    });
    if (cached) {
      await writeAdminAudit({
        ...auditBase,
        status: "info",
        actorUserId: caller.id,
        targetId: parsedBody.match_id,
        reason: "IDEMPOTENT_REPLAY",
        aal: aalSatisfied,
        extra: { operation: parsedBody.operation },
      });
      return cachedResponseToHttp(cached, baseHeaders);
    }

    // 5. SECURITY DEFINER RPC — does the actual repair + audit + locks.
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "admin_repair_legacy_match",
      {
        p_match_id: parsedBody.match_id,
        p_admin_user_id: caller.id,
        p_operation: parsedBody.operation,
        p_notes: parsedBody.notes,
      },
    );

    // Helper to emit the rpc-failure audit and return a typed response.
    const failure = async (
      errorCode: string,
      httpStatus: number,
      message: string,
      reasonExtra?: Record<string, unknown>,
    ) => {
      await writeAdminAudit({
        ...auditBase,
        status: errorCode === "INTERNAL_ERROR" ? "error" : "denied",
        actorUserId: caller.id,
        targetId: parsedBody.match_id,
        reason: errorCode,
        aal: aalSatisfied,
        extra: { operation: parsedBody.operation, ...(reasonExtra ?? {}) },
      });
      return jsonResponse(req, { error: errorCode, message, requestId }, httpStatus);
    };

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      if (msg.includes("operation_deferred")) {
        await upsertRepairFollowupRiskItem(admin, {
          matchId: parsedBody.match_id, operation: parsedBody.operation,
          reason: "operation_deferred", actorUserId: caller.id, requestId,
        });
        return failure(
          "OPERATION_DEFERRED", 409,
          "force_terminal_for_orphan_settled is intentionally deferred pending business sign-off.",
        );
      }
      if (msg.includes("completed_without_sealed_wad")) {
        await upsertRepairFollowupRiskItem(admin, {
          matchId: parsedBody.match_id, operation: parsedBody.operation,
          reason: "completed_without_sealed_wad", actorUserId: caller.id,
          requestId, severity: "critical",
        });
        return failure(
          "COMPLETED_WITHOUT_SEALED_WAD", 409,
          "Cannot restore COMPLETED poi_state without a sealed WaD for this match. A follow-up risk item has been created.",
        );
      }
      if (msg.includes("operation_not_applicable")) {
        return failure(
          "OPERATION_NOT_APPLICABLE", 409,
          "The selected operation does not address an inconsistency reason currently present on this match.",
        );
      }
      if (msg.includes("still_inconsistent_after_repair")) {
        await upsertRepairFollowupRiskItem(admin, {
          matchId: parsedBody.match_id, operation: parsedBody.operation,
          reason: "still_inconsistent_after_repair", actorUserId: caller.id, requestId,
        });
        return failure(
          "STILL_INCONSISTENT_AFTER_REPAIR", 409,
          "Repair completed but the match remains inconsistent — additional reasons present, choose another operation.",
        );
      }
      if (msg.includes("not_inconsistent")) {
        return failure("NOT_INCONSISTENT", 409, "Match is no longer in an inconsistent legacy state.");
      }
      if (msg.includes("operation_invalid") || msg.includes("operation_required")) {
        return failure("VALIDATION_ERROR", 400, rpcError.message);
      }
      if (msg.includes("notes_too_short") || msg.includes("notes_too_long")) {
        return failure("VALIDATION_ERROR", 400, rpcError.message);
      }
      if (msg.includes("match_not_found")) {
        return failure("MATCH_NOT_FOUND", 404, "Match not found.");
      }
      if (msg.includes("not_admin")) {
        return failure("FORBIDDEN", 403, "Not admin.");
      }
      console.error(`[admin-match-legacy-repair][${requestId}] rpc failed:`, rpcError);
      return failure("INTERNAL_ERROR", 500, "Internal error.", { rpc_message: rpcError.message });
    }

    const responseBody = { ok: true, result: rpcResult, requestId };
    await storeIdempotentResponse(
      {
        supabase: admin,
        orgId: SYSTEM_ORG_ID,
        endpoint: ENDPOINT,
        idempotencyKey,
        required: true,
        requestId,
      },
      { status: 200, body: responseBody },
    );

    await writeAdminAudit({
      ...auditBase,
      status: "success",
      actorUserId: caller.id,
      targetId: parsedBody.match_id,
      aal: aalSatisfied,
      extra: { operation: parsedBody.operation },
    });

    return jsonResponse(req, responseBody, 200);
  } catch (err) {
    console.error(`[admin-match-legacy-repair][${requestId}] unhandled:`, err);
    await writeAdminAudit({
      ...auditBase,
      status: "error",
      reason: "UNHANDLED",
      aal: { required: true, observed: null, outcome: "not_evaluated" },
      extra: { message: (err as Error)?.message ?? String(err) },
    });
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
