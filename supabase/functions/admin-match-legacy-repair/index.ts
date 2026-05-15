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

const ENDPOINT = "POST /admin-match-legacy-repair";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000000";

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

  try {
    // 1. Mandatory Idempotency-Key.
    let idempotencyKey: string;
    try {
      idempotencyKey = assertIdempotencyKey(req);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "IDEMPOTENCY_KEY_REQUIRED";
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return jsonResponse(req, { error: code, requestId }, status);
    }

    // 2. Auth: caller must be authenticated and is_admin.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) {
      return jsonResponse(req, { error: "UNAUTHORISED", requestId }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authError } =
      await admin.auth.getUser(token);
    if (authError || !caller) {
      return jsonResponse(req, { error: "INVALID_TOKEN", requestId }, 401);
    }
    const { data: isAdmin } = await admin.rpc("is_admin", {
      user_id: caller.id,
    });
    if (!isAdmin) {
      return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
    }

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

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      if (msg.includes("operation_deferred")) {
        return jsonResponse(
          req,
          {
            error: "OPERATION_DEFERRED",
            message:
              "force_terminal_for_orphan_settled is intentionally deferred pending business sign-off.",
            requestId,
          },
          409,
        );
      }
      if (msg.includes("operation_not_applicable")) {
        return jsonResponse(
          req,
          {
            error: "OPERATION_NOT_APPLICABLE",
            message:
              "The selected operation does not address an inconsistency reason currently present on this match.",
            requestId,
          },
          409,
        );
      }
      if (msg.includes("still_inconsistent_after_repair")) {
        return jsonResponse(
          req,
          {
            error: "STILL_INCONSISTENT_AFTER_REPAIR",
            message:
              "Repair completed but the match remains inconsistent — additional reasons present, choose another operation.",
            requestId,
          },
          409,
        );
      }
      if (msg.includes("not_inconsistent")) {
        return jsonResponse(
          req,
          {
            error: "NOT_INCONSISTENT",
            message: "Match is no longer in an inconsistent legacy state.",
            requestId,
          },
          409,
        );
      }
      if (msg.includes("operation_invalid") || msg.includes("operation_required")) {
        return jsonResponse(req, { error: "VALIDATION_ERROR", message: rpcError.message, requestId }, 400);
      }
      if (msg.includes("notes_too_short") || msg.includes("notes_too_long")) {
        return jsonResponse(req, { error: "VALIDATION_ERROR", message: rpcError.message, requestId }, 400);
      }
      if (msg.includes("match_not_found")) {
        return jsonResponse(req, { error: "MATCH_NOT_FOUND", requestId }, 404);
      }
      if (msg.includes("not_admin")) {
        return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
      }
      console.error(`[admin-match-legacy-repair][${requestId}] rpc failed:`, rpcError);
      return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
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

    return jsonResponse(req, responseBody, 200);
  } catch (err) {
    console.error(`[admin-match-legacy-repair][${requestId}] unhandled:`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
