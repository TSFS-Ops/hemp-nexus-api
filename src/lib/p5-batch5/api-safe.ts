/**
 * P-5 Batch 5 — Phase 4
 * API-safe projection + blocked-state response helpers.
 *
 * Strict allowlist. Unknown fields are dropped. Reliance-affecting Memory
 * states (paused / disputed / superseded / test-or-invalid / missing) are
 * never collapsed into a clean reliance signal — they always surface as
 * a typed blocked state.
 */
import {
  P5B5_SCHEMA_VERSION,
  P5B5_OUTCOME_CODE_VERSION,
} from "./version";
import type {
  P5B5CorrectionStatus,
  P5B5DisputeStatus,
  P5B5EvidenceCompletenessStatus,
  P5B5FinalityStatus,
  P5B5FinalOutcomeCode,
  P5B5MemoryStatus,
  P5B5ProviderDependencyStatus,
} from "./outcomes";
import type { P5B5ApiScope } from "./permissions";

/** Strict allowlist of API-visible fields. */
export const P5B5_API_SAFE_FIELDS = [
  "finality_status",
  "final_outcome_code",
  "final_outcome_label",
  "finality_created_at",
  "evidence_completeness_status",
  "evidence_rating",
  "memory_status",
  "dispute_status",
  "correction_status",
  "provider_dependency_status",
  "finality_record_reference",
  "hash_reference",
  "schema_version",
  "outcome_code_version",
] as const;
export type P5B5ApiSafeField = (typeof P5B5_API_SAFE_FIELDS)[number];

/** Raw shape that may arrive from the finality record + memory record join. */
export interface P5B5ProjectionInput {
  finality_status?: P5B5FinalityStatus | null;
  final_outcome_code?: P5B5FinalOutcomeCode | null;
  final_outcome_label?: string | null;
  finality_created_at?: string | null;
  evidence_completeness_status?: P5B5EvidenceCompletenessStatus | null;
  evidence_rating?: string | null;
  memory_status?: P5B5MemoryStatus | null;
  dispute_status?: P5B5DisputeStatus | null;
  correction_status?: P5B5CorrectionStatus | null;
  provider_dependency_status?: P5B5ProviderDependencyStatus | null;
  finality_record_reference?: string | null;
  hash_reference?: string | null;
  /** When superseded, the current effective record id (only revealed if scoped). */
  current_effective_record_reference?: string | null;
  /** Any other field — explicitly NOT carried through. */
  [k: string]: unknown;
}

export interface P5B5ProjectionOptions {
  api_scopes?: ReadonlyArray<P5B5ApiScope>;
}

export type P5B5BlockedReason =
  | "permission_denied"
  | "memory_paused_due_to_dispute"
  | "finality_not_created"
  | "evidence_not_shareable"
  | "record_superseded"
  | "record_invalid_test";

export interface P5B5BlockedState {
  blocked: true;
  reason: P5B5BlockedReason;
  message: string;
  /** Only present when the projection-level rules allow exposing it. */
  current_effective_record_reference?: string | null;
  schema_version: typeof P5B5_SCHEMA_VERSION;
  outcome_code_version: typeof P5B5_OUTCOME_CODE_VERSION;
}

export interface P5B5ApiSafeProjection {
  blocked: false;
  finality_status: P5B5FinalityStatus | null;
  final_outcome_code: P5B5FinalOutcomeCode | null;
  final_outcome_label: string | null;
  finality_created_at: string | null;
  evidence_completeness_status: P5B5EvidenceCompletenessStatus | null;
  evidence_rating: string | null;
  memory_status: P5B5MemoryStatus | null;
  dispute_status: P5B5DisputeStatus | null;
  correction_status: P5B5CorrectionStatus | null;
  provider_dependency_status: P5B5ProviderDependencyStatus | null;
  finality_record_reference: string | null;
  hash_reference: string | null;
  schema_version: typeof P5B5_SCHEMA_VERSION;
  outcome_code_version: typeof P5B5_OUTCOME_CODE_VERSION;
}

const BLOCKED_MESSAGES: Record<P5B5BlockedReason, string> = {
  permission_denied: "You do not have permission to view this record.",
  memory_paused_due_to_dispute:
    "Memory reliance is paused while a dispute is being resolved.",
  finality_not_created:
    "No finality record exists for this case yet.",
  evidence_not_shareable:
    "Underlying evidence is not shareable via the API.",
  record_superseded:
    "This finality record has been superseded by a later record.",
  record_invalid_test:
    "This record is flagged as test or invalid and is not reliable.",
};

