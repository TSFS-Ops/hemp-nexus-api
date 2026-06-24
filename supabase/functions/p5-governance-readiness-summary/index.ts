// P-5 Batch 1 — Stage 3 read-only summary endpoint.
//
// Returns the approved P-5 governance/readiness summary shape for a single
// case. Caller identity + role decide which fields are returned. Internal
// fields (raw provider payloads, internal reviewer notes, legal comments,
// internal risk scores, AI reasoning, unapproved/draft evidence packs) are
// NEVER returned. All textual labels are passed through the Stage 2 wording
// guard before being included in the response.
//
// verify_jwt is validated in code via supabase.auth.getClaims().

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Inline mirror of the Stage 1 SSOT forbidden / allowed wording lists.
// Kept short and explicit so this function has no project-relative imports.
const FORBIDDEN_WORDS = [
  "Verified", "Certified", "Compliant", "Sanctions Cleared", "PEP Clear",
  "AML Cleared", "KYC Complete", "Bankable", "Guaranteed Bankable",
  "Guaranteed", "Risk-free", "No risk", "Approved by bank", "Approved by funder",
  "Legally valid", "Audit-proof", "Final settlement", "Payment confirmed",
  "Refund complete", "Without a Doubt", "WaD finality",
];

function containsForbidden(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return FORBIDDEN_WORDS.some((w) => lower.includes(w.toLowerCase()));
}

function safeLabel(text: string | null | undefined, fallback: string): string {
  if (!text) return fallback;
  return containsForbidden(text) ? fallback : text;
}

// Cautious provider wording per readiness/provider status.
function nextActionFor(status: string, providerStatus: string | null): string {
  if (status === "blocked") return "Resolve blocker before proceeding";
  if (status === "on_hold") return "Hold must be released by authorised role";
  if (status === "escalated") return "Escalation owner action required";
  if (status === "more_information_required") return "More information required";
  if (status === "rejected") return "Rejected — reopen if facts change";
  if (status === "provider_dependent") {
    switch (providerStatus) {
      case "not_live": return "Provider not live";
      case "credentials_pending": return "Provider credentials pending";
      case "timeout": return "Provider timeout — retry pending";
      case "inconclusive": return "Provider result inconclusive — manual review required";
      case "pending": return "External confirmation pending";
      default: return "Provider-Dependent";
    }
  }
  if (status === "conditional_ready") return "Conditional Ready — review remaining warnings";
  if (status === "internally_ready") return "Internally Ready — awaiting human approval";
  if (status === "ready_to_proceed") return "Ready to Proceed";
  if (status === "under_review") return "Under Review";
  return "Under Review";
}

function nextOwnerFor(status: string): string {
  if (status === "on_hold") return "compliance_admin";
  if (status === "escalated") return "executive_approver";
  if (status === "more_information_required") return "customer_entity_owner";
  if (status === "internally_ready") return "executive_approver";
  if (status === "provider_dependent") return "external_provider";
  if (status === "ready_to_proceed") return "operator_case_manager";
  if (status === "rejected") return "customer_entity_owner";
  return "governance_reviewer";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claims.claims.sub as string;

  // Caller scope: admin/governance roles get the richer view (still no secrets).
  const PRIVILEGED = [
    "platform_admin", "executive_approver", "governance_reviewer",
    "compliance_analyst", "operator_case_manager", "developer_technical_admin",
    "auditor_read_only",
  ];
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const callerRoles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const isPrivileged = callerRoles.some((r: string) => PRIVILEGED.includes(r));

  const url = new URL(req.url);
  const caseId = url.searchParams.get("case_id");
  if (!caseId) {
    return new Response(JSON.stringify({ error: "case_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const correlationId = url.searchParams.get("correlation_id");
  const requestId = crypto.randomUUID();

  const { data: c, error } = await supabase
    .from("p5_governance_readiness_cases")
    .select(
      "id, organization_id, entity_id, match_id, governance_status, compliance_status, readiness_status, evidence_status, reason_codes, blocker_count, warning_count, provider_dependency, provider_dependency_type, provider_status, provider_last_checked_at, next_action, next_owner_type, last_updated_at, status_changed_at, audit_reference, decision_reference, evidence_pack_id, evidence_summary_id, last_audit_event_id, is_on_hold",
    )
    .eq("id", caseId)
    .maybeSingle();

  if (error || !c) {
    return new Response(JSON.stringify({ error: "Case not found", request_id: requestId }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Required-items-missing derived from evidence (no internal notes).
  const { count: missing } = await supabase
    .from("p5_governance_evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("case_id", caseId)
    .eq("required", true)
    .in("status", ["not_started", "incomplete", "submitted", "rejected"]);

  const next_action = safeLabel(
    nextActionFor(c.readiness_status, c.provider_status),
    "Under Review",
  );
  const next_owner_type = c.next_owner_type ?? nextOwnerFor(c.readiness_status);

  const body: Record<string, unknown> = {
    request_id: requestId,
    correlation_id: correlationId,
    entity_id: c.entity_id,
    project_id: null,
    transaction_id: c.match_id,
    readiness_status: c.readiness_status,
    governance_status: c.governance_status,
    compliance_status: c.compliance_status,
    evidence_status: c.evidence_status,
    reason_codes: Array.isArray(c.reason_codes) ? c.reason_codes : [],
    blocker_count: c.blocker_count ?? 0,
    warning_count: c.warning_count ?? 0,
    provider_dependency: c.provider_dependency ?? false,
    provider_dependency_type: c.provider_dependency_type ?? null,
    provider_status: c.provider_status ?? null,
    provider_last_checked_at: c.provider_last_checked_at ?? null,
    next_action,
    next_owner_type,
    required_items_missing: missing ?? 0,
    last_updated_at: c.last_updated_at,
    status_changed_at: c.status_changed_at,
    audit_reference: c.audit_reference,
    decision_reference: c.decision_reference,
    evidence_pack_id: c.evidence_pack_id,
    evidence_summary_id: c.evidence_summary_id,
    version_hash_chain_reference: c.last_audit_event_id,
  };

  if (isPrivileged) {
    // Richer view: organisation context + hold flag. Still no raw provider
    // payloads, no internal reviewer notes, no risk scores, no AI reasoning.
    body.organization_id = c.organization_id;
    body.is_on_hold = c.is_on_hold;
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
