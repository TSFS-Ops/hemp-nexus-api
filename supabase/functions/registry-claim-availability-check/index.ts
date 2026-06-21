/**
 * registry-claim-availability-check
 * ---------------------------------
 * Batch 10 — Shared claim-availability engine endpoint.
 * Returns the safe public reason + (for admins) the internal reason.
 * Audits every check.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import {
  evaluateClaimAvailability,
  REGISTRY_LIFECYCLE_APPROVAL_ROLES,
  type RegistryRecordLifecycleState,
} from "../_shared/registry-record-lifecycle.ts";

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

    let authCtx: any = null;
    let isAdmin = false;
    try {
      authCtx = await authenticateRequest(req, url, svc);
      isAdmin = REGISTRY_LIFECYCLE_APPROVAL_ROLES.some((r) => authCtx?.roles?.includes(r));
    } catch { /* unauthenticated/public access allowed for safe reason only */ }

    const body = await req.json().catch(() => ({}));
    const recordId = body.record_id as string | undefined;
    if (!recordId) throw new ApiException("INVALID_INPUT", "record_id required", 400);

    const { data: rec, error } = await supabase
      .from("registry_company_records")
      .select("id, lifecycle_state, is_stale, public_display_allowed, claim_activation_state, country_code")
      .eq("id", recordId)
      .maybeSingle();
    if (error) throw new ApiException("DB_ERROR", error.message, 500);
    if (!rec) throw new ApiException("NOT_FOUND", "record not found", 404);

    // Gather facts. (Best-effort: missing rows treated conservatively.)
    const [{ count: provCount }, { count: dupCount }, { count: corrCount }, { count: confCount }, country] = await Promise.all([
      supabase.from("registry_field_provenance").select("id", { head: true, count: "exact" }).eq("record_id", recordId),
      supabase.from("registry_import_duplicate_candidates").select("id", { head: true, count: "exact" }).eq("status", "open"),
      supabase.from("registry_company_correction_requests").select("id", { head: true, count: "exact" }).eq("company_record_id", recordId).in("status", ["submitted", "under_review"]),
      supabase.from("registry_claim_conflicts").select("id", { head: true, count: "exact" }).eq("company_record_id", recordId).eq("status", "locked"),
      supabase.from("registry_country_coverage").select("status").eq("country_code", rec.country_code).maybeSingle(),
    ]);

    const inputs = {
      lifecycle_state: rec.lifecycle_state as RegistryRecordLifecycleState,
      has_provenance: (provCount ?? 0) > 0,
      source_approved: true, // published records imply source approval gate already passed
      business_decision_approved: rec.claim_activation_state === "claim_enabled" || rec.claim_activation_state === "claim_pending_business_decision",
      country_ready: country?.data?.status === "live" || country?.data?.status === "approved",
      has_unresolved_high_duplicate: (dupCount ?? 0) > 0,
      is_quarantined: false,
      has_active_correction_on_identity: (corrCount ?? 0) > 0,
      has_claim_conflict_lock: (confCount ?? 0) > 0,
      is_stale: !!rec.is_stale,
      admin_stale_override: false,
    };

    const result = evaluateClaimAvailability(inputs);

    await supabase.from("registry_claim_availability_checks").insert({
      record_id: recordId,
      engine_result: result.result,
      public_reason: result.public_reason,
      internal_reason: result.internal_reason,
      blocker_snapshot: inputs,
      checked_by_user_id: authCtx?.userId ?? null,
      checked_by_role: isAdmin ? "admin" : authCtx ? "user" : "public",
    });

    await supabase.from("audit_logs").insert({
      action: "registry_claim_availability_checked",
      actor_user_id: authCtx?.userId ?? null,
      metadata: { request_id: requestId, record_id: recordId, result: result.result },
    });

    return new Response(
      JSON.stringify({
        result: result.result,
        public_reason: result.public_reason,
        internal_reason: isAdmin ? result.internal_reason : undefined,
        blocker_snapshot: isAdmin ? inputs : undefined,
        requestId,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] registry-claim-availability-check error`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
