/**
 * Batch Q — admin-counterparty-corrections
 *
 * AAL2 + idempotency + is_admin envelope around two audited RPCs:
 *   • link_to_org  -> admin_link_counterparty_to_org
 *   • merge        -> admin_merge_counterparties
 *
 * No silent merge, no historical match rewrite. Every call writes a
 * before/after row to admin_audit_logs.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const ENDPOINT = "POST /admin-counterparty-corrections";

const BodySchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("link_to_org"),
    counterparty_id: z.string().uuid(),
    org_id: z.string().uuid(),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({
    operation: z.literal("merge"),
    primary_id: z.string().uuid(),
    duplicate_id: z.string().uuid(),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
]);

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders, "Content-Type": "application/json" },
  }));
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID();
  try {
    try { assertIdempotencyKey(req); } catch (err) {
      const code = (err as { code?: string }).code ?? "IDEMPOTENCY_KEY_REQUIRED";
      return jsonResponse(req, { error: code, requestId }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) return jsonResponse(req, { error: "UNAUTHORISED", requestId }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return jsonResponse(req, { error: "INVALID_TOKEN", requestId }, 401);

    const { data: isAdmin } = await admin.rpc("is_admin", { user_id: caller.id });
    if (!isAdmin) return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);

    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: caller.id,
        action: "admin.counterparty_corrections",
        context: { endpoint: ENDPOINT, request_id: requestId },
      });
    } catch (err) {
      if (err instanceof ApiException) {
        return jsonResponse(req, {
          error: err.code, message: err.message, requestId,
          observed_aal: (err as any).details?.observed_aal,
        }, err.statusCode);
      }
      throw err;
    }

    let parsed: z.infer<typeof BodySchema>;
    try {
      parsed = BodySchema.parse(await req.json());
    } catch (err) {
      const detail = err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
        : "Invalid JSON body";
      return jsonResponse(req, { error: "VALIDATION_ERROR", message: detail, requestId }, 400);
    }

    let rpcResult: unknown;
    let rpcError: { message?: string } | null = null;
    if (parsed.operation === "link_to_org") {
      const { data, error } = await admin.rpc("admin_link_counterparty_to_org", {
        p_counterparty_id: parsed.counterparty_id,
        p_org_id: parsed.org_id,
        p_reason: parsed.reason,
        p_admin_user_id: caller.id,
      });
      rpcResult = data; rpcError = error;
    } else {
      const { data, error } = await admin.rpc("admin_merge_counterparties", {
        p_primary_id: parsed.primary_id,
        p_duplicate_id: parsed.duplicate_id,
        p_reason: parsed.reason,
        p_admin_user_id: caller.id,
      });
      rpcResult = data; rpcError = error;
    }

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      const map: Record<string, [string, number]> = {
        reason_required:       ["REASON_REQUIRED", 400],
        not_admin:             ["FORBIDDEN", 403],
        counterparty_not_found:["COUNTERPARTY_NOT_FOUND", 404],
        org_not_found:         ["ORG_NOT_FOUND", 404],
        cannot_merge_self:     ["CANNOT_MERGE_SELF", 400],
        duplicate_not_found:   ["DUPLICATE_NOT_FOUND", 404],
        primary_not_found:     ["PRIMARY_NOT_FOUND", 404],
        already_merged:        ["ALREADY_MERGED", 409],
      };
      for (const [needle, [code, status]] of Object.entries(map)) {
        if (msg.includes(needle)) return jsonResponse(req, { error: code, requestId }, status);
      }
      console.error(`[admin-counterparty-corrections][${requestId}]`, rpcError);
      return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
    }

    return jsonResponse(req, { ok: true, result: rpcResult, requestId }, 200);
  } catch (err) {
    console.error(`[admin-counterparty-corrections][${requestId}] unhandled:`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
