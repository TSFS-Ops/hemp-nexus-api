/**
 * P-5 Batch 4 — Case reference formatter (pure).
 *
 * Deterministic case-ref formatting: `P5B4-<TYPE>-<YYYYMMDD>-<SEQ>`.
 * Process-type prefix comes from a single SSOT-driven mapping.
 */
import { P5B4_PROCESS_TYPES, type P5B4ProcessType } from "./constants";

const PROCESS_PREFIX: Record<P5B4ProcessType, string> = {
  company_onboarding: "ONB",
  transaction_case: "TXN",
  project_workstream: "PRJ",
  funder_release: "FND",
};

export interface P5B4CaseRefInput {
  process_type: P5B4ProcessType;
  created_at: Date;
  sequence: number;
}

export function formatCaseReference(input: P5B4CaseRefInput): string {
  const prefix = PROCESS_PREFIX[input.process_type];
  const d = input.created_at;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const seq = String(Math.max(1, Math.floor(input.sequence))).padStart(5, "0");
  return `P5B4-${prefix}-${y}${m}${day}-${seq}`;
}

const REF_RE = /^P5B4-(ONB|TXN|PRJ|FND)-\d{8}-\d{5}$/;

export function isCaseReference(value: string): boolean {
  return REF_RE.test(value);
}

/** Defensive: ensure prefix table covers every process type. */
export function assertCaseRefCovers(): void {
  for (const t of P5B4_PROCESS_TYPES) {
    if (!PROCESS_PREFIX[t]) throw new Error(`P5B4 case-ref prefix missing for ${t}`);
  }
}