/** Build a typed blocked state. Never leaks evidence or private notes. */
export function buildP5B5BlockedState(
  reason: P5B5BlockedReason,
  context: { current_effective_record_reference?: string | null } = {},
): P5B5BlockedState {
  const out: P5B5BlockedState = {
    blocked: true,
    reason,
    message: BLOCKED_MESSAGES[reason],
    schema_version: P5B5_SCHEMA_VERSION,
    outcome_code_version: P5B5_OUTCOME_CODE_VERSION,
  };
  if (
    reason === "record_superseded" &&
    context.current_effective_record_reference
  ) {
    out.current_effective_record_reference =
      context.current_effective_record_reference;
  }
  return out;
}

/**
 * Strict allowlist projection.
 *
 * - Strips every key not in `P5B5_API_SAFE_FIELDS`.
 * - Hides `evidence_rating` unless `evidence_rating.read` scope is granted.
 * - Hides `finality_record_reference` and `hash_reference` unless
 *   `audit.read` scope is granted.
 * - Hides `provider_dependency_status` unless `provider_dependency.read` or
 *   `audit.read` scope is granted.
 * - Always stamps `schema_version` and `outcome_code_version`.
 *
 * Reliance-affecting states return a typed blocked state instead of a
 * partial projection (callers should not be able to confuse a paused or
 * superseded record with a clean reliance signal).
 */
export function projectFinalityToApiSafe(
  input: P5B5ProjectionInput | null | undefined,
  options: P5B5ProjectionOptions = {},
): P5B5ApiSafeProjection | P5B5BlockedState {
  if (!input || input.finality_status == null || input.finality_status === "none") {
    return buildP5B5BlockedState("finality_not_created");
  }

  if (input.final_outcome_code === "TEST_OR_INVALID") {
    return buildP5B5BlockedState("record_invalid_test");
  }

  if (
    input.finality_status === "under_dispute" ||
    input.dispute_status === "under_dispute" ||
    input.memory_status === "paused"
  ) {
    return buildP5B5BlockedState("memory_paused_due_to_dispute");
  }

  if (input.finality_status === "superseded") {
    return buildP5B5BlockedState("record_superseded", {
      current_effective_record_reference:
        input.current_effective_record_reference ?? null,
    });
  }

  const scopes = new Set(options.api_scopes ?? []);
  const hasEvidence = scopes.has("evidence_rating.read");
  const hasAudit = scopes.has("audit.read");
  const hasProvider = scopes.has("provider_dependency.read") || hasAudit;

  return {
    blocked: false,
    finality_status: input.finality_status ?? null,
    final_outcome_code: input.final_outcome_code ?? null,
    final_outcome_label: input.final_outcome_label ?? null,
    finality_created_at: input.finality_created_at ?? null,
    evidence_completeness_status: input.evidence_completeness_status ?? null,
    evidence_rating: hasEvidence ? (input.evidence_rating ?? null) : null,
    memory_status: input.memory_status ?? null,
    dispute_status: input.dispute_status ?? null,
    correction_status: input.correction_status ?? null,
    provider_dependency_status: hasProvider
      ? (input.provider_dependency_status ?? null)
      : null,
    finality_record_reference: hasAudit
      ? (input.finality_record_reference ?? null)
      : null,
    hash_reference: hasAudit ? (input.hash_reference ?? null) : null,
    schema_version: P5B5_SCHEMA_VERSION,
    outcome_code_version: P5B5_OUTCOME_CODE_VERSION,
  };
}

/**
 * Defensive utility: strip any non-allowlisted keys from a candidate
 * response body before serialising it. Use this in edge functions that
 * compose responses from multiple sources.
 */
export function stripToApiSafe<T extends Record<string, unknown>>(
  body: T,
): Partial<Record<P5B5ApiSafeField, unknown>> {
  const out: Partial<Record<P5B5ApiSafeField, unknown>> = {};
  for (const k of P5B5_API_SAFE_FIELDS) {
    if (k in body) out[k] = body[k];
  }
  // Versions are always stamped.
  out.schema_version = P5B5_SCHEMA_VERSION;
  out.outcome_code_version = P5B5_OUTCOME_CODE_VERSION;
  return out;
}
