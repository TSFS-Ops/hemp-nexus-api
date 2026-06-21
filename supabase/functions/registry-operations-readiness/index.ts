// Batch 17 — registry-operations-readiness
// Safe readiness blockers view. Read-only.
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { requireOpsAdmin } from "../_shared/registry-operations-auth.ts";

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const auth = await requireOpsAdmin(req);
    if (!auth.ok) return auth.response;
    const { svc, user } = auth;

    const { data: readiness } = await svc
      .from("registry_readiness_states")
      .select("id,module_code,state,reason,updated_at,created_at,linked_business_decision_id")
      .neq("state", "production_ready")
      .order("updated_at", { ascending: false })
      .limit(200);

    const blockers = (readiness ?? []).map((r: any) => ({
      id: r.id,
      area: r.module_code ?? "registry",
      state: r.state,
      severity: r.state === "disabled" ? "critical" : r.state === "shell_ready" ? "high" : "medium",
      safe_reason: r.reason ?? "Readiness gate not yet promoted.",
      required_action: "Complete accepted readiness gate and record a business decision before promotion.",
      owner: null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      linked_business_decision_id: r.linked_business_decision_id ?? null,
      link: `/admin/registry/readiness?module=${r.module_code ?? ""}`,
    }));

    await svc.from("event_store").insert({
      event_name: "registry_operations_readiness_viewed",
      aggregate_id: null,
      aggregate_type: "registry_operations",
      actor_id: user.id,
      payload: { count: blockers.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ blockers }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("registry-operations-readiness error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    }));
  }
});
