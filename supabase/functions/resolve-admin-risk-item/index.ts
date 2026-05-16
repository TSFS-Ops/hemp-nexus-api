/**
 * Batch S SUP-003 — resolve-admin-risk-item
 *
 * The ONLY human-facing path that may flip admin_risk_items.status or
 * resolved_at. The DB trigger `admin_risk_items_update_guard_trg` blocks
 * direct UPDATEs unless the controlled resolver sets a transaction-local
 * GUC inside `resolve_admin_risk_item` — system jobs that already
 * pre-existed (token-purchase, lifecycle-scheduler, etc.) continue to
 * work because they also flip the GUC inside their own service-role tx.
 *
 * Gates: platform_admin + AAL2 + reason >= 10 chars + Zod strict.
 * Audit is written by the RPC itself; we also pass actor IP / UA /
 * request id through so the admin_audit_logs.details has actor context.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const ENDPOINT = "POST /resolve-admin-risk-item";

const BodySchema = z.object({
  risk_item_id: z.string().uuid(),
  new_status: z.enum(["open", "investigating", "remediated", "resolved", "dismissed"]),
  reason: z.string().trim().min(10).max(2000),
}).strict();

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
    }),
  );
}

function readActorIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? null;
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID();
  try {
    try {
      assertIdempotencyKey(req);
    } catch (err) {
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
        action: "admin.risk_item_resolve",
        context: { endpoint: ENDPOINT, request_id: requestId },
      });
    } catch (err) {
      if (err instanceof ApiException) {
        return jsonResponse(req, {
          error: err.code,
          message: err.message,
          requestId,
          observed_aal: (err as { details?: { observed_aal?: string } }).details?.observed_aal,
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

    const actorIp = readActorIp(req);
    const userAgent = req.headers.get("user-agent");

    const { data, error } = await admin.rpc("resolve_admin_risk_item", {
      p_risk_item_id: parsed.risk_item_id,
      p_new_status: parsed.new_status,
      p_reason: parsed.reason,
      p_admin_user_id: caller.id,
      p_actor_ip: actorIp,
      p_user_agent: userAgent,
      p_request_id: requestId,
    });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      const map: Record<string, [string, number]> = {
        reason_required:      ["REASON_REQUIRED", 400],
        invalid_status:       ["VALIDATION_ERROR", 400],
        not_admin:            ["FORBIDDEN", 403],
        risk_item_not_found:  ["RISK_ITEM_NOT_FOUND", 404],
      };
      for (const [needle, [code, status]] of Object.entries(map)) {
        if (msg.includes(needle)) return jsonResponse(req, { error: code, requestId }, status);
      }
      console.error(`[resolve-admin-risk-item][${requestId}]`, error);
      return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
    }

    return jsonResponse(req, { ok: true, result: data, requestId }, 200);
  } catch (err) {
    console.error(`[resolve-admin-risk-item][${requestId}] unhandled`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
