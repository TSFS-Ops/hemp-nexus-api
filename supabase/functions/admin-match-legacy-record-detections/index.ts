/**
 * Batch O Phase 2b Step 6 — admin-match-legacy-record-detections
 *
 * Idempotent detection-audit recorder for inconsistent legacy matches.
 * All real work happens inside the SECURITY DEFINER RPC
 * `public.admin_record_legacy_detections` — this edge function is only
 * the auth + idempotency + validation envelope.
 *
 * Hard scope:
 *   • Accepts ONLY { match_ids?: uuid[] } (Zod .strict). Empty / missing
 *     means "scan every currently inconsistent match (capped at 500)".
 *   • Requires authenticated platform admin (verified via is_admin RPC).
 *   • Requires Idempotency-Key header (assertIdempotencyKey).
 *   • Never mutates `matches`, never sends notifications, never imports
 *     POI / WaD / payment / credit / token / rating / compliance /
 *     public-status / lifecycle / SLA / Batch D / Batch E modules.
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

const ENDPOINT = "POST /admin-match-legacy-record-detections";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000000";
const MAX_MATCH_IDS = 500;

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z
  .object({
    match_ids: z.array(z.string().uuid()).max(MAX_MATCH_IDS).optional(),
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
    let idempotencyKey: string;
    try {
      idempotencyKey = assertIdempotencyKey(req);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "IDEMPOTENCY_KEY_REQUIRED";
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return jsonResponse(req, { error: code, requestId }, status);
    }

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

    // Strict body validation. Empty body is allowed (= scan-all).
    let parsedBody: z.infer<typeof BodySchema> = {};
    if (req.headers.get("content-length") !== "0") {
      try {
        const text = await req.text();
        const raw = text.trim().length === 0 ? {} : JSON.parse(text);
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
    }

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

    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "admin_record_legacy_detections",
      {
        p_admin_user_id: caller.id,
        p_match_ids: parsedBody.match_ids ?? null,
      },
    );

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      if (msg.includes("not_admin")) {
        return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
      }
      if (msg.includes("admin_user_id required")) {
        return jsonResponse(req, { error: "VALIDATION_ERROR", message: rpcError.message, requestId }, 400);
      }
      console.error(`[admin-match-legacy-record-detections][${requestId}] rpc failed:`, rpcError);
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
    console.error(`[admin-match-legacy-record-detections][${requestId}] unhandled:`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
