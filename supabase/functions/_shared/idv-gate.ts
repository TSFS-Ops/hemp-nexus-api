/**
 * Batch V — Controlled-action IDV gate (server mirror).
 *
 * `isIdvBlocking(status)` — single predicate consumed at every controlled-
 * action call site (WaD seal, finality, funder-ready, API ready=true,
 * POI-bind).
 *
 * `assertIdvGate(admin, subjectId)` — optional convenience for edge
 * functions. Reads the *latest* IDV record for a subject from
 * `public.p5scr_idv_records` (append-only ledger; the caller need only
 * pass the subject id) and throws an `IdvGateError` if it is blocking or
 * absent. When no subject id is available (e.g. the subject is not yet
 * registered in the p5scr spine) the caller may skip this convenience and
 * still gate on any local IDV status they own — the predicate handles
 * `null`/`undefined` as blocking.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

import type { InternalIdvStatus } from "./verifynow/result-mapping.ts";

export const IDV_BLOCKING_STATUSES: readonly InternalIdvStatus[] = Object.freeze([
  "pending",
  "provider_pending",
  "provider_not_available",
  "retry_required",
  "alternative_document_required",
  "manual_review_required",
  "blocked_pending_admin_decision",
  "provider_error",
  "failed",
  "expired",
  "unsupported",
  "error",
]);

export const IDV_COMPLETED_STATUSES: readonly InternalIdvStatus[] = Object.freeze([
  "idv_completed",
]);

export function isIdvBlocking(status: string | null | undefined): boolean {
  if (!status) return true;
  return IDV_BLOCKING_STATUSES.includes(status as InternalIdvStatus);
}

export function isIdvCompleted(status: string | null | undefined): boolean {
  return !!status && IDV_COMPLETED_STATUSES.includes(status as InternalIdvStatus);
}

export type ControlledAction =
  | "wad_seal"
  | "finality_action"
  | "funder_ready_grant"
  | "api_ready_true"
  | "poi_bind_party";

export class IdvGateError extends Error {
  constructor(
    public readonly code:
      | "IDV_REQUIRED"
      | "IDV_PENDING"
      | "IDV_MANUAL_REVIEW"
      | "IDV_BLOCKED",
    message: string,
    public readonly status: string | null,
    public readonly action: ControlledAction,
  ) {
    super(message);
    this.name = "IdvGateError";
  }
}

function classify(status: string | null | undefined): IdvGateError["code"] {
  const s = (status ?? "pending") as InternalIdvStatus;
  if (s === "manual_review_required" || s === "provider_error") return "IDV_MANUAL_REVIEW";
  if (s === "blocked_pending_admin_decision") return "IDV_BLOCKED";
  if (s === "provider_pending" || s === "pending") return "IDV_PENDING";
  return "IDV_REQUIRED";
}

/**
 * Optional convenience for edge functions. Non-fatal when no subject id
 * is supplied — the caller is expected to gate on local state in that
 * case. When a subject id is supplied but has no IDV record, this
 * throws IDV_REQUIRED (fail-closed).
 */
export async function assertIdvGate(
  admin: AdminClient,
  subjectId: string | null | undefined,
  action: ControlledAction,
): Promise<void> {
  if (!subjectId) return; // caller must gate locally
  const { data, error } = await admin
    .from("p5scr_idv_records")
    .select("state")
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Fail-closed — but only for actions the caller explicitly asked us
    // to gate. Never silently allow.
    throw new IdvGateError("IDV_REQUIRED", "Identity verification lookup failed", null, action);
  }
  const state: string | null = data?.state ?? null;
  if (!state || isIdvBlocking(state)) {
    throw new IdvGateError(classify(state), "Identity verification required", state, action);
  }
}
