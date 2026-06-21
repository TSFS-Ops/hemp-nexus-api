/**
 * registry-claim-activation-review
 * --------------------------------
 * Batch 10 — Records an admin/compliance decision on claim activation.
 * Does not itself transition lifecycle; that's handled by
 * registry-record-lifecycle-manage. This is the reviewable audit record.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { REGISTRY_LIFECYCLE_APPROVAL_ROLES } from "../_shared/registry-record-lifecycle.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const headers = corsHeaders(allowed, req.headers.get("origin"));
  try {
    const cors = handleCors(req, allowed);
    if (cors) return cors;
    if (req.method !== "POST") throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, svc);

    const auth = await authenticateRequest(req, url, svc);
    if (auth.isApiKey) throw new ApiException("FORBIDDEN", "API keys cannot review", 403);
    const isApprover = REGISTRY_LIFECYCLE_APPROVAL_ROLES.some((r) => auth.roles?.includes(r));
    if (!isApprover) throw new ApiException("FORBIDDEN", "Requires platform_admin or compliance_owner", 403);

    const body = await req.json().catch(() => ({}));
    const { record_id, decision, reason, blocker_snapshot } = body as {
      record_id?: string;
      decision?: "approved" | "rejected" | "suspended" | "reenabled";
      reason?: string;
      blocker_snapshot?: unknown;
    };
    if (!record_id || !decision || !reason || reason.trim().length < 10) {
      throw new ApiException("INVALID_INPUT", "record_id, decision and reason (>=10 chars) required", 400);
    }

    await supabase.from("registry_claim_activation_reviews").insert({
      record_id,
      decision,
      reason,
      blocker_snapshot: blocker_snapshot ?? null,
      reviewer_user_id: auth.userId,
      reviewer_role: auth.roles?.[0] ?? null,
    });

    const auditAction =
      decision === "approved" ? "registry_claim_activation_approved" :
      decision === "rejected" ? "registry_claim_activation_rejected" :
      decision === "suspended" ? "registry_claim_activation_suspended" :
      "registry_claim_activation_reenabled";

    await supabase.from("audit_logs").insert({
      action: auditAction,
      actor_user_id: auth.userId,
      metadata: { request_id: requestId, record_id, reason },
    });

    return new Response(
      JSON.stringify({ ok: true, decision, requestId }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] registry-claim-activation-review error`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
