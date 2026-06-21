/**
 * registry-record-stale-review
 * ----------------------------
 * Batch 10 — Start/complete a stale-data review and recompute
 * is_stale / next_review_due_at using SSOT defaults.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import {
  REGISTRY_LIFECYCLE_APPROVAL_ROLES,
  REGISTRY_STALE_DEFAULTS_DAYS,
} from "../_shared/registry-record-lifecycle.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || '';
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
    const { record_id, action, outcome, notes } = body as {
      record_id?: string;
      action?: "start" | "complete" | "recompute";
      outcome?: string;
      notes?: string;
    };
    if (!record_id || !action) throw new ApiException("INVALID_INPUT", "record_id and action required", 400);

    const { data: rec } = await supabase
      .from("registry_company_records")
      .select("id, claim_activation_state")
      .eq("id", record_id)
      .maybeSingle();
    if (!rec) throw new ApiException("NOT_FOUND", "record not found", 404);

    if (action === "start") {
      await supabase.from("registry_record_stale_reviews").insert({
        record_id,
        status: "started",
        owner_role: auth.roles?.[0] ?? null,
      });
      await supabase.from("audit_logs").insert({
        action: "registry_record_stale_review_started",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id },
      });
    } else if (action === "complete") {
      await supabase
        .from("registry_record_stale_reviews")
        .update({ status: "completed", outcome: outcome ?? "reviewed", notes, completed_at: new Date().toISOString() })
        .eq("record_id", record_id)
        .eq("status", "started");
      await supabase.from("registry_company_records").update({
        is_stale: false,
        last_reviewed_at: new Date().toISOString(),
      }).eq("id", record_id);
      await supabase.from("audit_logs").insert({
        action: "registry_record_stale_review_completed",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id, outcome },
      });
    } else if (action === "recompute") {
      const days =
        rec.claim_activation_state === "claim_enabled"
          ? REGISTRY_STALE_DEFAULTS_DAYS.with_active_claim
          : REGISTRY_STALE_DEFAULTS_DAYS.imported_unverified;
      const nextDue = new Date(Date.now() + days * 86400 * 1000).toISOString();
      await supabase.from("registry_company_records").update({
        next_review_due_at: nextDue,
        stale_after_at: nextDue,
      }).eq("id", record_id);
      await supabase.from("audit_logs").insert({
        action: "registry_record_marked_stale",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id, next_review_due_at: nextDue },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, requestId }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] registry-record-stale-review error`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
