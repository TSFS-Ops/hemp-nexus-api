// Batch 17 — registry-operations-queue
// Unified safe work-item queue. Read-only aggregation across accepted Batch
// 1-16 tables. NEVER returns raw bank details, full API keys, or provider
// payloads. Emits: registry_operations_queue_viewed.
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { requireOpsAdmin } from "../_shared/registry-operations-auth.ts";
import { computeSlaState, ageHoursFrom } from "../_shared/registry-operations-centre.ts";

interface WorkItem {
  id: string;
  work_item_type: string;
  source_module: string;
  company_name: string | null;
  country: string | null;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  assigned_to: string | null;
  sla_state: string;
  age_hours: number;
  next_action: string;
  safe_reason: string;
  link: string;
  audit_reference: string | null;
  created_at: string;
}

function sev(ageH: number, sla: string): WorkItem["severity"] {
  if (sla === "sla_breached") return "critical";
  if (sla === "approaching_sla") return "high";
  if (ageH > 48) return "medium";
  return "low";
}

function rowsToItems(
  rows: any[],
  type: string,
  module: string,
  link: (r: any) => string,
  status: string,
  nextAction: string,
  reason: string,
  companyKey = "company_name",
  countryKey = "country_code",
): WorkItem[] {
  return (rows ?? []).map((r) => {
    const age = ageHoursFrom(r.created_at);
    const sla = computeSlaState(type, age);
    return {
      id: `${type}:${r.id}`,
      work_item_type: type,
      source_module: module,
      company_name: (r[companyKey] as string) ?? r.company_name ?? null,
      country: (r[countryKey] as string) ?? r.country_code ?? r.jurisdiction ?? null,
      severity: sev(age, sla),
      status,
      assigned_to: r.assigned_to ?? null,
      sla_state: sla,
      age_hours: Math.round(age),
      next_action: nextAction,
      safe_reason: reason,
      link: link(r),
      audit_reference: r.id,
      created_at: r.created_at,
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

    const url = new URL(req.url);
    const filterType = url.searchParams.get("type") ?? null;
    const filterSla = url.searchParams.get("sla") ?? null;
    const filterSeverity = url.searchParams.get("severity") ?? null;
    const filterModule = url.searchParams.get("module") ?? null;
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
    const cursor = url.searchParams.get("cursor"); // ISO created_at

    // Fetch safe shallow lists; explicit minimal columns.
    const baseLimit = 100;
    const ord = (q: any) => q.order("created_at", { ascending: false }).limit(baseLimit);

    const [
      claims,
      authority,
      bankDetails,
      bankVerification,
      corrections,
      disputes,
      apiClients,
      apiBlocked,
      importBatches,
      readinessShell,
    ] = await Promise.all([
      ord(svc.from("registry_company_claims").select("id,created_at,status,company_record_id").eq("status", "claim_submitted")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_authority_requests").select("id,created_at,status,company_record_id").eq("status", "submitted")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_bank_detail_submissions").select("id,created_at,status,company_record_id").eq("status", "captured_unverified")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_bank_detail_verification_requests").select("id,created_at,status,submission_id").eq("status", "pending")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_company_correction_requests").select("id,created_at,status,company_record_id").eq("status", "submitted")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_authority_disputes").select("id,created_at,status").eq("status", "open")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_api_clients").select("id,created_at,name,lifecycle_state").eq("lifecycle_state", "production_pending_approval")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_api_blocked_events").select("id,created_at,reason_code,client_id")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_import_batches").select("id,created_at,status,country_code").eq("status", "submitted")).then((r: any) => r.data ?? []),
      ord(svc.from("registry_readiness_states").select("id,created_at,state,module_code").eq("state", "shell_ready")).then((r: any) => r.data ?? []),
    ]);

    const items: WorkItem[] = [
      ...rowsToItems(claims, "claim_review", "claims", (r) => `/admin/registry/claims-review?focus=${r.id}`, "claim_submitted", "Review claim evidence and decide.", "Claim awaiting admin/compliance review."),
      ...rowsToItems(authority, "authority_review", "authority", (r) => `/admin/registry/authority-review?focus=${r.id}`, "submitted", "Review authority-to-act and decide.", "Authority request awaiting review."),
      ...rowsToItems(bankDetails, "bank_detail_review", "bank_details", (r) => `/admin/registry/bank-detail-review?focus=${r.id}`, "captured_unverified", "Review submission and decide capture.", "Bank-detail submission awaiting review."),
      ...rowsToItems(bankVerification, "bank_verification_review", "bank_verification", (r) => `/admin/registry/bank-verification-review?focus=${r.id}`, "pending", "Review verification request and decide.", "Bank-verification request awaiting review."),
      ...rowsToItems(corrections, "correction_request", "corrections", (r) => `/admin/registry/correction-requests?focus=${r.id}`, "submitted", "Review correction request.", "Correction request awaiting review."),
      ...rowsToItems(disputes, "dispute_review", "disputes", () => `/admin/registry/operations`, "open", "Review dispute.", "Dispute awaiting review."),
      ...rowsToItems(apiClients, "api_client_approval", "api", (r) => `/admin/registry/api-clients/${r.id}`, "production_pending_approval", "Review API client production approval.", "API client awaiting production approval.", "name"),
      ...rowsToItems(apiBlocked, "api_blocked_request_review", "api", () => `/admin/registry/api-usage`, "blocked", "Review blocked API request.", "Blocked institutional API request."),
      ...rowsToItems(importBatches, "import_batch_review", "imports", (r) => `/admin/registry/imports?focus=${r.id}`, "submitted", "Review import batch.", "Import batch awaiting review."),
      ...rowsToItems(readinessShell, "readiness_blocker", "readiness", (r) => `/admin/registry/readiness?module=${r.module_code ?? ""}`, "shell_ready", "Promote module readiness when gates allow.", "Module is shell-only and is not a record of truth.", "module_code"),
    ];

    // Filters
    const filtered = items.filter((it) => {
      if (filterType && it.work_item_type !== filterType) return false;
      if (filterSla && it.sla_state !== filterSla) return false;
      if (filterSeverity && it.severity !== filterSeverity) return false;
      if (filterModule && it.source_module !== filterModule) return false;
      if (search) {
        const hay = `${it.company_name ?? ""} ${it.audit_reference ?? ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (cursor && it.created_at >= cursor) return false;
      return true;
    });
    filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id.localeCompare(b.id)));

    const page = filtered.slice(0, limit);
    const nextCursor = page.length === limit ? page[page.length - 1].created_at : null;

    await svc.from("event_store").insert({
      event_name: "registry_operations_queue_viewed",
      aggregate_id: null,
      aggregate_type: "registry_operations",
      actor_id: user.id,
      payload: { returned: page.length, filter_type: filterType, filter_sla: filterSla },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({
      items: page,
      next_cursor: nextCursor,
      total_in_window: filtered.length,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-operations-queue error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    }));
  }
});
