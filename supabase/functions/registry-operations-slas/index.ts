// Batch 17 — registry-operations-slas
// Read-only SLA view. Computes SLA state from accepted work-item created_at
// values. Pure view; never auto-approves anything.
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { requireOpsAdmin } from "../_shared/registry-operations-auth.ts";
import { computeSlaState, ageHoursFrom, REGISTRY_OPS_DEFAULT_SLA_HOURS } from "../_shared/registry-operations-centre.ts";

interface SlaItem {
  id: string;
  work_item_type: string;
  source_module: string;
  age_hours: number;
  sla_hours: number | null;
  sla_state: string;
  due_at: string | null;
  overdue_hours: number;
  created_at: string;
  link: string;
}

function toSla(rows: any[], type: string, module: string, link: (r: any) => string): SlaItem[] {
  const slaH = REGISTRY_OPS_DEFAULT_SLA_HOURS[type];
  return (rows ?? []).map((r) => {
    const age = ageHoursFrom(r.created_at);
    const state = computeSlaState(type, age);
    const due = slaH != null ? new Date(new Date(r.created_at).getTime() + slaH * 3_600_000).toISOString() : null;
    return {
      id: `${type}:${r.id}`,
      work_item_type: type,
      source_module: module,
      age_hours: Math.round(age),
      sla_hours: slaH,
      sla_state: state,
      due_at: due,
      overdue_hours: slaH != null && age > slaH ? Math.round(age - slaH) : 0,
      created_at: r.created_at,
      link: link(r),
    };
  });
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const auth = await requireOpsAdmin(req);
    if (!auth.ok) return auth.response;
    const { svc, user } = auth;

    const [claims, authority, bankD, bankV, corr, api] = await Promise.all([
      svc.from("registry_company_claims").select("id,created_at").eq("status", "claim_submitted").order("created_at", { ascending: true }).limit(100).then((r: any) => r.data ?? []),
      svc.from("registry_authority_requests").select("id,created_at").eq("status", "submitted").order("created_at", { ascending: true }).limit(100).then((r: any) => r.data ?? []),
      svc.from("registry_bank_detail_submissions").select("id,created_at").eq("status", "captured_unverified").order("created_at", { ascending: true }).limit(100).then((r: any) => r.data ?? []),
      svc.from("registry_bank_detail_verification_requests").select("id,created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(100).then((r: any) => r.data ?? []),
      svc.from("registry_company_correction_requests").select("id,created_at").eq("status", "submitted").order("created_at", { ascending: true }).limit(100).then((r: any) => r.data ?? []),
      svc.from("registry_api_clients").select("id,created_at").eq("lifecycle_state", "production_pending_approval").order("created_at", { ascending: true }).limit(100).then((r: any) => r.data ?? []),
    ]);

    const items: SlaItem[] = [
      ...toSla(claims, "claim_review", "claims", (r) => `/admin/registry/claims-review?focus=${r.id}`),
      ...toSla(authority, "authority_review", "authority", (r) => `/admin/registry/authority-review?focus=${r.id}`),
      ...toSla(bankD, "bank_detail_review", "bank_details", (r) => `/admin/registry/bank-detail-review?focus=${r.id}`),
      ...toSla(bankV, "bank_verification_review", "bank_verification", (r) => `/admin/registry/bank-verification-review?focus=${r.id}`),
      ...toSla(corr, "correction_request", "corrections", (r) => `/admin/registry/correction-requests?focus=${r.id}`),
      ...toSla(api, "api_client_approval", "api", (r) => `/admin/registry/api-clients/${r.id}`),
    ];

    items.sort((a, b) => {
      const order: Record<string, number> = { sla_breached: 0, approaching_sla: 1, blocked: 2, within_sla: 3, paused: 4, not_applicable: 5 };
      const oa = order[a.sla_state] ?? 9;
      const ob = order[b.sla_state] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.created_at < b.created_at ? -1 : 1;
    });

    await svc.from("event_store").insert({
      event_name: "registry_operations_slas_viewed",
      aggregate_id: null,
      aggregate_type: "registry_operations",
      actor_id: user.id,
      payload: { count: items.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ items }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("registry-operations-slas error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    }));
  }
});
