/**
 * P-5 Batch 8 — Phase 5 UI data layer.
 *
 * The ONLY surface UI code is allowed to use to talk to the Batch 8 backend.
 *
 *   - Reads go exclusively through Phase 4 `p5b8_read_*` projections.
 *   - Writes go exclusively through Phase 3 `p5b8_rpc_*` functions.
 *   - No direct `from('p5b8_*')` table access from the UI.
 *   - No forbidden Phase 1 external fields are exposed by these types.
 *
 * The Phase 5 UI guard scans `src/pages/p5-batch8`, `src/pages/admin/p5-batch8`
 * and `src/components/p5-batch8` to ensure no other access pattern is used.
 */
import { supabase } from "@/integrations/supabase/client";

// ── Read projection result shapes (API-safe only) ──────────────────────────

export interface P5B8ProviderConfigSummary {
  provider_category: string;
  live_now: boolean;
  hidden_until_live: boolean;
  commercial_owner: string;
  technical_contact: string;
  approval_owner: string;
  activation_signoff_owner: string;
  activation_signed_off_at: string | null;
  updated_at: string;
}

export interface P5B8DependencyStatusSummary {
  provider_category: string;
  subject_id: string | null;
  case_id: string | null;
  provider_dependency_status: string;
  provider_environment: string;
  stale_as_of: string | null;
  is_stale: boolean;
  updated_at: string;
}

export interface P5B8RequestSummary {
  request_id: string;
  provider_category: string;
  provider_environment: string;
  request_reference: string;
  case_id: string | null;
  subject_id: string | null;
  requested_at: string;
  status: string;
}

export interface P5B8ResultSummary {
  result_id: string;
  provider_request_id: string | null;
  provider_category: string;
  provider_environment: string;
  provider_reference: string | null;
  result_status: string;
  result_summary: string | null;
  received_at: string;
}

export interface P5B8DecisionSummary {
  decision_id: string;
  provider_result_id: string | null;
  provider_category: string;
  provider_decision_state: string;
  is_fallback: boolean;
  is_final: boolean;
  reason: string | null;
  evidence_reference: string | null;
  set_by_role: string | null;
  created_at: string;
}

export interface P5B8WebhookSummary {
  webhook_id: string;
  provider_category: string;
  webhook_event: string;
  provider_environment: string;
  signature_status: string;
  received_at: string;
}

export interface P5B8AuditSummary {
  audit_id: string;
  event_code: string;
  provider_category: string | null;
  case_id: string | null;
  subject_id: string | null;
  actor_role: string | null;
  created_at: string;
}

export interface P5B8RetrySummary {
  retry_id: string;
  provider_request_id: string;
  provider_category: string;
  attempt_count: number;
  last_error_class: string | null;
  fallback_status: string | null;
  next_retry_at: string | null;
  updated_at: string;
}

export interface P5B8LinkSummary {
  link_id: string;
  provider_decision_id: string;
  link_type: string;
  memory_record_id: string | null;
  finality_record_id: string | null;
  created_at: string;
}

export interface P5B8QueueSummary {
  provider_category: string;
  provider_dependency_status: string;
  count: number;
}

// ── Read calls (Phase 4 projections only) ──────────────────────────────────

// The Supabase generated types don't yet include these functions; we cast at
// the boundary and validate at runtime via the returned shape.
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase as unknown as {
    rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc(name, args);

async function callRead<T>(name: string, args?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (Array.isArray(data) ? (data as T[]) : []);
}

export const readProviderConfigSummary = () =>
  callRead<P5B8ProviderConfigSummary>("p5b8_read_provider_config_summary");

export const readDependencyStatusSummary = (args: {
  p_provider_category?: string | null;
  p_subject_id?: string | null;
  p_case_id?: string | null;
} = {}) =>
  callRead<P5B8DependencyStatusSummary>(
    "p5b8_read_provider_dependency_status_summary",
    {
      p_provider_category: args.p_provider_category ?? null,
      p_subject_id: args.p_subject_id ?? null,
      p_case_id: args.p_case_id ?? null,
    },
  );

export const readRequestSummary = (args: {
  p_provider_category?: string | null;
  p_case_id?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8RequestSummary>("p5b8_read_provider_request_summary", {
    p_provider_category: args.p_provider_category ?? null,
    p_case_id: args.p_case_id ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readResultSummary = (args: {
  p_provider_category?: string | null;
  p_request_id?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8ResultSummary>("p5b8_read_provider_result_summary", {
    p_provider_category: args.p_provider_category ?? null,
    p_request_id: args.p_request_id ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readDecisionSummary = (args: {
  p_provider_category?: string | null;
  p_result_id?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8DecisionSummary>("p5b8_read_provider_decision_summary", {
    p_provider_category: args.p_provider_category ?? null,
    p_result_id: args.p_result_id ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readWebhookSummary = (args: {
  p_provider_category?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8WebhookSummary>("p5b8_read_webhook_ledger_summary", {
    p_provider_category: args.p_provider_category ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readAuditSummary = (args: {
  p_provider_category?: string | null;
  p_case_id?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8AuditSummary>("p5b8_read_audit_timeline_summary", {
    p_provider_category: args.p_provider_category ?? null,
    p_case_id: args.p_case_id ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readRetrySummary = (args: {
  p_provider_category?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8RetrySummary>("p5b8_read_retry_state_summary", {
    p_provider_category: args.p_provider_category ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readLinkSummary = (args: {
  p_provider_decision_id?: string | null;
  p_limit?: number;
} = {}) =>
  callRead<P5B8LinkSummary>("p5b8_read_memory_finality_link_summary", {
    p_provider_decision_id: args.p_provider_decision_id ?? null,
    p_limit: args.p_limit ?? 200,
  });

export const readQueueSummary = () =>
  callRead<P5B8QueueSummary>("p5b8_read_dashboard_queue_summary");

// ── Write calls (Phase 3 RPCs only) ────────────────────────────────────────

async function callRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

export const recordActivationSignoff = (args: {
  provider_config_id: string;
  signed_off_role: string;
  note: string;
  evidence_reference: string;
  go_live: boolean;
}) =>
  callRpc<string>("p5b8_rpc_record_activation_signoff", {
    _provider_config_id: args.provider_config_id,
    _signed_off_role: args.signed_off_role,
    _note: args.note,
    _evidence_reference: args.evidence_reference,
    _go_live: args.go_live,
  });

export const setDependencyStatus = (args: {
  provider_category: string;
  state: string;
  environment: string;
  subject_id?: string | null;
  case_id?: string | null;
  reason?: string | null;
  stale_as_of?: string | null;
  is_stale?: boolean;
}) =>
  callRpc<string>("p5b8_rpc_set_dependency_status", {
    _provider_category: args.provider_category,
    _state: args.state,
    _environment: args.environment,
    _subject_id: args.subject_id ?? null,
    _case_id: args.case_id ?? null,
    _reason: args.reason ?? null,
    _stale_as_of: args.stale_as_of ?? null,
    _is_stale: args.is_stale ?? false,
  });
