/**
 * P-5 Batch 4 Stage 7 — Report builders (pure).
 *
 * Builds audience-scoped report rows. Each builder enforces the exact
 * field allowlist already established in earlier stages:
 *
 *   admin     → full safe-summary view (no raw evidence, no full
 *               sensitive numbers, but admin-internal context allowed).
 *   org_user  → owner-scoped task projection.
 *   funder    → released-only funder projection.
 *   api       → API_SAFE_FIELDS allowlist (Batch 4 api-fields SSOT).
 *
 * PDF exports are intentionally stubbed — they return a labelled
 * descriptor, never a PDF byte stream. The bridge call sites must
 * surface the descriptor's `is_stub` flag in the UI.
 */
import {
  P5B4_API_SAFE_FIELDS,
  buildApiSafeCase,
  type P5B4ApiCaseInternal,
  type P5B4ApiCaseSafe,
} from "./api-fields";
import type {
  P5B4ExecutionStatus,
  P5B4FunderReleaseStatus,
  P5B4MilestoneKey,
  P5B4ReadinessStatus,
} from "./constants";

export const P5B4_REPORT_AUDIENCES = [
  "admin",
  "org_user",
  "funder",
  "api",
] as const;
export type P5B4ReportAudience = (typeof P5B4_REPORT_AUDIENCES)[number];

/** Field allowlists per audience. Mirrors the Stage 3 edge function projection. */
export const P5B4_REPORT_FIELDS: Record<P5B4ReportAudience, readonly string[]> = {
  admin: [
    "case_reference",
    "process_type",
    "execution_status",
    "readiness_status",
    "current_milestone",
    "blocker_count",
    "warning_count",
    "due_at",
    "funder_status",
    "finality_status",
    "provider_dependency_status",
    "owner_user_id",
    "created_at",
    "updated_at",
  ],
  org_user: [
    "case_reference",
    "process_type",
    "execution_status",
    "readiness_status",
    "current_milestone",
    "blocker_count",
    "warning_count",
    "due_at",
  ],
  funder: [
    "case_reference",
    "process_type",
    "execution_status",
    "current_milestone",
    "readiness_status",
    "blocker_count",
    "warning_count",
    "funder_status",
    "due_at",
  ],
  api: [...P5B4_API_SAFE_FIELDS],
};

/** Fields that must NEVER appear in any report, regardless of audience. */
export const P5B4_REPORT_GLOBALLY_FORBIDDEN: readonly string[] = [
  "internal_notes",
  "internal_detail",
  "raw_evidence",
  "raw_file_hash",
  "file_reference",
  "bank_account_number",
  "id_number",
  "passport_number",
  "tax_number",
  "vat_number",
  "ubo_full_address",
  "ubo_date_of_birth",
  "audit_internal",
];

export interface P5B4ReportRowInternal {
  case_reference: string;
  process_type: string;
  execution_status: P5B4ExecutionStatus;
  readiness_status: P5B4ReadinessStatus;
  current_milestone: P5B4MilestoneKey | null;
  blocker_count: number;
  warning_count: number;
  due_at: string | null;
  funder_status: P5B4FunderReleaseStatus | null;
  finality_status: string | null;
  provider_dependency_status: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
  /** Any extra fields appearing here are screened against the allowlist + forbidden list. */
  [extra: string]: unknown;
}

export function projectReportRow<A extends P5B4ReportAudience>(
  audience: A,
  internal: P5B4ReportRowInternal,
): Record<string, unknown> {
  const allow = new Set(P5B4_REPORT_FIELDS[audience]);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(internal)) {
    if (P5B4_REPORT_GLOBALLY_FORBIDDEN.includes(k.toLowerCase())) continue;
    if (!allow.has(k)) continue;
    out[k] = internal[k];
  }
  return out;
}

export function buildReport(
  audience: P5B4ReportAudience,
  rows: readonly P5B4ReportRowInternal[],
): Record<string, unknown>[] {
  return rows.map((r) => projectReportRow(audience, r));
}

/** Defence-in-depth: throws if a row contains a forbidden token. */
export function assertReportSafe(
  audience: P5B4ReportAudience,
  rows: readonly Record<string, unknown>[],
  ctx: string,
): void {
  const allow = new Set(P5B4_REPORT_FIELDS[audience]);
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (P5B4_REPORT_GLOBALLY_FORBIDDEN.includes(k.toLowerCase())) {
        throw new Error(`P5B4 report leak (${ctx}/${audience}): forbidden field "${k}"`);
      }
      if (!allow.has(k)) {
        throw new Error(`P5B4 report leak (${ctx}/${audience}): out-of-allowlist field "${k}"`);
      }
    }
  }
}

// ─── PDF stub ────────────────────────────────────────────────────────────
/**
 * PDF descriptor. Stage 7 deliberately does NOT generate real PDFs;
 * call sites must render the `notice` clearly and never present the
 * descriptor as a finished PDF.
 */
export interface P5B4ReportPdfStub {
  is_stub: true;
  audience: P5B4ReportAudience;
  case_reference: string;
  row_count: number;
  generated_at: string;
  notice: string;
}

export function buildPdfStub(
  audience: P5B4ReportAudience,
  caseReference: string,
  rowCount: number,
): P5B4ReportPdfStub {
  return {
    is_stub: true,
    audience,
    case_reference: caseReference,
    row_count: rowCount,
    generated_at: new Date().toISOString(),
    notice:
      "PDF generation is not yet wired. This is a structured descriptor used " +
      "by Stage 7 reports. Call sites must label this clearly as 'not a PDF'.",
  };
}

// API-safe export — re-export for ergonomic Stage 7 callers.
export { buildApiSafeCase };
export type { P5B4ApiCaseInternal, P5B4ApiCaseSafe };
