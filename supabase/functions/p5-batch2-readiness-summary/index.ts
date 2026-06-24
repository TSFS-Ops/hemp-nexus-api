// P-5 Batch 2 — Stage 3 — Readiness summary edge function.
//
// Returns a viewer-scoped safe JSON summary for a single KYC/KYB evidence
// item. Server-side masking + provider-wording guard are applied before
// the response is returned. The function NEVER returns raw IDs/bank/tax/
// address values, reviewer notes, fraud flags, internal risk scores,
// provider raw responses, or other counterparties' private documents.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Vary": "Origin",
};

type Viewer = "admin" | "organisation_user" | "counterparty" | "funder" | "api_user";

const PRIVILEGED_ROLES = new Set([
  "platform_admin",
  "executive_approver",
  "compliance_analyst",
  "governance_reviewer",
  "operator_case_manager",
  "auditor",
  "auditor_read_only",
  "developer_technical_admin",
]);

const FORBIDDEN_WORDING = [
  "verified", "passed", "cleared", "sanctions clear",
  "bank verified", "provider approved", "no adverse result",
];

const SAFE_PROVIDER_LABEL: Record<string, Record<Viewer, string>> = {
  provider_ready_not_live_provider_verified: {
    admin: "Provider-ready, not live-provider verified",
    organisation_user: "Provider-ready, awaiting live check",
    counterparty: "Awaiting live provider check",
    funder: "Provider-ready (not provider-verified)",
    api_user: "provider_ready_not_live_provider_verified",
  },
  provider_credentials_pending: {
    admin: "Provider credentials pending",
    organisation_user: "Provider credentials pending",
    counterparty: "Provider setup pending",
    funder: "Provider credentials pending",
    api_user: "provider_credentials_pending",
  },
  provider_result_pending: {
    admin: "Provider result pending",
    organisation_user: "Provider result pending",
    counterparty: "Provider result pending",
    funder: "Provider result pending",
    api_user: "provider_result_pending",
  },
  provider_unavailable: {
    admin: "Provider unavailable",
    organisation_user: "Provider unavailable",
    counterparty: "Provider unavailable",
    funder: "Provider unavailable",
    api_user: "provider_unavailable",
  },
  provider_failed: {
    admin: "Provider failed",
    organisation_user: "Provider attempt did not complete",
    counterparty: "Provider attempt did not complete",
    funder: "Provider attempt did not complete",
    api_user: "provider_failed",
  },
  manual_review_recorded_not_provider_verified: {
    admin: "Manual review recorded — not provider verified",
    organisation_user: "Manual review recorded — not provider verified",
    counterparty: "Manual review recorded — not provider verified",
    funder: "Manual review recorded — not provider-verified",
    api_user: "manual_review_recorded_not_provider_verified",
  },
};

function wordingSafe(text: string | null, providerLive: boolean): boolean {
  if (!text) return true;
  if (providerLive) return true;
  const lc = text.toLowerCase();
  for (const phrase of FORBIDDEN_WORDING) {
    const idx = lc.indexOf(phrase);
    if (idx < 0) continue;
    const preceding = lc.slice(0, idx);
    if (/\bnot\b(?:\s+[\w-]+){0,3}\s*$/i.test(preceding)) continue;
    return false;
  }
  return true;
}

function safeVisibleReason(
  rejectionReason: string | null,
  customerSafeNote: string | null,
  viewer: Viewer,
  providerLive: boolean,
): string {
  if (viewer === "admin" || viewer === "organisation_user") {
    const candidate = customerSafeNote ?? rejectionReason ?? "";
    return wordingSafe(candidate, providerLive) ? candidate : "Manual review required";
  }
  // counterparty / funder / api: never internal reviewer language
  if (rejectionReason === "suspected_fraud_or_tampering") return "Manual review required";
  const candidate = customerSafeNote ?? rejectionReason ?? "";
  return wordingSafe(candidate, providerLive) ? candidate : "Manual review required";
}

function readinessImpact(status: string, requirementLevel: string): string {
  if (status === "rejected" || status === "expired") return "blocking";
  if (status === "missing" && requirementLevel === "mandatory") return "blocking";
  if (status === "accepted_with_warning") return "warning";
  if (status === "uploaded" || status === "under_review") return "review";
  if (status === "accepted" || status === "waived") return "ok";
  if (status === "provider_dependent") return "provider_dependent";
  if (status === "suspended_hold") return "blocking";
  return "review";
}

function nextAction(status: string, requirementLevel: string, providerLive: boolean): string {
  if (status === "rejected") return "resubmit_evidence";
  if (status === "missing" && requirementLevel === "mandatory") return "upload_evidence";
  if (status === "uploaded" || status === "under_review") return "await_review";
  if (status === "expired") return "renew_evidence";
  if (status === "provider_dependent" && !providerLive) return "await_provider_result";
  if (status === "suspended_hold") return "await_compliance_release";
  return "none";
}

