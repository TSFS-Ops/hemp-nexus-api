/**
 * Batch O Phase 2b Step 3 — admin-match-legacy-archive
 *
 * Companion to admin-match-legacy-repair. Marks an inconsistent legacy
 * match as archived/held. Real work happens in the SECURITY DEFINER RPC
 * `public.admin_archive_legacy_match`; this edge function is the
 * auth + idempotency + validation envelope and emits structured
 * admin-audit rows on every terminal branch.
 *
 * Hard scope:
 *   • Accepts ONLY { match_id, notes } (Zod .strict).
 *   • Requires authenticated platform admin (verified via is_admin RPC).
 *   • Requires Idempotency-Key header (assertIdempotencyKey).
 *   • Emits `admin.match.legacy_archive` audit rows tagged with
 *     request_id, action_type, status, aal evaluation, reason.
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
import { readAal } from "../_shared/aal.ts";
import {
  writeAdminAudit,
  extractIp,
  extractUserAgent,
} from "../_shared/admin-audit.ts";

const ENDPOINT = "POST /admin-match-legacy-archive";
const ACTION = "admin.match.legacy_archive";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000000";

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z
  .object({
    match_id: z.string().uuid(),
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

  // Archive is NOT currently aal2-gated; audit reflects "not_required".
  const aalInfo = { required: false as const, observed: null, outcome: "not_required" as const };

  try {
    // 1. Idempotency-Key.
    let idempotencyKey: string;
    try {
      idempotencyKey = assertIdempotencyKey(req);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "IDEMPOTENCY_KEY_REQUIRED";
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      await writeAdminAudit({ ...auditBase, status: "denied", reason: code, aal: aalInfo });
      return jsonResponse(req, { error: code, requestId }, status);
    }

    // 2. Auth.
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) {
      await writeAdminAudit({ ...auditBase, status: "denied", reason: "UNAUTHORISED", aal: aalInfo });
      return jsonResponse(req, { error: "UNAUTHORISED", requestId }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const observedAal = readAal(authHeader);
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller) {
      await writeAdminAudit({
        ...auditBase, status: "denied", reason: "INVALID_TOKEN",
        aal: { required: false, observed: observedAal, outcome: "not_required" },
      });
      return jsonResponse(req, { error: "INVALID_TOKEN", requestId }, 401);
    }
    const { data: isAdmin } = await admin.rpc("is_admin", { user_id: caller.id });
    if (!isAdmin) {
      await writeAdminAudit({
        ...auditBase, status: "denied", actorUserId: caller.id, reason: "FORBIDDEN",
        aal: { required: false, observed: observedAal, outcome: "not_required" },
      });
      return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
    }

    const aalEvaluated = { required: false as const, observed: observedAal, outcome: "not_required" as const };

    // 3. Strict body validation.
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
        ...auditBase, status: "denied", actorUserId: caller.id,
        reason: "VALIDATION_ERROR", aal: aalEvaluated, extra: { detail },
      });
      return jsonResponse(req, { error: "VALIDATION_ERROR", message: detail, requestId }, 400);
    }

    // 4. Idempotency cache lookup.
    const cached = await lookupIdempotentResponse({
      supabase: admin, orgId: SYSTEM_ORG_ID, endpoint: ENDPOINT,
      idempotencyKey, required: true, requestId,
    });
    if (cached) {
      await writeAdminAudit({
        ...auditBase, status: "info", actorUserId: caller.id,
        targetId: parsedBody.match_id, reason: "IDEMPOTENT_REPLAY", aal: aalEvaluated,
      });
      return cachedResponseToHttp(cached, baseHeaders);
    }

    // 5. SECURITY DEFINER RPC.
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "admin_archive_legacy_match",
      {
        p_match_id: parsedBody.match_id,
        p_admin_user_id: caller.id,
        p_notes: parsedBody.notes,
      },
    );

    const failure = async (errorCode: string, httpStatus: number, message: string) => {
      await writeAdminAudit({
        ...auditBase,
        status: errorCode === "INTERNAL_ERROR" ? "error" : "denied",
        actorUserId: caller.id,
        targetId: parsedBody.match_id,
        reason: errorCode,
        aal: aalEvaluated,
      });
      return jsonResponse(req, { error: errorCode, message, requestId }, httpStatus);
    };

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      if (msg.includes("not_inconsistent")) {
        return failure("NOT_INCONSISTENT", 409, "Match is no longer in an inconsistent legacy state.");
      }
      if (msg.includes("match_not_found")) {
        return failure("MATCH_NOT_FOUND", 404, "Match not found.");
      }
      if (msg.includes("notes_too_short") || msg.includes("notes_too_long")) {
        return failure("VALIDATION_ERROR", 400, rpcError.message);
      }
      if (msg.includes("not_admin")) {
        return failure("FORBIDDEN", 403, "Not admin.");
      }
      console.error(`[admin-match-legacy-archive][${requestId}] rpc failed:`, rpcError);
      return failure("INTERNAL_ERROR", 500, "Internal error.");
    }

    const responseBody = { ok: true, result: rpcResult, requestId };
    await storeIdempotentResponse(
      {
        supabase: admin, orgId: SYSTEM_ORG_ID, endpoint: ENDPOINT,
        idempotencyKey, required: true, requestId,
      },
      { status: 200, body: responseBody },
    );

    await writeAdminAudit({
      ...auditBase, status: "success", actorUserId: caller.id,
      targetId: parsedBody.match_id, aal: aalEvaluated,
    });

    return jsonResponse(req, responseBody, 200);
  } catch (err) {
    console.error(`[admin-match-legacy-archive][${requestId}] unhandled:`, err);
    await writeAdminAudit({
      ...auditBase, status: "error", reason: "UNHANDLED", aal: aalInfo,
      extra: { message: (err as Error)?.message ?? String(err) },
    });
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
