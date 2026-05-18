/**
 * MT-009 Phase 2 — match-named-contacts-assign
 *
 * Records a controlled named contact on one side of a match.
 * Two valid auth paths:
 *   1. Org-admin self-service — caller has `org_admin` role AND
 *      profiles.org_id matches the requested side's org. Normal AAL.
 *   2. Platform-admin override — caller is is_admin AND session is AAL2.
 *
 * Hard scope:
 *   - Body: { match_id, side, contact_name, contact_email, notes? } (.strict)
 *   - Requires Idempotency-Key header.
 *   - Calls SECURITY DEFINER RPC `assign_match_named_contact`.
 *   - NEVER sends email, invite, or notification. No imports from
 *     notification-dispatch / resend / send-team-invite / email-* modules.
 *   - NEVER creates auth.users rows.
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

const ENDPOINT = "POST /match-named-contacts-assign";
const ACTION = "match.named_contact_assigned";
const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000000";

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z
  .object({
    match_id: z.string().uuid(),
    side: z.enum(["buyer", "seller"]),
    contact_name: z.string().trim().min(2).max(120).regex(/^[^<>]+$/),
    contact_email: z.string().trim().email().max(254),
    notes: z.string().trim().max(500).optional(),
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

  // AAL state — only relevant for platform-admin path.
  let aalInfo: AdminAuditAal = { required: false, observed: null, outcome: "not_evaluated" };

  try {
    // 1. Idempotency-Key (mandatory).
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
      await writeAdminAudit({ ...auditBase, status: "denied", reason: "INVALID_TOKEN", aal: aalInfo });
      return jsonResponse(req, { error: "INVALID_TOKEN", requestId }, 401);
    }

    // 3. Strict body parse.
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
        reason: "VALIDATION_ERROR", aal: aalInfo, extra: { detail },
      });
      return jsonResponse(req, { error: "VALIDATION_ERROR", message: detail, requestId }, 400);
    }

    // 4. Resolve match + side org for authorization branching.
    const { data: matchRow, error: matchErr } = await admin
      .from("matches")
      .select("id, buyer_org_id, seller_org_id")
      .eq("id", parsedBody.match_id)
      .maybeSingle();
    if (matchErr || !matchRow) {
      await writeAdminAudit({
        ...auditBase, status: "denied", actorUserId: caller.id,
        targetId: parsedBody.match_id, reason: "MATCH_NOT_FOUND", aal: aalInfo,
      });
      return jsonResponse(req, { error: "MATCH_NOT_FOUND", requestId }, 404);
    }
    const sideOrgId =
      parsedBody.side === "buyer" ? matchRow.buyer_org_id : matchRow.seller_org_id;
    if (!sideOrgId) {
      await writeAdminAudit({
        ...auditBase, status: "denied", actorUserId: caller.id,
        targetId: parsedBody.match_id, reason: "SIDE_HAS_NO_ORG", aal: aalInfo,
      });
      return jsonResponse(req, { error: "SIDE_HAS_NO_ORG", requestId }, 422);
    }

    // 5. Authorise. Try org-admin own-org first, then platform-admin override.
    const [{ data: isOrgAdmin }, { data: isPlatformAdmin }, { data: profile }] = await Promise.all([
      admin.rpc("has_role", { _user_id: caller.id, _role: "org_admin" }),
      admin.rpc("is_admin", { user_id: caller.id }),
      admin.from("profiles").select("org_id").eq("id", caller.id).maybeSingle(),
    ]);

    let assignedByRole: "org_admin_self_service" | "platform_admin_override" | null = null;

    if (isOrgAdmin && profile?.org_id && profile.org_id === sideOrgId) {
      assignedByRole = "org_admin_self_service";
    } else if (isPlatformAdmin) {
      aalInfo = { required: true, observed: observedAal, outcome: "not_evaluated" };
      try {
        await assertAal2(authHeader, {
          adminClient: admin,
          callerUserId: caller.id,
          action: "admin.named_contact_override",
          context: { endpoint: ENDPOINT, request_id: requestId, match_id: parsedBody.match_id, side: parsedBody.side },
        });
      } catch (err) {
        if (err instanceof ApiException) {
          await writeAdminAudit({
            ...auditBase, status: "denied", actorUserId: caller.id,
            targetId: parsedBody.match_id, reason: err.code,
            aal: { required: true, observed: observedAal, outcome: "denied" },
          });
          return jsonResponse(req, {
            error: err.code, message: err.message, requestId,
            observed_aal: (err as any).details?.observed_aal,
          }, err.statusCode);
        }
        throw err;
      }
      aalInfo = { required: true, observed: observedAal, outcome: "satisfied" };
      assignedByRole = "platform_admin_override";
    } else {
      await writeAdminAudit({
        ...auditBase, status: "denied", actorUserId: caller.id,
        targetId: parsedBody.match_id, reason: "FORBIDDEN", aal: aalInfo,
      });
      return jsonResponse(req, { error: "FORBIDDEN", requestId }, 403);
    }

    // 6. Idempotency cache lookup (after auth so we don't leak replay status to unauth callers).
    const cached = await lookupIdempotentResponse({
      supabase: admin, orgId: sideOrgId, endpoint: ENDPOINT,
      idempotencyKey, required: true, requestId,
    });
    if (cached) {
      await writeAdminAudit({
        ...auditBase, status: "info", actorUserId: caller.id,
        targetId: parsedBody.match_id, reason: "IDEMPOTENT_REPLAY", aal: aalInfo,
      });
      return cachedResponseToHttp(cached, baseHeaders);
    }

    // 7. RPC call.
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "assign_match_named_contact",
      {
        p_match_id: parsedBody.match_id,
        p_side: parsedBody.side,
        p_contact_name: parsedBody.contact_name,
        p_contact_email: parsedBody.contact_email,
        p_assigned_by_user_id: caller.id,
        p_assigned_by_role: assignedByRole,
        p_notes: parsedBody.notes ?? null,
      },
    );

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase();
      const map: Record<string, { code: string; status: number; message: string }> = {
        match_not_found:  { code: "MATCH_NOT_FOUND",     status: 404, message: "Match not found." },
        side_has_no_org:  { code: "SIDE_HAS_NO_ORG",     status: 422, message: "Side has no organisation attached." },
        invalid_side:     { code: "VALIDATION_ERROR",    status: 400, message: "Invalid side." },
        invalid_assigned_by_role: { code: "VALIDATION_ERROR", status: 400, message: "Invalid role." },
        invalid_contact_name:  { code: "VALIDATION_ERROR", status: 400, message: "Invalid contact name." },
        invalid_contact_email: { code: "VALIDATION_ERROR", status: 400, message: "Invalid contact email." },
      };
      const matched = Object.entries(map).find(([k]) => msg.includes(k))?.[1];
      const resolved = matched ?? { code: "INTERNAL_ERROR", status: 500, message: "Internal error." };
      await writeAdminAudit({
        ...auditBase,
        status: resolved.code === "INTERNAL_ERROR" ? "error" : "denied",
        actorUserId: caller.id, targetId: parsedBody.match_id,
        reason: resolved.code, aal: aalInfo,
      });
      if (resolved.code === "INTERNAL_ERROR") {
        console.error(`[match-named-contacts-assign][${requestId}] rpc failed:`, rpcError);
      }
      return jsonResponse(req, { error: resolved.code, message: resolved.message, requestId }, resolved.status);
    }

    const responseBody = { ok: true, result: rpcResult, requestId };
    await storeIdempotentResponse(
      {
        supabase: admin, orgId: sideOrgId, endpoint: ENDPOINT,
        idempotencyKey, required: true, requestId,
      },
      { status: 200, body: responseBody },
    );

    // The RPC writes its own match_named_contact.* audit rows. This row
    // captures the edge-fn level success with auth context.
    await writeAdminAudit({
      ...auditBase, status: "success", actorUserId: caller.id,
      targetId: parsedBody.match_id, aal: aalInfo,
      extra: { assigned_by_role: assignedByRole, side: parsedBody.side },
    });

    return jsonResponse(req, responseBody, 200);
  } catch (err) {
    console.error(`[match-named-contacts-assign][${requestId}] unhandled:`, err);
    await writeAdminAudit({
      ...auditBase, status: "error", reason: "UNHANDLED", aal: aalInfo,
      extra: { message: (err as Error)?.message ?? String(err) },
    });
    return jsonResponse(req, { error: "INTERNAL_ERROR", requestId }, 500);
  }
});
