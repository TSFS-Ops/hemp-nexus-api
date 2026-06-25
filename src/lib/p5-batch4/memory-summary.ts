/**
 * P-5 Batch 4 — Memory summary builder (pure).
 *
 * Builds the safe Memory summary fed at finality, and strips raw
 * personal / bank / ID / tax / UBO / sensitive-evidence fields.
 */
import type {
  P5B4FinalityOutcome,
  P5B4MilestoneKey,
  P5B4BlockerKey,
} from "./constants";

/** Field names that must NEVER appear in a Memory summary. */
export const P5B4_MEMORY_FORBIDDEN_FIELDS: readonly string[] = [
  "bank_account_number",
  "iban",
  "swift",
  "id_number",
  "passport_number",
  "tax_number",
  "vat_number",
  "ubo_full_address",
  "ubo_date_of_birth",
  "director_personal_email",
  "raw_document",
  "file_blob",
  "personal_email",
  "personal_phone",
  "social_security_number",
];

export interface P5B4MemorySummaryInput {
  case_reference: string;
  process_type: string;
  final_outcome: P5B4FinalityOutcome;
  completed_milestones: readonly P5B4MilestoneKey[];
  waived_milestones: readonly P5B4MilestoneKey[];
  resolved_blockers: readonly P5B4BlockerKey[];
  funder_outcome_summary: string | null;
  provider_dependency_notes: string | null;
  lessons: readonly string[];
  raw_facts?: Record<string, unknown>;
}

export interface P5B4MemorySummary {
  case_reference: string;
  process_type: string;
  final_outcome: P5B4FinalityOutcome;
  completed_milestones: readonly P5B4MilestoneKey[];
  waived_milestones: readonly P5B4MilestoneKey[];
  resolved_blockers: readonly P5B4BlockerKey[];
  funder_outcome_summary: string | null;
  provider_dependency_notes: string | null;
  lessons: readonly string[];
  safe_facts: Record<string, unknown>;
}

/** Removes any forbidden field (case-insensitive substring) from `raw_facts`. */
export function stripSensitiveFields(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    if (P5B4_MEMORY_FORBIDDEN_FIELDS.some((f) => lower.includes(f))) continue;
    out[k] = v;
  }
  return out;
}

export function buildMemorySummary(input: P5B4MemorySummaryInput): P5B4MemorySummary {
  return {
    case_reference: input.case_reference,
    process_type: input.process_type,
    final_outcome: input.final_outcome,
    completed_milestones: [...input.completed_milestones],
    waived_milestones: [...input.waived_milestones],
    resolved_blockers: [...input.resolved_blockers],
    funder_outcome_summary: input.funder_outcome_summary,
    provider_dependency_notes: input.provider_dependency_notes,
    lessons: [...input.lessons],
    safe_facts: stripSensitiveFields(input.raw_facts),
  };
}
