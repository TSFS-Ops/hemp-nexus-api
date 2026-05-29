// DATA-010 Phase 2A — admin-export-request
//
// Records an admin client-data export request in `export_requests`
// with status='awaiting_approval'. Requires platform_admin + AAL2.
// Validates purpose + reason (≥10 chars). Never generates a file.
//
// Emits: data.admin_export_requested
// On block: data.admin_export_blocked_or_declined

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { EXPORT_PURPOSES, MIN_EXPORT_REASON_LENGTH } from "../_shared/export-purpose.ts";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";
import {
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";

const BodySchema = z.object({
  subject_user_id: z.string().uuid().nullable().optional().default(null),
  target_org_id: z.string().uuid().nullable().optional().default(null),
  purpose: z.enum(EXPORT_PURPOSES),
  reason: z.string().trim().min(MIN_EXPORT_REASON_LENGTH).max(500),
  requested_categories: z.array(z.string().min(1).max(64)).min(1).max(32),
  date_range: z
    .object({ from: z.string().optional(), to: z.string().optional() })
    .nullable()
    .optional()
    .default(null),
}).strict();

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const adminUser = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // platform_admin gate.
  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: adminUser.id });
  if (!isAdmin) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      { actor_user_id: adminUser.id, reason: "not_platform_admin" },
      null,
      null,
    );
    return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  }

  // AAL2 gate.
  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: adminUser.id,
      action: "admin-export-request",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      await writeLifecycleAudit(
        admin,
        DATA_010_AUDIT_ACTIONS.blocked_or_declined,
        { actor_user_id: adminUser.id, reason: "mfa_required" },
        null,
        null,
      );
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  // Validate body.
  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: adminUser.id,
        reason: "invalid_body",
        errors: parsed.error.flatten().fieldErrors,
      },
      null,
      null,
    );
    return json({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
  }
  const b = parsed.data;

  // Phase 2A: must be scoped — either subject_user_id OR target_org_id required.
  if (!b.subject_user_id && !b.target_org_id) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      { actor_user_id: adminUser.id, reason: "unscoped_admin_export_not_allowed" },
      null,
      null,
    );
    return json({ error: "unscoped_admin_export_not_allowed", code: "MUST_BE_SCOPED" }, 422);
  }

  const { data: requestId, error: rpcErr } = await admin.rpc("request_admin_export", {
    p_requester_user_id: adminUser.id,
    p_subject_user_id: b.subject_user_id,
    p_target_org_id: b.target_org_id,
    p_purpose: b.purpose,
    p_reason: b.reason,
    p_date_range: b.date_range,
    p_requested_categories: b.requested_categories,
  });
  if (rpcErr || !requestId) {
    console.error("[admin-export-request] rpc failed:", rpcErr);
    return json({ error: "request_create_failed" }, 500);
  }

  await writeLifecycleAudit(
    admin,
    DATA_010_AUDIT_ACTIONS.requested,
    {
      actor_user_id: adminUser.id,
      requested_by_admin_user_id: adminUser.id,
      request_id: requestId,
      subject_user_id: b.subject_user_id,
      target_org_id: b.target_org_id,
      purpose: b.purpose,
      reason: b.reason,
      requested_categories: b.requested_categories,
    },
    b.target_org_id,
    requestId,
  );

  return json({
    ok: true,
    request_id: requestId,
    status: "awaiting_approval",
    next_step: "A second platform admin must approve before this export can be generated.",
  });
});
