/**
 * Batch O Phase 2b Step 3 — admin-match-legacy-archive
 *
 * Smallest safe MT-008 admin mutation: marks an inconsistent legacy match
 * as archived/held by writing the `legacy_archived_admin_hold` lifecycle
 * marker into `matches.metadata` and emitting a single
 * `match.legacy_state_archived` audit row. All real work happens inside
 * the SECURITY DEFINER RPC `public.admin_archive_legacy_match` — this
 * edge function is only the auth + idempotency + validation envelope.
 *
 * Hard scope:
 *   • Accepts ONLY { match_id, notes }. Strict Zod schema rejects anything
 *     else so an attacker cannot smuggle arbitrary patch fields.
 *   • Requires authenticated platform admin (verified via is_admin RPC).
 *   • Requires Idempotency-Key header (assertIdempotencyKey).
 *   • No notification dispatch, no email helper, no POI/WaD/payment/credit
 *     /rating/compliance/public-status/lifecycle/SLA imports.
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

const ENDPOINT = "POST /admin-match-legacy-archive";
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

  try {
    // 1. Idempotency-Key header is mandatory for this mutation.
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
      return jsonResponse(
        req,
        { error: "VALIDATION_ERROR", message: detail, requestId },
        400,
      );
    }

    // 4. Idempotency cache lookup. Scope by SYSTEM_ORG_ID since this is a
    //    cross-org admin action (the match's own org might not be the
    //    caller's org). The unique key is still (org_id, key, endpoint).
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

    // 5. Call the SECURITY DEFINER RPC. All real work + audit happens here.
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "admin_archive_legacy_match",
      {
        p_match_id: parsedBody.match_id,
        p_admin_user_id: caller.id,
        p_notes: parsedBody.notes,
      },
    );

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      if (msg.includes("not_inconsistent")) {
        return jsonResponse(
          req,
          { error: "NOT_INCONSISTENT", message: "Match is no longer in an inconsistent legacy state.", requestId },
          409,
        );
      }
      if (msg.includes("match_not_found")) {
        return jsonResponse(req, { error: "MATCH_NOT_FOUND", requestId }, 404);
      }
      if (msg.includes("notes_too_short") || msg.includes("notes_too_long")) {
        return jsonResponse(req, { error: "VALIDATION_ERROR", message: rpcError.message, requestId }, 400);
      }
      if (msg.includes("not_admin")) {
        return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
      }
      console.error(`[admin-match-legacy-archive][${requestId}] rpc failed:`, rpcError);
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
    console.error(`[admin-match-legacy-archive][${requestId}] unhandled:`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
