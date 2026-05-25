/**
 * Batch S SUP-001 / AUD-016 — admin-manual-overrides
 *
 * Server-side replacement for the former client-side `AdminManualOverrides`
 * mutation path. All four supported operations now go through this route so
 * the audit row is server-authored with reason floor, AAL2, and before/after.
 *
 * Supported operations:
 *   - force_status         → safe_transition_match_state(p_new_state)
 *   - rerun_screening      → invoke dilisense-screen (force=true)
 *   - regenerate_evidence  → invoke evidence-pack (force_regenerate=true)
 *   - void_match           → safe_transition_match_state('voided')
 *
 * Gates:
 *   - platform_admin (is_admin) required
 *   - AAL2 (MFA) required
 *   - reason ≥ 10 chars
 *   - Zod strict body
 *   - Idempotency-Key required
 *
 * Audit:
 *   - admin_audit_logs row with before/after snapshot, actor_ip, user_agent,
 *     request_id captured in details.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { recordAdminHqDecision } from "../_shared/admin-hq-audit.ts";


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
    let beforeSnapshot: unknown = null;
    let afterSnapshot: unknown = null;
    let targetType = "match";
    let targetId = "";
    let auditAction = `admin.manual_override.${parsed.operation}`;
    let operationResult: unknown = null;
    let govOrgId: string | null = null;
    let govMatchId: string | null = null;

    if (parsed.operation === "force_status" || parsed.operation === "void_match") {
      targetId = parsed.match_id;
      const { data: before, error: beforeErr } = await admin
        .from("matches")
        .select("id, state, status, org_id, counterparty_org_id, updated_at")
        .eq("id", targetId)
        .maybeSingle();
      if (beforeErr) {
        console.error(`[admin-manual-overrides][${requestId}] match lookup`, beforeErr);
        return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
      }
      if (!before) {
        return jsonResponse(req, { error: "MATCH_NOT_FOUND", requestId }, 404);
      }
      beforeSnapshot = before;
      govOrgId = before.org_id ?? null;
      govMatchId = targetId;
      const newState = parsed.operation === "void_match" ? "voided" : parsed.new_status;

      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "safe_transition_match_state",
        {
          p_match_id: targetId,
          p_org_id: before.org_id,
          p_expected_state: before.state ?? "discovery",
          p_new_state: newState,
          p_update_fields: { status: newState },
        },
      );
      if (rpcErr) {
        console.error(`[admin-manual-overrides][${requestId}] rpc`, rpcErr);
        return jsonResponse(req, { error: "TRANSITION_FAILED", message: rpcErr.message, requestId }, 422);
      }
      const ok = (rpcResult as { success?: boolean })?.success !== false;
      if (!ok) {
        return jsonResponse(req, {
          error: "TRANSITION_REJECTED",
          message: (rpcResult as { message?: string })?.message ?? "rejected",
          requestId,
        }, 422);
      }
      const { data: after } = await admin
        .from("matches")
        .select("id, state, status, org_id, counterparty_org_id, updated_at")
        .eq("id", targetId)
        .maybeSingle();
      afterSnapshot = after;
      operationResult = rpcResult;
    } else if (parsed.operation === "rerun_screening") {
      targetType = "entity";
      targetId = parsed.entity_id;
      const { data: entityBefore } = await admin
        .from("entities")
        .select("id, name, org_id, verification_status, jurisdiction, updated_at")
        .eq("id", targetId)
        .maybeSingle();
      beforeSnapshot = entityBefore;
      govOrgId = (entityBefore as { org_id?: string } | null)?.org_id ?? null;
      const { data, error: invokeErr } = await admin.functions.invoke("dilisense-screen", {
        body: { entity_id: targetId, force: true },
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
        .eq("id", targetId)
        .maybeSingle();
      afterSnapshot = entityAfter;
    } else {
      // regenerate_evidence
      targetId = parsed.match_id;
      const { data: matchBefore } = await admin
        .from("matches")
        .select("id, state, status, org_id, updated_at")
        .eq("id", targetId)
        .maybeSingle();
      beforeSnapshot = matchBefore;
      govOrgId = (matchBefore as { org_id?: string } | null)?.org_id ?? null;
      govMatchId = targetId;
      const { data, error: invokeErr } = await admin.functions.invoke("evidence-pack", {
        body: { match_id: targetId, force_regenerate: true },
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
      afterSnapshot = matchBefore; // evidence pack regen does not mutate match row
    }

    // Server-authored audit row.
    await admin.from("admin_audit_logs").insert({
      admin_user_id: caller.id,
      action: auditAction,
      target_type: targetType,
      target_id: targetId,
      details: {
        operation: parsed.operation,
        reason: (parsed as { reason: string }).reason,
        before: beforeSnapshot,
        after: afterSnapshot,
        actor_ip: actorIp,
        request_id: requestId,
        source: "admin-manual-overrides",
        ...(parsed.operation === "force_status"
          ? { requested_status: parsed.new_status }
          : {}),
      },
      user_agent: userAgent,
    });

    return jsonResponse(req, {
      ok: true,
      operation: parsed.operation,
      result: operationResult,
      requestId,
    }, 200);
  } catch (err) {
    console.error(`[admin-manual-overrides][${requestId}] unhandled`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
