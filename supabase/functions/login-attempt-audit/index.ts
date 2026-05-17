/**
 * login-attempt-audit
 * ───────────────────
 * Records a client-reported login attempt to admin_audit_logs in the
 * same structured envelope used by mutating admin endpoints.
 *
 * Why an edge function and not a DB trigger? Supabase GoTrue's
 * /token?grant_type=password endpoint is the auth provider; we cannot
 * attach a SECURITY DEFINER trigger to it. The client knows the
 * outcome (success / invalid_credentials / mfa_required / locked /
 * unconfirmed) immediately after sign-in resolves and posts it here.
 *
 * Caveats (recorded explicitly in the audit row):
 *   • `source: "client"` — these rows are client-reported, not
 *     server-attested. They complement Supabase's own auth_logs
 *     (which capture IP + path + HTTP status server-side).
 *   • On success we re-verify the supplied Bearer token via
 *     auth.getUser; mismatched / invalid tokens are recorded as
 *     "denied" with reason "INVALID_TOKEN" so a forged outcome=success
 *     cannot smuggle an unauthenticated row in.
 *   • On failure we accept the body unauthenticated but cap the
 *     email field length and never echo passwords.
 *
 * Contract:
 *   POST /login-attempt-audit
 *   Body: {
 *     outcome: "success" | "invalid_credentials" | "mfa_required"
 *              | "locked" | "unconfirmed" | "other",
 *     email?: string,           // attempted email (lowercased, max 320)
 *     reason?: string,          // optional client-supplied detail (max 200)
 *     request_id?: string       // optional UUID; generated if missing
 *   }
 *   Auth: Authorization: Bearer <JWT> required ONLY when outcome === "success".
 *
 *   200 OK { ok: true, request_id }
 *   400      { ok: false, code: "INVALID_BODY" }
 *   401      { ok: false, code: "UNAUTHENTICATED" }  // outcome=success with bad token
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { readAal } from "../_shared/aal.ts";
import {
  writeAdminAudit,
  extractIp,
  extractUserAgent,
} from "../_shared/admin-audit.ts";

const ENDPOINT = "POST /login-attempt-audit";
const ACTION = "auth.login_attempt";

const BodySchema = z.object({
  outcome: z.enum([
    "success",
    "invalid_credentials",
    "mfa_required",
    "locked",
    "unconfirmed",
    "other",
  ]),
  email: z.string().trim().max(320).optional(),
  reason: z.string().trim().max(200).optional(),
  request_id: z.string().uuid().optional(),
}).strict();

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "POST") {
    return withCors(req, new Response(
      JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    ));
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const r = BodySchema.safeParse(raw);
    if (!r.success) {
      return withCors(req, new Response(
        JSON.stringify({ ok: false, code: "INVALID_BODY", issues: r.error.flatten() }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ));
    }
    parsed = r.data;
  } catch {
    return withCors(req, new Response(
      JSON.stringify({ ok: false, code: "INVALID_BODY" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
  }

  const requestId = parsed.request_id ?? crypto.randomUUID();
  const ip = extractIp(req);
  const userAgent = extractUserAgent(req);
  const emailLower = parsed.email?.toLowerCase() ?? null;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // For outcome=success we require a valid Bearer token and bind the
  // audit row to the verified user id + observed AAL. This prevents a
  // hostile client from emitting fake "success" rows for other users.
  let actorUserId: string | null = null;
  let observedAal: "aal1" | "aal2" | "unknown" | null = null;

  if (parsed.outcome === "success") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return withCors(req, new Response(
        JSON.stringify({ ok: false, code: "UNAUTHENTICATED" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ));
    }
    const { data, error } = await admin.auth.getUser(
      authHeader.replace(/^Bearer\s+/i, ""),
    );
    if (error || !data?.user) {
      // Record the attempted forgery as a denied row, then 401.
      await writeAdminAudit({
        admin,
        action: ACTION,
        status: "denied",
        targetType: "auth_user",
        requestId,
        endpoint: ENDPOINT,
        ipAddress: ip,
        userAgent,
        reason: "INVALID_TOKEN",
        aal: { required: false, observed: readAal(authHeader), outcome: "not_evaluated" },
        extra: {
          claimed_outcome: parsed.outcome,
          email: emailLower,
          source: "client",
        },
      });
      return withCors(req, new Response(
        JSON.stringify({ ok: false, code: "UNAUTHENTICATED" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ));
    }
    actorUserId = data.user.id;
    observedAal = readAal(authHeader);
  }

  const isSuccess = parsed.outcome === "success";
  const status: "success" | "denied" | "info" =
    isSuccess ? "success"
    : parsed.outcome === "mfa_required" ? "info"
    : "denied";

  await writeAdminAudit({
    admin,
    action: ACTION,
    status,
    actorUserId,
    targetType: "auth_user",
    targetId: actorUserId,
    requestId,
    endpoint: ENDPOINT,
    ipAddress: ip,
    userAgent,
    reason: isSuccess ? undefined : parsed.outcome,
    aal: {
      required: false,
      observed: observedAal,
      outcome: isSuccess ? "satisfied" : "not_evaluated",
    },
    extra: {
      outcome: parsed.outcome,
      email: emailLower,
      detail: parsed.reason ?? null,
      source: "client",
    },
  });

  return withCors(req, new Response(
    JSON.stringify({ ok: true, request_id: requestId }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
});