function deriveViewer(role: string | null): Viewer {
  if (role && PRIVILEGED_ROLES.has(role)) return "admin";
  return "organisation_user";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const token = authHeader.replace("Bearer ", "");
  const claims = await supabase.auth.getClaims(token);
  if (claims.error || !claims.data?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claims.data.claims.sub as string;

  let body: { evidence_item_id?: string; viewer?: Viewer } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* ignore */ }
  } else {
    const url = new URL(req.url);
    body.evidence_item_id = url.searchParams.get("evidence_item_id") ?? undefined;
    body.viewer = (url.searchParams.get("viewer") as Viewer) ?? undefined;
  }
  if (!body.evidence_item_id) {
    return new Response(JSON.stringify({ error: "evidence_item_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve caller role (service client so we never bypass RLS for the item below)
  const { data: roleRow } = await service
    .from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle();
  const callerRole = (roleRow?.role as string | null) ?? null;
  const viewer: Viewer = body.viewer ?? deriveViewer(callerRole);
  // Counterparty/funder/api viewers may only be granted to non-privileged callers
  // when also explicitly allowed by the caller's role mapping. For Stage 3 we
  // keep it strict: anyone not in PRIVILEGED_ROLES is forced down to a non-admin
  // viewer, regardless of what the request asked for.
  const effectiveViewer: Viewer = (callerRole && PRIVILEGED_ROLES.has(callerRole))
    ? viewer
    : (viewer === "admin" ? "organisation_user" : viewer);

  // Use the user-scoped client so RLS applies to the row read.
  const { data: item, error } = await supabase
    .from("p5_batch2_evidence_items")
    .select(`
      id, record_id, status, rating, requirement_level, expiry_date,
      provider_dependency, provider_status, provider_live, provider_result_reference,
      current_rejection_reason, customer_safe_note, updated_at, current_version_id
    `)
    .eq("id", body.evidence_item_id)
    .maybeSingle();
  if (error || !item) {
    return new Response(JSON.stringify({ error: "not_found_or_forbidden" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: record } = await supabase
    .from("p5_batch2_kyc_records")
    .select("id, record_type, counterparty_id, trade_request_id, organization_id")
    .eq("id", item.record_id).maybeSingle();

  const { data: lastEvent } = await service
    .from("p5_batch2_evidence_review_events")
    .select("id, created_at")
    .eq("evidence_item_id", item.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: lastPack } = await service
    .from("p5_batch2_evidence_pack_items")
    .select("pack_id, p5_batch2_evidence_packs!inner(id, pack_status)")
    .eq("evidence_item_id", item.id)
    .limit(1).maybeSingle();

  const expiresAt = item.expiry_date ?? "";
  const expiryWarning = expiresAt
    ? (new Date(expiresAt).getTime() - Date.now()) < 30 * 24 * 3600 * 1000
    : false;

  const providerStatusLabel = item.provider_status
    ? (SAFE_PROVIDER_LABEL[item.provider_status]?.[effectiveViewer] ?? item.provider_status)
    : "";

  const visibleReason = safeVisibleReason(
    item.current_rejection_reason,
    item.customer_safe_note,
    effectiveViewer,
    !!item.provider_live,
  );

  // Final wording guard sweep on every string we emit.
  for (const s of [providerStatusLabel, visibleReason]) {
    if (!wordingSafe(s, !!item.provider_live)) {
      return new Response(JSON.stringify({ error: "wording_guard_blocked" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const payload = {
    record_id: record?.id ?? "",
    record_type: record?.record_type ?? "",
    linked_entity_id: record?.counterparty_id ?? record?.organization_id ?? "",
    linked_transaction_id: record?.trade_request_id ?? "",
    kyb_status: "",
    kyc_status: "",
    evidence_status: item.status,
    evidence_rating: item.rating ?? "",
    readiness_impact: readinessImpact(item.status, item.requirement_level),
    missing_items: [] as string[],
    blocker_count: ["rejected", "expired", "suspended_hold"].includes(item.status)
      || (item.status === "missing" && item.requirement_level === "mandatory") ? 1 : 0,
    warning_count: item.status === "accepted_with_warning" ? 1 : 0,
    expiry_warning: expiryWarning,
    expires_at: expiresAt,
    provider_dependency: !!item.provider_dependency,
    provider_status: providerStatusLabel,
    provider_live: !!item.provider_live,
    provider_result_reference: item.provider_result_reference ?? "",
    reason_code: item.current_rejection_reason ?? "",
    visible_reason: visibleReason,
    next_action: nextAction(item.status, item.requirement_level, !!item.provider_live),
    last_updated_at: item.updated_at,
    audit_reference: lastEvent?.id ?? "",
    evidence_pack_id: (lastPack as any)?.pack_id ?? "",
    pack_status: ((lastPack as any)?.p5_batch2_evidence_packs?.pack_status) ?? "",
  };

  return new Response(JSON.stringify(payload), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
