/**
 * Batch F7 — admin-manual-overrides atomic rewire.
 *
 * Single atomic RPC `admin_manual_override_with_governance` now performs
 * the manual-override mutation, the admin_audit_logs insert, and the
 * canonical `admin.hq_decision_recorded` event in ONE PostgreSQL
 * transaction. If any part fails, the whole tx rolls back; there is no
 * split-commit path between the business mutation and the governance
 * event.
 *
 * For `force_status` / `void_match` the wrapper performs
 * `safe_transition_match_state` internally.
 * For `rerun_screening` / `regenerate_evidence` the external edge
 * function (dilisense-screen / evidence-pack) is invoked first to
 * trigger the side-effect; the wrapper then atomically commits the
 * audit row and governance event together.
 *
 * Pre-F7 the endpoint did:
 *   safe_transition_match_state | invoke()
 *      → admin_audit_logs.insert
 *      → recordAdminHqDecision (separate ts call)
 * which left a gap where the mutation could commit without governance.
 *
 * Gates preserved: platform_admin (is_admin), AAL2 (assertAal2),
 * reason ≥ 10 chars, Idempotency-Key required, Zod strict body.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const ENDPOINT = "POST /admin-manual-overrides";

const ALLOWED_STATUSES = ["matched", "settled", "voided", "disputed"] as const;

const BodySchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("force_status"),
    match_id: z.string().uuid(),
    new_status: z.enum(ALLOWED_STATUSES),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({
    operation: z.literal("void_match"),
    match_id: z.string().uuid(),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({
    operation: z.literal("rerun_screening"),
    entity_id: z.string().uuid(),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({
    operation: z.literal("regenerate_evidence"),
    match_id: z.string().uuid(),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
]);

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
        action: "admin.manual_override",
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
      return jsonResponse(req, {
        error: "VALIDATION_ERROR",
        message: detail,
        requestId,
      }, 400);
    }

    const actorIp = readActorIp(req);
    const userAgent = req.headers.get("user-agent") ?? null;

    // For the two external-side-effect operations, invoke the external
    // edge function BEFORE the atomic wrapper. If the invocation fails,
    // no audit row and no governance event are written.
    let operationResult: unknown = null;
    let externalBefore: unknown = null;
    let externalAfter: unknown = null;

    if (parsed.operation === "rerun_screening") {
      const { data: entityBefore } = await admin
        .from("entities")
        .select("id, name, org_id, verification_status, jurisdiction, updated_at")
        .eq("id", parsed.entity_id)
        .maybeSingle();
      externalBefore = entityBefore;
      const { data, error: invokeErr } = await admin.functions.invoke("dilisense-screen", {
        body: { entity_id: parsed.entity_id, force: true },
      });
      if (invokeErr) {
        console.error(`[admin-manual-overrides][${requestId}] dilisense`, invokeErr);
        return jsonResponse(req, {
          error: "SCREENING_INVOKE_FAILED",
          message: invokeErr.message,
          requestId,
        }, 502);
      }
      operationResult = data;
      const { data: entityAfter } = await admin
        .from("entities")
        .select("id, name, verification_status, jurisdiction, updated_at")
        .eq("id", parsed.entity_id)
        .maybeSingle();
      externalAfter = entityAfter;
    } else if (parsed.operation === "regenerate_evidence") {
      const { data: matchBefore } = await admin
        .from("matches")
        .select("id, state, status, org_id, updated_at")
        .eq("id", parsed.match_id)
        .maybeSingle();
      externalBefore = matchBefore;
      const { data, error: invokeErr } = await admin.functions.invoke("evidence-pack", {
        body: { match_id: parsed.match_id, force_regenerate: true },
      });
      if (invokeErr) {
        console.error(`[admin-manual-overrides][${requestId}] evidence-pack`, invokeErr);
        return jsonResponse(req, {
          error: "EVIDENCE_INVOKE_FAILED",
          message: invokeErr.message,
          requestId,
        }, 502);
      }
      operationResult = data;
      externalAfter = matchBefore; // evidence-pack does not mutate the match row
    }

    // Build params for the atomic wrapper.
    const params: Record<string, unknown> = {};
    if (parsed.operation === "force_status") {
      params.match_id = parsed.match_id;
      params.new_status = parsed.new_status;
    } else if (parsed.operation === "void_match") {
      params.match_id = parsed.match_id;
    } else if (parsed.operation === "rerun_screening") {
      params.entity_id = parsed.entity_id;
    } else {
      params.match_id = parsed.match_id;
    }

    const { data: rpcData, error: rpcErr } = await admin.rpc(
      "admin_manual_override_with_governance",
      {
        p_operation: parsed.operation,
        p_admin_user_id: caller.id,
        p_reason: parsed.reason,
        p_request_id: requestId,
        p_params: params,
        p_before_snapshot: externalBefore as object | null,
        p_after_snapshot: externalAfter as object | null,
        p_operation_result: operationResult as object | null,
        p_actor_ip: actorIp,
        p_user_agent: userAgent,
        p_aal: "aal2",
        p_policy_version: "admin-hq-decision/v1",
      },
    );

    if (rpcErr) {
      console.error(`[admin-manual-overrides][${requestId}] atomic rpc`, rpcErr);
      const msg = rpcErr.message ?? "";
      if (/match not found/i.test(msg)) {
        return jsonResponse(req, { error: "MATCH_NOT_FOUND", requestId }, 404);
      }
      if (/transition rejected/i.test(msg)) {
        return jsonResponse(req, { error: "TRANSITION_REJECTED", message: msg, requestId }, 422);
      }
      if (/invalid input|invalid new_status|unknown operation|missing/i.test(msg)) {
        return jsonResponse(req, { error: "VALIDATION_ERROR", message: msg, requestId }, 400);
      }
      return jsonResponse(req, { error: "INTERNAL_ERROR", message: msg, requestId }, 500);
    }

    const result = (rpcData ?? {}) as Record<string, unknown>;
    return jsonResponse(req, {
      ok: true,
      operation: parsed.operation,
      result: result.result ?? operationResult,
      governance_event_id: result.event_id ?? null,
      deduplicated: result.deduplicated === true,
      requestId,
    }, 200);
  } catch (err) {
    console.error(`[admin-manual-overrides][${requestId}] unhandled`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
