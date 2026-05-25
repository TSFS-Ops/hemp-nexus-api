/**
 * Batch Q — admin-match-corrections
 *
 * AAL2 + idempotency + is_admin envelope around three audited RPCs:
 *   • correct_jurisdiction -> admin_correct_match_jurisdiction
 *   • relink_counterparty  -> admin_relink_match_counterparty
 *   • archive_duplicate    -> admin_archive_duplicate_match
 *
 * Side-swap is deliberately NOT exposed here — the matches_role_invariant
 * trigger remains the only authority on buyer/seller side assignment.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { recordAdminHqDecision } from "../_shared/admin-hq-audit.ts";


const ENDPOINT = "POST /admin-match-corrections";

const BodySchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("correct_jurisdiction"),
    match_id: z.string().uuid(),
    origin_country: z.string().trim().min(2).max(80),
    destination_country: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({
    operation: z.literal("relink_counterparty"),
    match_id: z.string().uuid(),
    side: z.enum(["buyer", "seller"]),
    new_org_id: z.string().uuid().nullable(),
    reason: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({
    operation: z.literal("archive_duplicate"),
    match_id: z.string().uuid(),
    duplicate_of_match_id: z.string().uuid(),
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
        action: "admin.match_corrections",
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
    if (parsed.operation === "correct_jurisdiction") {
      const { data, error } = await admin.rpc("admin_correct_match_jurisdiction", {
        p_match_id: parsed.match_id,
        p_origin_country: parsed.origin_country,
        p_destination_country: parsed.destination_country,
        p_reason: parsed.reason,
        p_admin_user_id: caller.id,
      });
      rpcResult = data; rpcError = error;
    } else if (parsed.operation === "relink_counterparty") {
      const { data, error } = await admin.rpc("admin_relink_match_counterparty", {
        p_match_id: parsed.match_id,
        p_side: parsed.side,
        p_new_org_id: parsed.new_org_id,
        p_reason: parsed.reason,
        p_admin_user_id: caller.id,
      });
      rpcResult = data; rpcError = error;
    } else {
      const { data, error } = await admin.rpc("admin_archive_duplicate_match", {
        p_match_id: parsed.match_id,
        p_duplicate_of_match_id: parsed.duplicate_of_match_id,
        p_reason: parsed.reason,
        p_admin_user_id: caller.id,
      });
      rpcResult = data; rpcError = error;
    }

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      const map: Record<string, [string, number]> = {
        reason_required:                  ["REASON_REQUIRED", 400],
        not_admin:                        ["FORBIDDEN", 403],
        invalid_side:                     ["VALIDATION_ERROR", 400],
        match_not_found:                  ["MATCH_NOT_FOUND", 404],
        org_not_found:                    ["ORG_NOT_FOUND", 404],
        primary_match_not_found:          ["PRIMARY_MATCH_NOT_FOUND", 404],
        cannot_archive_self_as_duplicate: ["CANNOT_ARCHIVE_SELF_AS_DUPLICATE", 400],
      };
      for (const [needle, [code, status]] of Object.entries(map)) {
        if (msg.includes(needle)) return jsonResponse(req, { error: code, requestId }, status);
      }
      console.error(`[admin-match-corrections][${requestId}]`, rpcError);
      return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
    }

    // Resolve org_id for governance proof. All ops carry a primary match_id.
    const { data: matchRow } = await admin
      .from("matches")
      .select("id, org_id")
      .eq("id", parsed.match_id)
      .maybeSingle();
    const matchOrgId = (matchRow as { org_id?: string } | null)?.org_id
      ?? "00000000-0000-0000-0000-000000000000";
    const actionCode = parsed.operation === "correct_jurisdiction"
      ? "match.correct.jurisdiction"
      : parsed.operation === "relink_counterparty"
        ? "match.correct.relink_counterparty"
        : "match.correct.archive_duplicate";
    try {
      await recordAdminHqDecision({
        admin, sourceFunction: "admin-match-corrections",
        actionCode,
        actorUserId: caller.id, actorRole: "platform_admin",
        orgId: matchOrgId,
        aggregateId: parsed.match_id,
        aggregateType: "match",
        matchId: parsed.match_id,
        reason: parsed.reason,
        requestId, aal: "aal2",
        extra: parsed.operation === "correct_jurisdiction"
          ? { origin_country: parsed.origin_country, destination_country: parsed.destination_country }
          : parsed.operation === "relink_counterparty"
            ? { side: parsed.side, new_org_id: parsed.new_org_id }
            : { duplicate_of_match_id: parsed.duplicate_of_match_id },
      });
    } catch (govErr) {
      console.error(`[admin-match-corrections][${requestId}] CRITICAL: gov audit failed:`, govErr);
      return jsonResponse(req, { error: "gov_audit_write_failed", code: "GOV_AUDIT_WRITE_FAILED", requestId }, 500);
    }

    return jsonResponse(req, { ok: true, result: rpcResult, requestId }, 200);
  } catch (err) {
    console.error(`[admin-match-corrections][${requestId}] unhandled:`, err);
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
