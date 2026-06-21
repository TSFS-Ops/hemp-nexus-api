// Batch 17 — registry-operations-risk
// Read-only safe risk view. Aggregates from existing Batch 1-16 tables.
// Never exposes raw bank fields, full API keys or provider payloads.
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { requireOpsAdmin } from "../_shared/registry-operations-auth.ts";
import { ageHoursFrom } from "../_shared/registry-operations-centre.ts";

interface RiskItem {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  module: string;
  company_name: string | null;
  country: string | null;
  safe_reason: string;
  created_at: string;
  status: string;
  owner: string | null;
  link: string;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const auth = await requireOpsAdmin(req);
    if (!auth.ok) return auth.response;
    const { svc, user } = auth;

    const [
      quarantined,
      duplicates,
      conflicts,
      disputes,
      bankRisk,
      apiBlocked,
      shellReady,
    ] = await Promise.all([
      svc.from("registry_import_quarantine").select("id,created_at,reason_code,status").eq("status", "open").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
      svc.from("registry_import_duplicate_candidates").select("id,created_at,status").eq("status", "open").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
      svc.from("registry_claim_conflicts").select("id,created_at,status").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
      svc.from("registry_authority_disputes").select("id,created_at,status").eq("status", "open").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
      svc.from("registry_bank_detail_risk_flags").select("id,created_at,severity,reason_code,resolved").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
      svc.from("registry_api_blocked_events").select("id,created_at,reason_code").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
      svc.from("registry_readiness_states").select("id,created_at,state,module_code").eq("state", "shell_ready").order("created_at", { ascending: false }).limit(50).then((r: any) => r.data ?? []),
    ]);

    const sev = (age: number): RiskItem["severity"] => (age >= 168 ? "critical" : age >= 72 ? "high" : age >= 24 ? "medium" : "low");
    const items: RiskItem[] = [
      ...quarantined.map((r: any) => ({ id: `quarantine:${r.id}`, category: "import_quality_risk", severity: sev(ageHoursFrom(r.created_at)), module: "imports", company_name: null, country: null, safe_reason: "Quarantined import record awaiting review.", created_at: r.created_at, status: r.status, owner: null, link: "/admin/registry/imports" })),
      ...duplicates.map((r: any) => ({ id: `dup:${r.id}`, category: "duplicate_matching_risk", severity: sev(ageHoursFrom(r.created_at)), module: "imports", company_name: null, country: null, safe_reason: "Possible duplicate company candidate.", created_at: r.created_at, status: r.status, owner: null, link: "/admin/registry/imports" })),
      ...conflicts.map((r: any) => ({ id: `conflict:${r.id}`, category: "claim_conflict_risk", severity: sev(ageHoursFrom(r.created_at)), module: "claims", company_name: null, country: null, safe_reason: "Conflicting claim on a company record.", created_at: r.created_at, status: r.status ?? "open", owner: null, link: "/admin/registry/claim-conflicts" })),
      ...disputes.map((r: any) => ({ id: `dispute:${r.id}`, category: "dispute_risk", severity: sev(ageHoursFrom(r.created_at)), module: "disputes", company_name: null, country: null, safe_reason: "Open dispute on registry record.", created_at: r.created_at, status: r.status, owner: null, link: "/admin/registry/operations" })),
      ...bankRisk.filter((r: any) => !r.resolved).map((r: any) => ({ id: `bankrisk:${r.id}`, category: "bank_detail_evidence_risk", severity: (r.severity ?? "medium") as any, module: "bank_details", company_name: null, country: null, safe_reason: "Bank-detail risk flag — review evidence in specialist page.", created_at: r.created_at, status: "open", owner: null, link: "/admin/registry/bank-detail-review" })),
      ...apiBlocked.map((r: any) => ({ id: `apiblock:${r.id}`, category: "api_misuse_risk", severity: sev(ageHoursFrom(r.created_at)), module: "api", company_name: null, country: null, safe_reason: `Blocked institutional API request (${r.reason_code ?? "policy"}).`, created_at: r.created_at, status: "blocked", owner: null, link: "/admin/registry/api-usage" })),
      ...shellReady.map((r: any) => ({ id: `readiness:${r.id}`, category: "readiness_risk", severity: "medium" as const, module: "readiness", company_name: null, country: null, safe_reason: "Module is shell-only — not a record of truth.", created_at: r.created_at, status: r.state, owner: null, link: `/admin/registry/readiness?module=${r.module_code ?? ""}` })),
    ];

    items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    await svc.from("event_store").insert({
      event_name: "registry_operations_risk_viewed",
      aggregate_id: null,
      aggregate_type: "registry_operations",
      actor_id: user.id,
      payload: { count: items.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ items }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("registry-operations-risk error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    }));
  }
});
