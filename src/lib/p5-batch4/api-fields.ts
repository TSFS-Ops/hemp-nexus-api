/**
 * P-5 Batch 4 — API-safe field whitelist (pure).
 *
 * The API layer may only expose these fields by default. Internal
 * notes, raw sensitive evidence and full audit internals must NEVER
 * appear in the API response without an explicit, separately-scoped
 * grant (out of scope for Stage 2).
 */
import type {
  P5B4ExecutionStatus,
  P5B4FinalityOutcome,
  P5B4FunderReleaseStatus,
  P5B4MilestoneKey,
  P5B4ReadinessStatus,
} from "./constants";

export const P5B4_API_SAFE_FIELDS = [
  "case_reference",
  "execution_status",
  "current_milestone",
  "readiness_status",
  "blocker_count",
  "warning_count",
  "next_action",
  "due_at",
  "funder_status",
  "finality_summary",
] as const;
export type P5B4ApiSafeField = (typeof P5B4_API_SAFE_FIELDS)[number];

export interface P5B4ApiCaseInternal {
  case_reference: string;
  execution_status: P5B4ExecutionStatus;
  current_milestone: P5B4MilestoneKey | null;
  readiness_status: P5B4ReadinessStatus;
  blocker_count: number;
  warning_count: number;
  next_action: string | null;
  due_at: string | null;
  funder_status: P5B4FunderReleaseStatus | null;
  finality_summary: string | null;
  // Internal/forbidden fields that must NEVER be returned:
  internal_notes?: string;
  raw_evidence?: unknown;
  audit_internal?: unknown;
  full_bank_number?: string;
  full_id_number?: string;
  full_tax_number?: string;
}

export interface P5B4ApiCaseSafe {
  case_reference: string;
  execution_status: P5B4ExecutionStatus;
  current_milestone: P5B4MilestoneKey | null;
  readiness_status: P5B4ReadinessStatus;
  blocker_count: number;
  warning_count: number;
  next_action: string | null;
  due_at: string | null;
  funder_status: P5B4FunderReleaseStatus | null;
  finality_summary: string | null;
}

const FORBIDDEN_API_FIELDS = new Set<string>([
  "internal_notes",
  "raw_evidence",
  "audit_internal",
  "full_bank_number",
  "full_id_number",
  "full_tax_number",
  "ubo_full_address",
  "passport_number",
  "id_number",
  "tax_number",
  "vat_number",
]);

export function buildApiSafeCase(
  internal: P5B4ApiCaseInternal,
): P5B4ApiCaseSafe {
  return {
    case_reference: internal.case_reference,
    execution_status: internal.execution_status,
    current_milestone: internal.current_milestone,
    readiness_status: internal.readiness_status,
    blocker_count: internal.blocker_count,
    warning_count: internal.warning_count,
    next_action: internal.next_action,
    due_at: internal.due_at,
    funder_status: internal.funder_status,
    finality_summary: internal.finality_summary,
  };
}

export function assertNoForbiddenApiFields(payload: Record<string, unknown>, ctx: string): void {
  for (const k of Object.keys(payload)) {
    if (FORBIDDEN_API_FIELDS.has(k)) {
      throw new Error(`P5B4 API leak in ${ctx}: forbidden field "${k}"`);
    }
  }
}

/** Outcomes that the API may surface in `finality_summary` without further authorisation. */
export const P5B4_API_PUBLIC_FINALITY_OUTCOMES: readonly P5B4FinalityOutcome[] = [
  "finality_recorded",
  "rejected",
  "withdrawn",
  "cancelled",
  "superseded",
  "archived",
];
