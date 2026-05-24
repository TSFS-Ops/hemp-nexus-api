// COMP-002 / COMP-012 — Admin release of an active compliance hold.
// Requires platform_admin + AAL2 + mandatory reason (≥20 chars).
// Emits canonical release audit; updates linked verification-queue rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  COMP_002_SANCTIONS_HOLD_RELEASED,
  COMP_012_VERIFICATION_HOLD_RELEASED,
} from "../_shared/comp-002-012-audit.ts";

const MIN_REASON_LENGTH = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z
  .object({
    hold_id: z.string().uuid(),
    reason: z.string().trim().min(MIN_REASON_LENGTH).max(2000),
  })
  .strict();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isSanctions(holdType: string): boolean {
  return (
    holdType.startsWith("sanctions_") ||
    holdType.startsWith("compliance_hold_sanctions_")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
  const admin_user = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: admin_user.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);

  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: admin_user.id,
      action: "admin-compliance-hold-release",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    const reasonBad = !!issues.reason?.length;
    return json(
      {
        error: reasonBad ? "reason_required" : "invalid_body",
        code: reasonBad ? "REASON_REQUIRED" : "INVALID_BODY",
        details: issues,
      },
      400,
    );
  }
  const { hold_id, reason } = parsed.data;

  const { data: hold, error: loadErr } = await admin
    .from("compliance_holds")
    .select("id, org_id, entity_id, hold_type, status")
    .eq("id", hold_id)
    .maybeSingle();
  if (loadErr || !hold) return json({ error: "not_found" }, 404);
  if (hold.status !== "active") {
    return json({ error: "not_active", code: "HOLD_NOT_ACTIVE" }, 409);
  }

  const { error: updErr } = await admin
    .from("compliance_holds")
    .update({
      status: "released",
      released_at: new Date().toISOString(),
      released_by: admin_user.id,
      release_reason: reason,
    })
    .eq("id", hold_id)
    .eq("status", "active");
  if (updErr) {
    console.error("[admin-compliance-hold-release] update error", updErr);
    return json({ error: "release_failed" }, 500);
  }

  // Best-effort: close linked verification queue items.
  await admin
    .from("operator_verification_requests")
    .update({
      status: "completed",
      outcome: "verified",
      reviewer_notes: `Released by platform admin: ${reason}`,
      completed_at: new Date().toISOString(),
      assigned_to: admin_user.id,
    })
    .eq("compliance_hold_id", hold_id)
    .in("status", ["pending", "in_progress"]);

  const auditAction = isSanctions(hold.hold_type)
    ? COMP_002_SANCTIONS_HOLD_RELEASED
    : COMP_012_VERIFICATION_HOLD_RELEASED;

  await admin.from("audit_logs").insert({
    org_id: hold.org_id,
    entity_type: "compliance_hold",
    entity_id: hold_id,
    action: auditAction,
    metadata: {
      hold_type: hold.hold_type,
      released_by: admin_user.id,
      reason,
      source_function: "admin-compliance-hold-release",
      timestamp: new Date().toISOString(),
    },
  });

  return json({ ok: true, hold_id, status: "released" }, 200);
});
