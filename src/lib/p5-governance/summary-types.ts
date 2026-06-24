/**
 * P-5 Batch 1 — Stage 5 summary types.
 *
 * Mirrors the scoped response shape returned by the
 * `p5-governance-readiness-summary` edge function (Stage 3). Customer,
 * funder and API-client surfaces MUST consume this type rather than read
 * `p5_governance_*` tables directly.
 */
import type { P5ProviderStatus, P5ReasonCode, P5Status } from "./constants";

/** Scoped, customer/funder/API-safe summary of a single P-5 case. */
export interface P5ReadinessSummary {
  request_id: string;
  correlation_id?: string | null;

  // Subject identifiers — caller-permitted only.
  entity_id: string | null;
  project_id: string | null;
  transaction_id: string | null;
  organization_id?: string | null; // privileged only

  // Three lanes.
  readiness_status: P5Status;
  governance_status: P5Status;
  compliance_status: P5Status;
  evidence_status: P5Status;

  // Reasoning surface (codes only; no internal notes).
  reason_codes: P5ReasonCode[];
  blocker_count: number;
  warning_count: number;

  // Provider dependency (safe wording only).
  provider_dependency: boolean;
  provider_dependency_type: string | null;
  provider_status: P5ProviderStatus | null;
  provider_last_checked_at: string | null;

  // Next-step affordances.
  next_action: string;
  next_owner_type: string | null;
  required_items_missing: number;

  // Timestamps & references.
  last_updated_at: string | null;
  status_changed_at: string | null;
  audit_reference: string | null;
  decision_reference: string | null;
  evidence_pack_id: string | null;
  evidence_summary_id: string | null;
  version_hash_chain_reference: string | null;

  // Privileged-only flag.
  is_on_hold?: boolean;
}

/** Caller perspective used by UI components to gate field visibility. */
export type P5SummaryViewer =
  | "admin"
  | "internal"
  | "customer"
  | "funder"
  | "api_client";
