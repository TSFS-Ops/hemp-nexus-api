/**
 * registry-record-lifecycle-summary
 * ---------------------------------
 * Batch 10 — Admin/compliance read-only summary of lifecycle counts:
 * how many records are in each lifecycle_state, how many are stale,
 * how many are blocked from claim activation, etc.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import {
  REGISTRY_LIFECYCLE_APPROVAL_ROLES,
  REGISTRY_RECORD_LIFECYCLE_STATES,
} from "../_shared/registry-record-lifecycle.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const headers = corsHeaders(allowed, req.headers.get("origin"));
  try {
    const cors = handleCors(req, allowed);
    if (cors) return cors;
    if (req.method !== "GET" && req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, svc);

    const auth = await authenticateRequest(req, url, svc);
    if (auth.isApiKey) throw new ApiException("FORBIDDEN", "API keys cannot summarise", 403);
    const ok = REGISTRY_LIFECYCLE_APPROVAL_ROLES.some((r) => auth.roles?.includes(r));
    if (!ok) throw new ApiException("FORBIDDEN", "Requires platform_admin or compliance_owner", 403);

    const counts: Record<string, number> = {};
    for (const state of REGISTRY_RECORD_LIFECYCLE_STATES) {
      const { count } = await supabase
        .from("registry_company_records")
        .select("id", { head: true, count: "exact" })
        .eq("lifecycle_state", state);
      counts[state] = count ?? 0;
    }
    const { count: staleCount } = await supabase
      .from("registry_company_records")
      .select("id", { head: true, count: "exact" })
      .eq("is_stale", true);

    await supabase.from("audit_logs").insert({
      action: "registry_record_lifecycle_checked",
      actor_user_id: auth.userId,
      metadata: { request_id: requestId, summary: true },
    });

    return new Response(
      JSON.stringify({ counts, stale_count: staleCount ?? 0, requestId }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] registry-record-lifecycle-summary error`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
