// Batch 17 — registry-operations-summary
// Aggregates safe counts/severity/oldest age for the operations cockpit.
// Read-only. Emits: registry_operations_summary_viewed.
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { requireOpsAdmin } from "../_shared/registry-operations-auth.ts";

type Tile = {
  code: string;
  count: number;
  severity: "low" | "medium" | "high" | "critical";
  oldest_age_hours: number | null;
  href: string;
};

async function countSafe(
  svc: any,
  table: string,
  filters: Record<string, unknown> = {},
  oldestColumn = "created_at",
): Promise<{ count: number; oldest: string | null }> {
  try {
    let q = svc.from(table).select("id," + oldestColumn, { count: "exact" }).order(oldestColumn, { ascending: true }).limit(1);
    for (const [k, v] of Object.entries(filters)) {
      if (Array.isArray(v)) q = q.in(k, v);
      else q = q.eq(k, v);
    }
    const { data, count, error } = await q;
    if (error) return { count: 0, oldest: null };
    return { count: count ?? 0, oldest: (data?.[0]?.[oldestColumn] as string) ?? null };
  } catch {
    return { count: 0, oldest: null };
  }
}

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 3_600_000));
}

function severityForAge(age: number | null, mediumAt: number, highAt: number): Tile["severity"] {
  if (age == null) return "low";
  if (age >= highAt) return "critical";
  if (age >= highAt * 0.75) return "high";
  if (age >= mediumAt) return "medium";
  return "low";
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const auth = await requireOpsAdmin(req);
    if (!auth.ok) return auth.response;
    const { svc, user } = auth;

    const [
      importsPending,
      importValidation,
      importQuarantine,
      duplicateCandidates,
      claimsPending,
      authorityPending,
      bankDetailsPending,
      bankVerificationPending,
      correctionsPending,
      disputesPending,
      revocationsPending,
      apiClientsPendingApproval,
      apiBlockedRequests,
      readinessBlockers,
    ] = await Promise.all([
      countSafe(svc, "registry_import_batches", { status: "submitted" }),
      countSafe(svc, "registry_import_record_validation_results", { status: "failed" }),
      countSafe(svc, "registry_import_quarantine", { status: "open" }),
      countSafe(svc, "registry_import_duplicate_candidates", { status: "open" }),
      countSafe(svc, "registry_company_claims", { status: "claim_submitted" }),
      countSafe(svc, "registry_authority_requests", { status: "submitted" }),
      countSafe(svc, "registry_bank_detail_submissions", { status: "captured_unverified" }),
      countSafe(svc, "registry_bank_detail_verification_requests", { status: "pending" }),
      countSafe(svc, "registry_company_correction_requests", { status: "submitted" }),
      countSafe(svc, "registry_authority_disputes", { status: "open" }),
      countSafe(svc, "registry_bank_detail_submissions", { status: "revocation_requested" }),
      countSafe(svc, "registry_api_clients", { lifecycle_state: "production_pending_approval" }),
      countSafe(svc, "registry_api_blocked_events"),
      countSafe(svc, "registry_readiness_states", { state: "shell_ready" }),
    ]);

    const tile = (code: string, base: { count: number; oldest: string | null }, href: string, mediumAt = 24, highAt = 72): Tile => {
      const age = ageHours(base.oldest);
      return { code, count: base.count, oldest_age_hours: age, severity: severityForAge(age, mediumAt, highAt), href };
    };

    const tiles: Tile[] = [
      tile("imports_pending", importsPending, "/admin/registry/imports"),
      tile("import_validation_failures", importValidation, "/admin/registry/imports"),
      tile("import_quarantine", importQuarantine, "/admin/registry/imports"),
      tile("duplicate_candidates", duplicateCandidates, "/admin/registry/imports"),
      tile("claims_pending", claimsPending, "/admin/registry/claims-review", 24, 48),
      tile("authority_pending", authorityPending, "/admin/registry/authority-review", 24, 48),
      tile("bank_details_pending", bankDetailsPending, "/admin/registry/bank-detail-review", 12, 24),
      tile("bank_verification_pending", bankVerificationPending, "/admin/registry/bank-verification-review", 12, 24),
      tile("corrections_pending", correctionsPending, "/admin/registry/correction-requests"),
      tile("disputes_pending", disputesPending, "/admin/registry/operations", 24, 48),
      tile("revocations_pending", revocationsPending, "/admin/registry/bank-details", 12, 24),
      tile("api_clients_pending_approval", apiClientsPendingApproval, "/admin/registry/api-clients", 48, 120),
      tile("api_blocked_requests", apiBlockedRequests, "/admin/registry/api-usage", 24, 72),
      tile("api_rate_limit_breaches", { count: 0, oldest: null }, "/admin/registry/api-usage"),
      tile("verification_expired", { count: 0, oldest: null }, "/admin/registry/bank-verification-review"),
      tile("verification_approaching_expiry", { count: 0, oldest: null }, "/admin/registry/bank-verification-review"),
      tile("sla_breached", { count: 0, oldest: null }, "/admin/registry/operations/slas"),
      tile("sla_approaching", { count: 0, oldest: null }, "/admin/registry/operations/slas"),
      tile("readiness_blockers", readinessBlockers, "/admin/registry/operations/readiness"),
      tile("high_risk_records", { count: 0, oldest: null }, "/admin/registry/operations/risk"),
      tile("recent_audit_activity", { count: 0, oldest: null }, "/admin/registry/operations/audit"),
    ];

    await svc.from("event_store").insert({
      event_name: "registry_operations_summary_viewed",
      aggregate_id: null,
      aggregate_type: "registry_operations",
      actor_id: user.id,
      payload: { tile_count: tiles.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ generated_at: new Date().toISOString(), tiles }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("registry-operations-summary error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    }));
  }
});
